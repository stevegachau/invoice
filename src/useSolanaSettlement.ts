import { useEffect, useState } from "react";
import { createPublicClient, erc20Abi, fallback, http, type Address, type Hex } from "viem";
import { CHAINS, RPC_URLS, USDC, ACROSS_SPOKE, BLOCK_TIME_MS, type SupportedChainId } from "./chains";
import { fundsDepositedEventAbi } from "./abi";
import { fetchDepositStatus } from "./across";

// Settlement tracking for a Solana-destination invoice loses one property
// the EVM-destination tracker has: on EVM, every checkpoint watches a
// disposable, never-used-before address, so "any inflow" is unambiguously
// this invoice. On Solana there's no equivalent smart account to receive
// into — the bridge delivers straight to payee's real wallet, which isn't
// disposable. So instead of watching Solana for a matching-amount transfer
// (weaker: relies on amount + time-window matching), we use the deposit's
// unique `depositId` (recovered from the origin chain's FundsDeposited
// event) to poll Across's own `/deposit/status` as the authority on whether
// it filled. That keeps the "unambiguous" property all the way through:
// depositId is unique per-deposit, same guarantee the smart-account address
// gives on the EVM side.
//
// NOTE: fetchDepositStatus's response shape is inferred from Across's docs,
// not independently verified the way the depositNow mechanism itself was
// (that was proven live — see solanaInvoice.ts). Validate the actual
// response shape against a real depositId before shipping this.

export type SolanaSettlement = {
  source?: { chainId: SupportedChainId; txHash?: Hex; amount?: bigint };
  bridgeSubmitted?: { chainId: SupportedChainId; depositId: bigint; txHash?: Hex };
  complete?: { fillTx?: string; fillChainId?: number };
};

const POLL_MS = 8000;
const ACROSS_STATUS_POLL_MS = 6000;
const ISSUE_CLOCK_SKEW_MS = 60_000;

function estimateBlockAt(
  chainId: SupportedChainId,
  latestBlock: bigint,
  latestTimestampSec: bigint,
  timestampMs: number,
): bigint {
  const elapsedMs = Math.max(0, Number(latestTimestampSec) * 1000 - timestampMs);
  const blocksBack = BigInt(Math.floor(elapsedMs / BLOCK_TIME_MS[chainId]));
  return latestBlock > blocksBack ? latestBlock - blocksBack : 0n;
}

async function getEventsAdaptive<T>(
  fetchFn: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  minRange = 100n,
): Promise<T[]> {
  if (fromBlock > toBlock) return [];
  try {
    return await fetchFn(fromBlock, toBlock);
  } catch (e) {
    const range = toBlock - fromBlock;
    if (range <= minRange) throw e;
    const mid = fromBlock + range / 2n;
    const [left, right] = await Promise.all([
      getEventsAdaptive(fetchFn, fromBlock, mid, minRange),
      getEventsAdaptive(fetchFn, mid + 1n, toBlock, minRange),
    ]);
    return [...left, ...right];
  }
}

function addressToBytes32(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

export function useSolanaSettlement(
  invoiceAddress: Address,
  issuedAt: number,
): SolanaSettlement {
  const [state, setState] = useState<SolanaSettlement>({});

  // Phase 1: watch all 5 EVM chains for inflow to invoiceAddress. Same
  // adaptive-scan pattern as the EVM tracker in InvoicePay.tsx.
  useEffect(() => {
    if (state.source) return;
    const cancellers: (() => void)[] = [];

    for (const chain of CHAINS) {
      const client = createPublicClient({
        chain,
        transport: fallback(
          RPC_URLS[chain.id].map((url) => http(url, { timeout: 10_000, retryCount: 1 })),
          { rank: false, retryCount: 1 },
        ),
      });

      let cancelled = false;
      let nextFromBlock: bigint | undefined;

      async function tick() {
        if (cancelled) return;
        try {
          let latest: bigint;
          if (nextFromBlock === undefined) {
            const latestBlock = await client.getBlock({ blockTag: "latest" });
            latest = latestBlock.number;
            nextFromBlock = estimateBlockAt(
              chain.id,
              latestBlock.number,
              latestBlock.timestamp,
              issuedAt - ISSUE_CLOCK_SKEW_MS,
            );
          } else {
            latest = await client.getBlockNumber();
          }
          if (nextFromBlock > latest) return;

          const fromBlock = nextFromBlock;
          const toBlock = latest;

          const inflows = await getEventsAdaptive(
            (f, t) =>
              client.getContractEvents({
                address: USDC[chain.id],
                abi: erc20Abi,
                eventName: "Transfer",
                args: { to: invoiceAddress },
                fromBlock: f,
                toBlock: t,
              }),
            fromBlock,
            toBlock,
          );

          if (inflows.length > 0 && !state.source) {
            const first = inflows[0];
            setState((prev) =>
              prev.source
                ? prev
                : {
                    ...prev,
                    source: {
                      chainId: chain.id,
                      txHash: first.transactionHash ?? undefined,
                      amount: first.args.value,
                    },
                  },
            );
          }

          nextFromBlock = latest + 1n;
        } catch {
          // retry next tick
        }
      }

      tick();
      const interval = setInterval(tick, POLL_MS);
      cancellers.push(() => {
        cancelled = true;
        clearInterval(interval);
      });
    }

    return () => cancellers.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceAddress, issuedAt, state.source]);

  // Phase 2: once we know which origin chain was funded, watch that chain's
  // SpokePool for the FundsDeposited event our smart account emitted, to
  // recover depositId.
  useEffect(() => {
    if (!state.source || state.bridgeSubmitted) return;
    const originChainId = state.source.chainId;
    const chain = CHAINS.find((c) => c.id === originChainId)!;

    const client = createPublicClient({
      chain,
      transport: fallback(
        RPC_URLS[chain.id].map((url) => http(url, { timeout: 10_000, retryCount: 1 })),
        { rank: false, retryCount: 1 },
      ),
    });

    let cancelled = false;
    let nextFromBlock: bigint | undefined;

    async function tick() {
      if (cancelled) return;
      try {
        let latest: bigint;
        if (nextFromBlock === undefined) {
          const latestBlock = await client.getBlock({ blockTag: "latest" });
          latest = latestBlock.number;
          // Bridge fires sometime after the source inflow — start scanning
          // from a little before issuedAt to be safe, same buffer as phase 1.
          nextFromBlock = estimateBlockAt(
            chain.id,
            latestBlock.number,
            latestBlock.timestamp,
            issuedAt - ISSUE_CLOCK_SKEW_MS,
          );
        } else {
          latest = await client.getBlockNumber();
        }
        if (nextFromBlock > latest) return;

        const fromBlock = nextFromBlock;
        const toBlock = latest;

        const deposits = await getEventsAdaptive(
          (f, t) =>
            client.getContractEvents({
              address: ACROSS_SPOKE[chain.id],
              abi: fundsDepositedEventAbi,
              eventName: "FundsDeposited",
              args: { depositor: addressToBytes32(invoiceAddress) },
              fromBlock: f,
              toBlock: t,
            }),
          fromBlock,
          toBlock,
        );

        if (deposits.length > 0) {
          const first = deposits[0];
          setState((prev) => ({
            ...prev,
            bridgeSubmitted: {
              chainId: chain.id,
              depositId: first.args.depositId!,
              txHash: first.transactionHash ?? undefined,
            },
          }));
        }

        nextFromBlock = latest + 1n;
      } catch {
        // retry next tick
      }
    }

    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.source, state.bridgeSubmitted, invoiceAddress, issuedAt]);

  // Phase 3: poll Across's /deposit/status with the recovered depositId.
  useEffect(() => {
    if (!state.bridgeSubmitted || state.complete) return;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const result = await fetchDepositStatus({
          originChainId: state.bridgeSubmitted!.chainId,
          depositId: state.bridgeSubmitted!.depositId,
        });
        if (result.status === "filled") {
          setState((prev) => ({
            ...prev,
            complete: { fillTx: result.fillTx, fillChainId: result.fillChainId },
          }));
        }
      } catch {
        // retry next tick
      }
    }

    tick();
    const interval = setInterval(tick, ACROSS_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bridgeSubmitted, state.complete]);

  return state;
}

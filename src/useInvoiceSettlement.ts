import { useEffect, useRef, useState } from "react";
import { createPublicClient, erc20Abi, fallback, http, type Address, type Hex } from "viem";
import { CHAINS, RPC_URLS, USDC, BLOCK_TIME_MS, type SupportedChainId } from "./chains";
import { triggerRelay, type Destination, type RelayResult } from "./relayApi";
import { fetchOneClickStatus, type OneClickStatus } from "./oneclickStatus";

export type InvoiceSettlement = {
  source?: { chainId: SupportedChainId; txHash?: Hex; amount?: bigint };
  relay?: RelayResult;
  oneClickStatus?: OneClickStatus;
  complete: boolean;
  // Set if a chain kept returning "no-balance" after we'd already seen an
  // inflow there — most likely means it was already relayed in a previous
  // session before this page load, and we don't have that session's
  // result to show. Not an error exactly, just "can't confirm the exact
  // outcome from here."
  unconfirmed?: boolean;
};

const POLL_MS = 8000;
const ONE_CLICK_POLL_MS = 5000;
const ISSUE_CLOCK_SKEW_MS = 60_000;
const RELAY_RETRY_LIMIT = 5;

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

export function useInvoiceSettlement(
  invoiceId: string,
  invoiceAddress: Address,
  issuedAt: number,
  destination: Destination,
): InvoiceSettlement {
  const [state, setState] = useState<InvoiceSettlement>({ complete: false });
  const relayAttempts = useRef<Map<SupportedChainId, number>>(new Map());
  const relayInFlight = useRef<Set<SupportedChainId>>(new Set());

  // Phase 1: watch all 3 chains for inflow to invoiceAddress.
  useEffect(() => {
    if (state.relay) return; // already got a relay result, stop scanning

    const cancellers: (() => void)[] = [];

    for (const chain of CHAINS) {
      const chainId = chain.id as SupportedChainId;
      const client = createPublicClient({
        chain,
        transport: fallback(
          RPC_URLS[chainId].map((url) => http(url, { timeout: 10_000, retryCount: 1 })),
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
              chainId,
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
                address: USDC[chainId],
                abi: erc20Abi,
                eventName: "Transfer",
                args: { to: invoiceAddress },
                fromBlock: f,
                toBlock: t,
              }),
            fromBlock,
            toBlock,
          );

          if (inflows.length > 0) {
            const first = inflows[0];
            setState((prev) =>
              prev.source
                ? prev
                : {
                    ...prev,
                    source: {
                      chainId,
                      txHash: first.transactionHash ?? undefined,
                      amount: first.args.value,
                    },
                  },
            );
            void maybeTriggerRelay(chainId);
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
  }, [invoiceAddress, issuedAt, state.relay]);

  async function maybeTriggerRelay(chainId: SupportedChainId) {
    if (relayInFlight.current.has(chainId)) return;
    const attempts = relayAttempts.current.get(chainId) ?? 0;
    if (attempts >= RELAY_RETRY_LIMIT) return;

    relayInFlight.current.add(chainId);
    relayAttempts.current.set(chainId, attempts + 1);

    try {
      const result = await triggerRelay({ invoiceId, chainId, destination });
      if (result.status === "relayed") {
        setState((prev) => ({ ...prev, relay: result }));
      } else if (attempts + 1 >= RELAY_RETRY_LIMIT) {
        setState((prev) => ({ ...prev, unconfirmed: true }));
      } else {
        setTimeout(() => {
          relayInFlight.current.delete(chainId);
          void maybeTriggerRelay(chainId);
        }, POLL_MS);
        return;
      }
    } catch {
      if (attempts + 1 < RELAY_RETRY_LIMIT) {
        setTimeout(() => {
          relayInFlight.current.delete(chainId);
          void maybeTriggerRelay(chainId);
        }, POLL_MS);
        return;
      }
    }
    relayInFlight.current.delete(chainId);
  }

  // Phase 2: same-chain relays are already complete. Cross-chain relays
  // need 1Click's own status polled until it reports SUCCESS.
  useEffect(() => {
    if (!state.relay || state.relay.status !== "relayed") return;

    if (state.relay.mode === "same-chain") {
      setState((prev) => ({ ...prev, complete: true }));
      return;
    }

    if (state.complete) return;

    let cancelled = false;
    const depositAddress = state.relay.oneClickDepositAddress;

    async function tick() {
      if (cancelled) return;
      try {
        const { status } = await fetchOneClickStatus(depositAddress);
        setState((prev) => ({ ...prev, oneClickStatus: status }));
        if (status === "SUCCESS") {
          setState((prev) => ({ ...prev, complete: true }));
        }
      } catch {
        // retry next tick
      }
    }

    tick();
    const interval = setInterval(tick, ONE_CLICK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.relay, state.complete]);

  return state;
}

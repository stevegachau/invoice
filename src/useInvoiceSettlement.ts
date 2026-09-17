import { useEffect, useRef, useState } from "react";
import { createPublicClient, erc20Abi, fallback, http, type Address, type Hex } from "viem";
import { CHAINS, RPC_URLS, USDC, BLOCK_TIME_MS, SETTLEMENT_CHAIN_ID, type SupportedChainId } from "./chains";
import { triggerRelay, type Destination, type RelayResult } from "./relayApi";
import { fetchBridgeStatus, type BridgeStatus } from "./bridgeStatus";

export type InvoiceSettlement = {
  source?: { chainId: SupportedChainId; txHash?: Hex; amount?: bigint };
  relay?: RelayResult;
  bridgeStatus?: BridgeStatus;
  // The real step-3 delivery tx on the destination chain, once Relay
  // reports it (confirmed live under swapDetails.destinationChainTxHashes)
  // — distinct from relay.relayTxHash, which for a cross-chain relay is
  // only the step-2 bridge deposit on the origin chain.
  destinationTxHash?: string;
  destinationAmountFormatted?: string;
  complete: boolean;
  // Set only if we saw a real inflow but couldn't resolve an outcome after
  // retrying — should be rare now that outbound transfers are also watched
  // (see below), since that recovers the outcome directly from chain
  // history without needing a cached relay result at all.
  unconfirmed?: boolean;
};

const POLL_MS = 8000;
const BRIDGE_POLL_MS = 5000;
const ISSUE_CLOCK_SKEW_MS = 60_000;
const RELAY_RETRY_LIMIT = 2;

// Fixed, conservative chunk size — no fan-out. The previous version
// recursively halved the range in parallel (Promise.all) on any failure,
// which on a large initial catch-up window could fire many simultaneous
// requests at once. This scans sequentially, one chunk at a time: slower
// for a big catch-up range (only happens once, on first mount), but never
// a burst. Steady-state ticks after that are tiny (a few seconds' worth
// of blocks) and need only one request.
const LOG_CHUNK_BLOCKS = 2000n;

async function scanLogsSequential<T>(
  fetchFn: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<T[]> {
  const results: T[] = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end =
      cursor + LOG_CHUNK_BLOCKS - 1n < toBlock ? cursor + LOG_CHUNK_BLOCKS - 1n : toBlock;
    const chunk = await fetchFn(cursor, end);
    results.push(...chunk);
    if (results.length > 0) break; // found what we need this tick
    cursor = end + 1n;
  }
  return results;
}

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

export function useInvoiceSettlement(
  invoiceId: string,
  invoiceAddress: Address,
  issuedAt: number,
  destination: Destination,
  cachedRelay?: RelayResult,
): InvoiceSettlement {
  const [state, setState] = useState<InvoiceSettlement>(() => {
    if (!cachedRelay || cachedRelay.status !== "relayed") return { complete: false };
    return {
      relay: cachedRelay,
      source: { chainId: cachedRelay.chainId, amount: BigInt(cachedRelay.amount) },
      // Same-chain (Arc->Arc via Arcus) is done the moment it's relayed. A
      // cross-chain relay isn't complete until Relay confirms the Arc-side
      // fill — the bridge-status effect below picks that up.
      complete: cachedRelay.mode === "same-chain",
    };
  });
  const relayAttempts = useRef<Map<SupportedChainId, number>>(new Map());
  const relayInFlight = useRef<Set<SupportedChainId>>(new Set());

  // Watches BOTH directions on all 3 chains: inflow (to invoiceAddress) for
  // step 1, and outflow (from invoiceAddress) to detect a relay that
  // already happened — even with zero cached state. An outbound transfer
  // is just as permanent a fact on-chain as an inbound one, so this makes
  // settlement state fully re-derivable from the chain (+ Relay) alone,
  // rather than depending on the hash having captured the result. For a
  // cross-chain relay, the outbound's `to` address IS the Relay deposit
  // address — recovered directly, no separate lookup needed.
  useEffect(() => {
    if (state.relay) return; // already resolved, stop scanning

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

          const [inflows, outflows] = await Promise.all([
            scanLogsSequential(
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
            ),
            scanLogsSequential(
              (f, t) =>
                client.getContractEvents({
                  address: USDC[chainId],
                  abi: erc20Abi,
                  eventName: "Transfer",
                  args: { from: invoiceAddress },
                  fromBlock: f,
                  toBlock: t,
                }),
              fromBlock,
              toBlock,
            ),
          ]);

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
          }

          if (outflows.length > 0) {
            // An outbound transfer means the balance was already relayed.
            // Recovered directly from chain history, so settlement state is
            // re-derivable even with zero cached state.
            //   - origin is Arc + `to` is the merchant  -> same-chain
            //     settle (via Arcus). Complete: this IS the final tx.
            //   - otherwise -> cross-chain: `to` is the Relay deposit
            //     address that bridges to Arc.
            const first = outflows[0];
            const outAmount = first.args.value ?? 0n;
            const toAddr = first.args.to as Address;
            const isSameChainDirect =
              Number(chainId) === SETTLEMENT_CHAIN_ID &&
              toAddr.toLowerCase() === destination.address.toLowerCase();

            setState((prev) => {
              if (prev.relay) return prev;
              const withSource = prev.source
                ? prev
                : { ...prev, source: { chainId, amount: outAmount } };

              if (isSameChainDirect) {
                return {
                  ...withSource,
                  relay: {
                    status: "relayed",
                    mode: "same-chain",
                    chainId,
                    address: invoiceAddress,
                    amount: outAmount.toString(),
                    relayTxHash: first.transactionHash ?? "",
                  },
                  complete: true,
                };
              }

              return {
                ...withSource,
                relay: {
                  status: "relayed",
                  mode: "cross-chain",
                  chainId,
                  address: invoiceAddress,
                  amount: outAmount.toString(),
                  relayTxHash: first.transactionHash ?? "",
                  bridgeDepositAddress: toAddr,
                },
                complete: false,
              };
            });
          } else if (inflows.length > 0) {
            // Inflow seen, no outflow yet — actively trigger a relay
            // rather than just waiting to notice one.
            void maybeTriggerRelay(chainId);
          } else if (Number(chainId) === SETTLEMENT_CHAIN_ID) {
            // Arc balance fallback. On Arc, USDC is the native gas asset, so
            // a payer's "send USDC" is a plain value transfer that emits NO
            // ERC-20 Transfer event on 0x3600 (that contract is a view over
            // the native balance). The log scan above therefore never sees
            // an Arc deposit — so check the live balance directly and treat
            // any funds sitting here as an inflow to relay.
            const bal = await client.readContract({
              address: USDC[chainId],
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [invoiceAddress],
            });
            if (bal > 0n) {
              setState((prev) =>
                prev.source ? prev : { ...prev, source: { chainId, amount: bal } },
              );
              void maybeTriggerRelay(chainId);
            }
          }

          nextFromBlock = latest + 1n;
        } catch {
          // retry next tick, same nextFromBlock
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
        // Same-chain (Arc->Arc) is settled the moment this returns; a
        // cross-chain relay still needs its Arc-side fill confirmed, so
        // leave `complete` for the bridge-status effect.
        setState((prev) =>
          prev.relay
            ? prev
            : { ...prev, relay: result, complete: result.mode === "same-chain" },
        );
      } else if (attempts + 1 >= RELAY_RETRY_LIMIT) {
        // Kept saying no-balance after we saw a real inflow. The outbound
        // scan above is the real safety net now — this only fires if that
        // somehow hasn't caught up yet either.
        setState((prev) => (prev.relay ? prev : { ...prev, unconfirmed: true }));
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

  // Cross-chain relays need Relay's status polled by deposit address until
  // it reports the Arc-side fill as "success". Same-chain (Arc->Arc) is
  // already complete when detected, so there's nothing to poll.
  useEffect(() => {
    if (!state.relay || state.relay.status !== "relayed") return;
    if (state.relay.mode === "same-chain" || state.complete) return;

    let cancelled = false;
    const depositAddress = state.relay.bridgeDepositAddress;

    async function tick() {
      if (cancelled) return;
      try {
        const result = await fetchBridgeStatus(depositAddress);
        setState((prev) => ({
          ...prev,
          bridgeStatus: result.status,
          destinationTxHash: result.destinationTxHash ?? prev.destinationTxHash,
          destinationAmountFormatted:
            result.amountOutFormatted ?? prev.destinationAmountFormatted,
        }));
        if (result.status === "success") {
          setState((prev) => ({ ...prev, complete: true }));
        }
      } catch {
        // retry next tick
      }
    }

    tick();
    const interval = setInterval(tick, BRIDGE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.relay, state.complete]);

  return state;
}

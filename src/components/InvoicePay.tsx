import { useEffect, useState } from "react";
import {
  createPublicClient,
  erc20Abi,
  fallback,
  formatUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  Clock,
  Copy,
  ExternalLink,
  Hourglass,
  Link2,
  Loader2,
  PlaneLanding,
  ShieldCheck,
  Timer,
  User,
  Zap,
} from "lucide-react";
import {
  BLOCK_TIME_MS,
  CHAINS,
  CHAIN_LABEL,
  RPC_URLS,
  USDC,
  type SupportedChainId,
} from "../chains";
import type { IssuedInvoice } from "../invoice";
import { GateDot, GateBadge, gateLetter } from "./GateBadge";
import { SplitFlap } from "./SplitFlap";
import { buildShareUrl } from "../share";

export function InvoicePay({
  issued,
  onBack,
}: {
  issued: IssuedInvoice;
  onBack: () => void;
}) {
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const amountStr = formatUnits(issued.invoice.amount, 6);
  const destLabel = CHAIN_LABEL[issued.invoice.destinationChainId];
  const destChainId = issued.invoice.destinationChainId;

  const expired = useExpired(issued.expiresAt);
  const settlement = useSettlement(
    destChainId,
    issued.invoiceAddress,
    issued.invoice.payeeAddress,
    issued.issuedAt,
  );
  const complete = !!settlement.complete;
  const status: "paid" | "awaiting" | "expired" = complete
    ? "paid"
    : expired
      ? "expired"
      : "awaiting";

  async function handleCopyAddr() {
    await navigator.clipboard.writeText(issued.invoiceAddress);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(buildShareUrl(issued));
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-ink transition"
        >
          <ArrowLeft className="h-4 w-4" />
          New invoice
        </button>
        <button
          onClick={handleCopyLink}
          className={
            "inline-flex items-center gap-2 h-9 px-4 rounded-full text-sm font-medium transition " +
            (copiedLink
              ? "bg-green-500 text-bg"
              : "bg-surface border border-line text-ink hover:border-ink-faint hover:bg-surface-2")
          }
        >
          {copiedLink ? (
            <>
              <Check className="h-4 w-4" />
              Link copied
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4" />
              Copy share link
            </>
          )}
        </button>
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6 items-start">
        <InvoiceDocument
          issued={issued}
          amountStr={amountStr}
          destLabel={destLabel}
          destChainId={destChainId}
          status={status}
          copiedAddr={copiedAddr}
          onCopyAddr={handleCopyAddr}
        />

        <aside className="space-y-4 lg:sticky lg:top-20">
          {complete ? (
            <PaidCard
              destChainId={destChainId}
              amount={settlement.complete?.amount}
            />
          ) : (
            <ExpiryCard expiresAt={issued.expiresAt} expired={expired} />
          )}
          <SettlementProgress
            settlement={settlement}
            destChainId={destChainId}
          />
          <AutopayNote />
          <SecurityNote />
        </aside>
      </div>
    </div>
  );
}

function useExpired(expiresAt: number) {
  const [expired, setExpired] = useState(() => Date.now() >= expiresAt);
  useEffect(() => {
    if (expired) return;
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      setExpired(true);
      return;
    }
    const t = setTimeout(() => setExpired(true), ms);
    return () => clearTimeout(t);
  }, [expired, expiresAt]);
  return expired;
}

type Step = { txHash?: Hex; amount?: bigint };

export type Settlement = {
  source?: { chainId: SupportedChainId } & Step;
  destination?: Step;
  complete?: Step;
};

const SETTLEMENT_POLL_MS = 8000;
const ISSUE_CLOCK_SKEW_MS = 60_000;

// Adaptive log query — try the full range, halve on RPC range-limit error.
// Lets us scan a 24h window on Arbitrum (~345k blocks) without hardcoding
// chunk sizes per RPC.
async function getEventsAdaptive<T>(
  fetch: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  minRange = 100n,
): Promise<T[]> {
  if (fromBlock > toBlock) return [];
  try {
    return await fetch(fromBlock, toBlock);
  } catch (e) {
    const range = toBlock - fromBlock;
    if (range <= minRange) throw e;
    const mid = fromBlock + range / 2n;
    const [left, right] = await Promise.all([
      getEventsAdaptive(fetch, fromBlock, mid, minRange),
      getEventsAdaptive(fetch, mid + 1n, toBlock, minRange),
    ]);
    return [...left, ...right];
  }
}

// Translate a unix-ms timestamp into an approximate block number using the
// known average block time for the chain. Used as a lower bound for the
// historical scan so we don't query unbounded ranges.
function estimateBlockAt(
  chainId: SupportedChainId,
  latestBlock: bigint,
  latestTimestampSec: bigint,
  timestampMs: number,
): bigint {
  const elapsedMs = Math.max(
    0,
    Number(latestTimestampSec) * 1000 - timestampMs,
  );
  const blocksBack = BigInt(Math.floor(elapsedMs / BLOCK_TIME_MS[chainId]));
  return latestBlock > blocksBack ? latestBlock - blocksBack : 0n;
}

// Persist final settlement state per invoice address. Once complete the
// chain-of-truth is immutable, so we cache to avoid re-scanning on revisit.
function loadCachedSettlement(invoiceAddress: string): Settlement | null {
  try {
    const raw = localStorage.getItem(`settlement:${invoiceAddress}`);
    if (!raw) return null;
    const w = JSON.parse(raw) as {
      source?: { chainId: SupportedChainId; txHash?: Hex; amount?: string };
      destination?: { txHash?: Hex; amount?: string };
      complete?: { txHash?: Hex; amount?: string };
    };
    const rev = <T extends { amount?: string }>(s: T | undefined) =>
      s
        ? {
            ...s,
            amount: s.amount !== undefined ? BigInt(s.amount) : undefined,
          }
        : undefined;
    return {
      source: rev(w.source),
      destination: rev(w.destination),
      complete: rev(w.complete),
    };
  } catch {
    return null;
  }
}

function saveCachedSettlement(invoiceAddress: string, settlement: Settlement) {
  if (!settlement.complete) return;
  try {
    const ser = <T extends { amount?: bigint }>(s: T | undefined) =>
      s
        ? {
            ...s,
            amount: s.amount !== undefined ? s.amount.toString() : undefined,
          }
        : undefined;
    const wire = {
      source: ser(settlement.source),
      destination: ser(settlement.destination),
      complete: ser(settlement.complete),
    };
    localStorage.setItem(`settlement:${invoiceAddress}`, JSON.stringify(wire));
  } catch {
    // localStorage may be disabled — silently ignore.
  }
}

// Watch USDC Transfer events on every chain to track the three on-chain
// checkpoints that constitute a complete settlement:
//   1. source       — first inflow to the invoice's smart account on any chain
//   2. destination  — first inflow on the destination chain (same event as
//                     source for direct same-chain payments)
//   3. complete     — outflow from the smart account on dest to the payee
//
// Once `complete` lands we cache the result in localStorage. Re-opening the
// same invoice link surfaces the settled state instantly; the underlying
// scan is still authoritative if the cache is missing.
function useSettlement(
  destChainId: SupportedChainId,
  invoiceAddress: Address,
  payeeAddress: Address,
  issuedAt: number,
): Settlement {
  const [state, setState] = useState<Settlement>(
    () => loadCachedSettlement(invoiceAddress) ?? {},
  );

  useEffect(() => {
    if (state.complete) {
      saveCachedSettlement(invoiceAddress, state);
      return;
    }

    const cancellers: (() => void)[] = [];

    for (const chain of CHAINS) {
      const client = createPublicClient({
        chain,
        transport: fallback(
          RPC_URLS[chain.id].map((url) =>
            http(url, { timeout: 10_000, retryCount: 1 }),
          ),
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
            // First tick: scan from issuedAt onward. Since these are
            // one-time addresses, the events are guaranteed to be in this
            // window — the supertx can't fire after expiry. Settled
            // invoices stay settled forever.
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

          // Inflow: anything arriving at the smart account.
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

          // Outflow to payee: only meaningful on dest chain.
          const outflows =
            chain.id === destChainId
              ? await getEventsAdaptive(
                  (f, t) =>
                    client.getContractEvents({
                      address: USDC[chain.id],
                      abi: erc20Abi,
                      eventName: "Transfer",
                      args: { from: invoiceAddress, to: payeeAddress },
                      fromBlock: f,
                      toBlock: t,
                    }),
                  fromBlock,
                  toBlock,
                )
              : [];

          if (cancelled) return;

          if (inflows.length > 0 || outflows.length > 0) {
            setState((prev) => {
              let next = prev;
              if (inflows.length > 0) {
                const first = inflows[0];
                const step = {
                  txHash: first.transactionHash ?? undefined,
                  amount: first.args.value,
                };
                if (!next.source) {
                  next = {
                    ...next,
                    source: { chainId: chain.id, ...step },
                  };
                }
                if (chain.id === destChainId && !next.destination) {
                  next = { ...next, destination: step };
                }
              }
              if (outflows.length > 0 && !next.complete) {
                const first = outflows[0];
                next = {
                  ...next,
                  complete: {
                    txHash: first.transactionHash ?? undefined,
                    amount: first.args.value,
                  },
                };
              }
              return next;
            });
          }

          nextFromBlock = latest + 1n;
        } catch {
          // RPC hiccup — next tick retries from the same fromBlock.
        }
      }

      tick();
      const interval = setInterval(tick, SETTLEMENT_POLL_MS);
      cancellers.push(() => {
        cancelled = true;
        clearInterval(interval);
      });
    }

    return () => cancellers.forEach((c) => c());
    // We only re-run when completion flips — partial state updates shouldn't
    // tear down the pollers. The cache save in the early return reads the
    // latest state at the time of re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destChainId, invoiceAddress, payeeAddress, issuedAt, state.complete]);

  return state;
}

function InvoiceDocument({
  issued,
  amountStr,
  destLabel,
  destChainId,
  status,
  copiedAddr,
  onCopyAddr,
}: {
  issued: IssuedInvoice;
  amountStr: string;
  destLabel: string;
  destChainId: SupportedChainId;
  status: "paid" | "awaiting" | "expired";
  copiedAddr: boolean;
  onCopyAddr: () => void;
}) {
  return (
    <article className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-amber-500/[0.06] via-surface to-surface" />
      <div className="absolute top-6 right-6 opacity-[0.05] text-ink font-display font-semibold text-6xl tracking-tighter pointer-events-none select-none">
        BOARDING
      </div>

      <div className="relative px-8 pt-8 pb-6 border-b border-dashed border-line">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
              <CircleDollarSign className="h-3.5 w-3.5" />
              Manifest · {issued.invoiceNumber}
            </div>
            <h1 className="font-display mt-3 text-2xl font-semibold tracking-tight text-ink">
              {issued.meta.companyName || "Untitled invoice"}
            </h1>
            {issued.meta.description && (
              <p className="mt-1 text-sm text-ink-dim max-w-md">
                {issued.meta.description}
              </p>
            )}
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="mt-7 grid sm:grid-cols-3 gap-5 text-sm">
          <Meta
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="From"
            value={issued.meta.companyName || "—"}
          />
          <Meta
            icon={<User className="h-3.5 w-3.5" />}
            label="Bill to"
            value={
              <span className="font-mono text-xs">
                {short(issued.invoice.payeeAddress)}
              </span>
            }
            title={issued.invoice.payeeAddress}
          />
          <Meta
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Filed"
            value={new Date(issued.issuedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
        </div>
      </div>

      <div className="relative px-8 py-8 grid sm:grid-cols-[1.2fr_1fr] gap-6 items-end border-b border-dashed border-line">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
            Amount due
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-ink-faint text-3xl font-medium font-mono">
              $
            </span>
            <span className="font-mono text-[64px] leading-none font-semibold tracking-tight text-ink tabular">
              {formatNumber(amountStr)}
            </span>
            <span className="ml-1 text-sm font-medium text-ink-dim">
              USDC
            </span>
          </div>
        </div>
        <div className="sm:text-right">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
            Destination
          </div>
          <div className="mt-2 inline-flex">
            <GateBadge id={destChainId} size="lg" active />
          </div>
        </div>
      </div>

      <div className="relative px-8 py-7 border-b border-dashed border-line">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
              Send USDC to this address
            </div>
            <div className="mt-1 text-sm text-ink-dim">
              Pay from any gate below — funds auto-land on {destLabel} the
              moment they touch down.
            </div>
          </div>
          <span className="hidden sm:inline-flex h-9 w-9 rounded-md bg-amber-50 text-amber-400 items-center justify-center shrink-0">
            <PlaneLanding className="h-4 w-4" />
          </span>
        </div>

        <div className="rounded-xl border border-dashed border-line bg-bg p-4 flex items-center gap-3">
          <code className="flex-1 min-w-0 break-all font-mono text-[13px] sm:text-sm text-ink leading-relaxed">
            {issued.invoiceAddress}
          </code>
          <button
            onClick={onCopyAddr}
            className={
              "shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium transition " +
              (copiedAddr
                ? "bg-green-500 text-bg"
                : "bg-surface border border-line text-ink-dim hover:border-ink-faint hover:bg-surface-2")
            }
          >
            {copiedAddr ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      <div className="relative px-8 py-7">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
            Open gates
          </div>
          <div className="text-[11px] text-ink-faint">USDC only</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {CHAINS.map((c) => (
            <GateBadge key={c.id} id={c.id} active={c.id === destChainId} />
          ))}
        </div>
      </div>

      <div className="relative border-t border-dashed border-line px-8 py-4 flex items-center justify-between text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Settled gaslessly across chains
        </span>
        <span className="font-mono">v1</span>
      </div>
    </article>
  );
}

function PaidCard({
  destChainId,
  amount,
}: {
  destChainId: SupportedChainId;
  amount?: bigint;
}) {
  return (
    <div className="rounded-2xl border border-green-500/30 bg-green-50 p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-green-300 mb-3">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Landed
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular text-ink font-mono">
        {amount !== undefined ? formatUnits(amount, 6) : "—"}{" "}
        <span className="text-base font-medium text-ink-dim">USDC</span>
      </div>
      <div className="mt-1 text-xs text-ink-dim leading-relaxed">
        Settled to the payee on {CHAIN_LABEL[destChainId]}.
      </div>
    </div>
  );
}

function ExpiryCard({
  expiresAt,
  expired,
}: {
  expiresAt: number;
  expired: boolean;
}) {
  const remaining = useCountdown(expiresAt);
  return (
    <div
      className={
        "rounded-2xl border p-6 " +
        (expired
          ? "bg-red-50 border-red-500/30"
          : "bg-surface border-line")
      }
    >
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-3">
        {expired ? (
          <Hourglass className="h-3.5 w-3.5" />
        ) : (
          <Timer className="h-3.5 w-3.5" />
        )}
        {expired ? "Window closed" : "Boarding closes in"}
      </div>
      <div
        className={
          "text-2xl font-semibold tracking-tight tabular font-mono " +
          (expired ? "text-red-300" : "text-ink")
        }
      >
        {expired ? "00:00:00" : remaining}
      </div>
      <div className="mt-1 text-xs text-ink-faint leading-relaxed">
        {expired
          ? "The 24h pre-signed window passed. The supertx will no longer execute — issue a fresh invoice to retry."
          : "Pay before the window closes. After expiry the pre-signed supertx is no longer valid."}
      </div>
    </div>
  );
}

function useCountdown(target: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  return formatDuration(Math.max(0, target - now));
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function AutopayNote() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-3">
        <Zap className="h-3.5 w-3.5" />
        Auto-settlement
      </div>
      <p className="text-sm text-ink-dim leading-relaxed">
        We pre-signed a single{" "}
        <span className="font-medium text-ink">supertransaction</span>{" "}
        spanning every gate at issue time. Each instruction waits on a
        runtime{" "}
        <code className="px-1 py-0.5 rounded bg-surface-2 text-[12px] font-mono text-ink">
          balanceOf ≥ amount
        </code>{" "}
        check, so whichever gate receives the USDC first fires the matching
        bridge or transfer. The signing key was discarded immediately after.
      </p>
    </div>
  );
}

function SettlementProgress({
  settlement,
  destChainId,
}: {
  settlement: Settlement;
  destChainId: SupportedChainId;
}) {
  const sourceChainId = settlement.source?.chainId;
  const sameChain = sourceChainId === destChainId;
  const sourceLabel = sourceChainId
    ? `Gate ${gateLetter(sourceChainId)} · ${CHAIN_LABEL[sourceChainId]}`
    : "any gate";
  const destLabel = `Gate ${gateLetter(destChainId)} · ${CHAIN_LABEL[destChainId]}`;

  const boardStatus = settlement.complete
    ? "LANDED"
    : settlement.destination
      ? "FORWARDING"
      : settlement.source
        ? "IN TRANSIT"
        : "AWAITING";

  const boardTone =
    boardStatus === "LANDED"
      ? "green"
      : boardStatus === "AWAITING"
        ? "ink"
        : "amber";

  // Render order matters — the active one (next pending) animates a spinner.
  const steps: ProgressStepProps[] = [
    {
      done: !!settlement.source,
      title: settlement.source
        ? `Funds received at ${sourceLabel}`
        : "Waiting for funds",
      detail: settlement.source
        ? formatAmount(settlement.source.amount)
        : `Send USDC to ${sourceLabel}`,
      chainId: sourceChainId,
      txHash: settlement.source?.txHash,
    },
    {
      done: !!settlement.destination,
      title:
        sameChain && settlement.destination
          ? `Same gate — already at ${destLabel}`
          : `Touched down at ${destLabel}`,
      detail: settlement.destination
        ? formatAmount(settlement.destination.amount)
        : sameChain && settlement.source
          ? "—"
          : "Bridging…",
      chainId: destChainId,
      txHash: settlement.destination?.txHash,
      muted: sameChain && !!settlement.destination,
    },
    {
      done: !!settlement.complete,
      title: "Forwarded to payee",
      detail: settlement.complete
        ? formatAmount(settlement.complete.amount)
        : settlement.destination
          ? "Forwarding…"
          : "Pending",
      chainId: destChainId,
      txHash: settlement.complete?.txHash,
    },
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
          <PlaneLanding className="h-3.5 w-3.5" />
          Status board
        </div>
      </div>
      <div className="mb-5">
        <SplitFlap text={boardStatus} tone={boardTone} />
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const prevDone = i === 0 || steps[i - 1].done;
          const active = !s.done && prevDone && !settlement.complete;
          return <ProgressStep key={i} {...s} active={active} />;
        })}
      </ol>
    </div>
  );
}

type ProgressStepProps = {
  done: boolean;
  title: string;
  detail: string;
  chainId?: SupportedChainId;
  txHash?: Hex;
  muted?: boolean;
};

function ProgressStep({
  done,
  active,
  title,
  detail,
  chainId,
  txHash,
  muted,
}: ProgressStepProps & { active?: boolean }) {
  const explorerUrl =
    chainId !== undefined && txHash ? explorerTxUrl(chainId, txHash) : undefined;
  return (
    <li className="flex items-start gap-3">
      <span className="shrink-0 mt-0.5 h-5 w-5 inline-flex items-center justify-center">
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        ) : active ? (
          <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
        ) : (
          <Circle className="h-4 w-4 text-ink-faint" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={
            "text-sm font-medium " +
            (done ? "text-ink" : muted ? "text-ink-faint" : "text-ink-dim")
          }
        >
          {title}
        </div>
        <div className="mt-0.5 text-xs text-ink-dim inline-flex items-center gap-1.5">
          {chainId !== undefined && <GateDot id={chainId} />}
          <span className="tabular font-mono">{detail}</span>
        </div>
        {explorerUrl && txHash && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium"
            title={txHash}
          >
            <span className="font-mono">{shortHash(txHash)}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </li>
  );
}

function formatAmount(amount?: bigint): string {
  if (amount === undefined) return "—";
  return `${formatUnits(amount, 6)} USDC`;
}

function explorerTxUrl(
  chainId: SupportedChainId,
  txHash: Hex,
): string | undefined {
  const chain = CHAINS.find((c) => c.id === chainId);
  const base = chain?.blockExplorers?.default.url;
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}

function shortHash(hash: Hex): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function SecurityNote() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-3">
        <ShieldCheck className="h-3.5 w-3.5" />
        Security
      </div>
      <p className="text-sm text-ink-dim leading-relaxed">
        The invoice address is an{" "}
        <span className="font-medium text-ink">ephemeral smart account</span>{" "}
        whose signing key has been deleted. Funds can only flow along the
        pre-signed routes to the payee — nothing else can be done from this
        address.
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: "paid" | "awaiting" | "expired" }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full ring-1 ring-green-500/30 bg-green-50 text-green-300 text-xs font-mono font-medium uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        <CheckCircle2 className="h-3.5 w-3.5" />
        Landed
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full ring-1 ring-red-500/30 bg-red-50 text-red-300 text-xs font-mono font-medium uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        <Hourglass className="h-3.5 w-3.5" />
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full ring-1 ring-amber-500/30 bg-amber-50 text-amber-300 text-xs font-mono font-medium uppercase tracking-wider">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 pulse-dot" />
      </span>
      <ArrowUpRight className="h-3.5 w-3.5" />
      Awaiting payment
    </span>
  );
}

function Meta({
  icon,
  label,
  value,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-ink" title={title}>
        {value}
      </div>
    </div>
  );
}

function short(s: string) {
  return s.slice(0, 6) + "…" + s.slice(-4);
}

function formatNumber(s: string) {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

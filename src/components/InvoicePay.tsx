import { useEffect, useState } from "react";
import { formatUnits } from "viem";
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
  Link2,
  Loader2,
  Plane,
  PlaneLanding,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { CHAINS, CHAIN_LABEL, type SupportedChainId } from "../chains";
import type { IssuedInvoice } from "../invoice";
import type { Destination, RelayResult } from "../relayApi";
import { GateDot, GateBadge, gateLetter, SOLANA_GATE_ID, type GateId } from "./GateBadge";
import { SplitFlap } from "./SplitFlap";
import { buildShareUrl, encodeInvoiceHash } from "../share";
import { useInvoiceSettlement } from "../useInvoiceSettlement";

export function InvoicePay({
  issued,
  cachedRelay,
  onBack,
}: {
  issued: IssuedInvoice;
  cachedRelay?: RelayResult;
  onBack: () => void;
}) {
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const amountStr = formatUnits(issued.invoice.amount, 6);
  const destination = issued.invoice.destination;
  const destGateId: GateId =
    destination.type === "solana" ? SOLANA_GATE_ID : destination.chainId;

  const settlement = useInvoiceSettlement(
    issued.invoiceId,
    issued.invoiceAddress,
    issued.issuedAt,
    destination,
    cachedRelay,
  );
  const complete = settlement.complete;
  const relay = settlement.relay ?? cachedRelay;

  // Persist the relay result into the URL hash so reopening the link
  // reflects it — and re-persist once `complete` flips true, so a fully
  // settled invoice shows "Landed" instantly on reopen instead of forcing
  // a fresh 1Click poll every single time.
  useEffect(() => {
    if (settlement.relay && settlement.relay.status === "relayed") {
      window.location.hash = "#" + encodeInvoiceHash(issued, settlement.relay);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlement.relay, settlement.complete]);

  async function handleCopyAddr() {
    await navigator.clipboard.writeText(issued.invoiceAddress);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(buildShareUrl(issued, relay));
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  }

  const status: "paid" | "awaiting" = complete ? "paid" : "awaiting";
  const originGateId: GateId | undefined = complete
    ? settlement.source?.chainId
    : undefined;

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
          destGateId={destGateId}
          originGateId={originGateId}
          status={status}
          copiedAddr={copiedAddr}
          onCopyAddr={handleCopyAddr}
        />

        <aside className="space-y-4 lg:sticky lg:top-20">
          {complete ? (
            <PaidCard
              relay={relay}
              destination={destination}
              destinationTxHash={settlement.destinationTxHash}
              destinationAmountFormatted={settlement.destinationAmountFormatted}
            />
          ) : (
            <StatusNote unconfirmed={settlement.unconfirmed} />
          )}
          <SettlementProgress settlement={settlement} destGateId={destGateId} />
        </aside>
      </div>
    </div>
  );
}

function StatusNote({ unconfirmed }: { unconfirmed?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-3">
        <Timer className="h-3.5 w-3.5" />
        {unconfirmed ? "Couldn't confirm" : "Awaiting payment"}
      </div>
      {unconfirmed ? (
        <p className="text-sm text-ink-dim leading-relaxed">
          We saw funds arrive but couldn't confirm the outcome from this
          session — it may already have been forwarded in an earlier visit
          to this page. Check the destination address directly, or reissue
          if you're unsure.
        </p>
      ) : (
        <p className="text-sm text-ink-dim leading-relaxed">
          No expiry, no pre-signed window — send whenever you're ready and
          it'll be picked up and forwarded automatically.
        </p>
      )}
    </div>
  );
}

function InvoiceDocument({
  issued,
  amountStr,
  destGateId,
  originGateId,
  status,
  copiedAddr,
  onCopyAddr,
}: {
  issued: IssuedInvoice;
  amountStr: string;
  destGateId: GateId;
  originGateId?: GateId;
  status: "paid" | "awaiting";
  copiedAddr: boolean;
  onCopyAddr: () => void;
}) {
  const destination = issued.invoice.destination;
  const payeeDisplay = destination.address;

  return (
    <article className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-amber-500/[0.06] via-surface to-surface" />
      <div className="absolute top-6 right-6 opacity-[0.05] text-ink font-display font-semibold text-6xl tracking-tighter pointer-events-none select-none">
        ARRIVALS
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
            icon={<CircleDollarSign className="h-3.5 w-3.5" />}
            label="Bill to"
            value={<span className="font-mono text-xs">{short(payeeDisplay)}</span>}
            title={payeeDisplay}
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
            <span className="text-ink-faint text-3xl font-medium font-mono">$</span>
            <span className="font-mono text-[64px] leading-none font-semibold tracking-tight text-ink tabular">
              {formatNumber(amountStr)}
            </span>
            <span className="ml-1 text-sm font-medium text-ink-dim">USDC</span>
          </div>
        </div>
        <div className="sm:text-right">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
            Destination
          </div>
          <div className="mt-2 inline-flex">
            <GateBadge id={destGateId} size="lg" active />
          </div>
        </div>
        <EdgeNotches />
      </div>

      {originGateId !== undefined && (
        <div className="relative px-8 py-6 border-b border-dashed border-line">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-3">
            Route
          </div>
          <div className="flex items-center gap-3">
            <GateBadge id={originGateId} size="lg" tone="origin" active />
            <div className="relative flex-1 h-5 min-w-[48px]">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-line" />
              <Plane
                aria-hidden
                className="route-plane h-3.5 w-3.5 text-[#5b8cff] -rotate-45"
              />
            </div>
            <GateBadge id={destGateId} size="lg" active />
          </div>
        </div>
      )}

      {status === "paid" ? (
        <div className="relative px-8 py-7 border-b border-dashed border-line">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
            Invoice settled
          </div>
          <div className="mt-1 text-sm text-ink-dim">
            This invoice has been paid and forwarded. The deposit address
            below is no longer monitored — don't send anything else to it.
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-line bg-bg p-4">
            <code className="block break-all font-mono text-[13px] sm:text-sm text-ink-faint leading-relaxed">
              {issued.invoiceAddress}
            </code>
          </div>
        </div>
      ) : (
        <>
          <div className="relative px-8 py-7 border-b border-dashed border-line">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
                  Send USDC to this address
                </div>
                <div className="mt-1 text-sm text-ink-dim">
                  Pay from any gate below — funds forward to the recipient's
                  preferred network the moment they arrive.
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
                <GateBadge key={c.id} id={c.id} />
              ))}
            </div>
          </div>
        </>
      )}

      <div className="relative border-t border-dashed border-line px-8 py-4 flex items-center justify-between text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Self-routing across chains
        </span>
        <span className="font-mono">v2</span>
      </div>
    </article>
  );
}

function EdgeNotches() {
  return (
    <>
      <span className="absolute left-0 bottom-0 -translate-x-1/2 translate-y-1/2 h-5 w-5 rounded-full bg-bg" />
      <span className="absolute right-0 bottom-0 translate-x-1/2 translate-y-1/2 h-5 w-5 rounded-full bg-bg" />
    </>
  );
}

function PaidCard({
  relay,
  destination,
  destinationTxHash,
  destinationAmountFormatted,
}: {
  relay?: RelayResult;
  destination: Destination;
  destinationTxHash?: string;
  destinationAmountFormatted?: string;
}) {
  if (!relay || relay.status !== "relayed") return null;

  const recipientLabel =
    destination.type === "solana" ? "Solana" : CHAIN_LABEL[destination.chainId];

  // Same-chain: relayTxHash IS the final transfer. Cross-chain: use the
  // real destination-chain tx (swapDetails.destinationChainTxHashes from
  // 1Click's /v0/status — confirmed live against a real completed
  // invoice), not the origin-chain relay/deposit hash.
  const finalTxHash = relay.mode === "same-chain" ? relay.relayTxHash : destinationTxHash;

  // Same-chain: no bridging fee at all, the full relayed amount lands
  // exactly. Cross-chain: use 1Click's confirmed net amount once
  // available (swapDetails.amountOutFormatted), since that's after their
  // bridging fee — falls back to the relay's own amount if not loaded yet.
  const landedAmountFormatted =
    relay.mode === "same-chain"
      ? formatUnits(BigInt(relay.amount), 6)
      : (destinationAmountFormatted ?? formatUnits(BigInt(relay.amount), 6));

  const finalLink = (() => {
    if (!finalTxHash) return undefined;
    if (destination.type === "solana") {
      return `https://solscan.io/tx/${finalTxHash}`;
    }
    const chain = CHAINS.find((c) => c.id === destination.chainId);
    const base = chain?.blockExplorers?.default.url.replace(/\/$/, "");
    return base ? `${base}/tx/${finalTxHash}` : undefined;
  })();

  return (
    <div className="rounded-2xl border border-green-500/30 bg-green-50 p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-green-300 mb-3">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Landed
      </div>
      <div className="text-sm text-ink-dim leading-relaxed">
        {landedAmountFormatted} USDC forwarded to the payee on {recipientLabel}.
      </div>
      <div className="mt-3 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
        Paid to
      </div>
      <div className="mt-1 font-mono text-xs text-ink break-all">
        {destination.address}
      </div>
      {finalLink && (
        <a
          href={finalLink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium"
        >
          View final transaction
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function SettlementProgress({
  settlement,
  destGateId,
}: {
  settlement: ReturnType<typeof useInvoiceSettlement>;
  destGateId: GateId;
}) {
  const sourceLabel = settlement.source
    ? `Gate ${gateLetter(settlement.source.chainId)} · ${CHAIN_LABEL[settlement.source.chainId]}`
    : "any gate";

  const boardStatus = settlement.complete
    ? "LANDED"
    : settlement.relay?.status === "relayed"
      ? "FORWARDING"
      : settlement.source
        ? "RECEIVED"
        : "AWAITING";

  const boardTone =
    boardStatus === "LANDED" ? "green" : boardStatus === "AWAITING" ? "ink" : "amber";

  const relayed = settlement.relay?.status === "relayed" ? settlement.relay : undefined;
  const isSameChain = relayed?.mode === "same-chain";

  const steps = [
    {
      done: !!settlement.source,
      title: settlement.source ? `Funds received at ${sourceLabel}` : "Waiting for funds",
      detail: settlement.source
        ? formatAmount(settlement.source.amount)
        : "Send USDC to any open gate",
      chainId: settlement.source?.chainId,
      txHash: settlement.source?.txHash,
    },
    {
      done: !!relayed,
      title: "Forward triggered",
      detail: relayed
        ? relayed.mode === "same-chain"
          ? "Direct relay"
          : "Cross-chain via settlement network"
        : settlement.source
          ? "Triggering…"
          : "Pending",
      chainId: settlement.source?.chainId,
      txHash: relayed?.relayTxHash,
    },
    {
      done: settlement.complete,
      title: isSameChain ? "Delivered" : `Landed at Gate ${gateLetter(destGateId)}`,
      detail: settlement.complete
        ? "Confirmed"
        : relayed && !isSameChain
          ? (settlement.oneClickStatus ?? "Awaiting fill…")
          : "Pending",
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

function ProgressStep({
  done,
  active,
  title,
  detail,
  chainId,
  txHash,
}: {
  done: boolean;
  active?: boolean;
  title: string;
  detail: string;
  chainId?: SupportedChainId;
  txHash?: string;
}) {
  const explorerUrl =
    chainId !== undefined && txHash
      ? `${CHAINS.find((c) => c.id === chainId)?.blockExplorers?.default.url.replace(/\/$/, "")}/tx/${txHash}`
      : undefined;
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
        <div className={"text-sm font-medium " + (done ? "text-ink" : "text-ink-dim")}>
          {title}
        </div>
        <div className="mt-0.5 text-xs text-ink-dim flex w-fit items-center gap-1.5">
          {chainId !== undefined && <GateDot id={chainId} />}
          <span className="tabular font-mono">{detail}</span>
        </div>
        {explorerUrl && txHash && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex w-fit items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium"
            title={txHash}
          >
            <span className="font-mono">
              {txHash.slice(0, 8)}…{txHash.slice(-6)}
            </span>
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

function StatusBadge({ status }: { status: "paid" | "awaiting" }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full ring-1 ring-green-500/30 bg-green-50 text-green-300 text-xs font-mono font-medium uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        <CheckCircle2 className="h-3.5 w-3.5" />
        Landed
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

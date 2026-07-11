import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
  AlertCircle,
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
} from "lucide-react";
import { CHAINS, CHAIN_LABEL } from "../chains";
import type { IssuedSolanaInvoice } from "../solanaInvoice";
import { GateDot, GateBadge, gateLetter, SOLANA_GATE_ID } from "./GateBadge";
import { SplitFlap } from "./SplitFlap";
import { buildShareUrl } from "../share";
import { useSolanaSettlement } from "../useSolanaSettlement";

export function SolanaInvoicePay({
  issued,
  onBack,
}: {
  issued: IssuedSolanaInvoice;
  onBack: () => void;
}) {
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const amountStr = formatUnits(issued.invoice.amount, 6);
  const expired = useExpired(issued.expiresAt);
  const settlement = useSolanaSettlement(issued.invoiceAddress, issued.issuedAt);
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
          status={status}
          copiedAddr={copiedAddr}
          onCopyAddr={handleCopyAddr}
        />

        <aside className="space-y-4 lg:sticky lg:top-20">
          {complete ? (
            <PaidCard fillTx={settlement.complete?.fillTx} />
          ) : (
            <ExpiryCard expiresAt={issued.expiresAt} expired={expired} />
          )}
          <SettlementProgress settlement={settlement} />
          <RoutesDebugPanel issued={issued} />
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

function EdgeNotches() {
  return (
    <>
      <span className="absolute left-0 bottom-0 -translate-x-1/2 translate-y-1/2 h-5 w-5 rounded-full bg-bg" />
      <span className="absolute right-0 bottom-0 translate-x-1/2 translate-y-1/2 h-5 w-5 rounded-full bg-bg" />
    </>
  );
}

function InvoiceDocument({
  issued,
  amountStr,
  status,
  copiedAddr,
  onCopyAddr,
}: {
  issued: IssuedSolanaInvoice;
  amountStr: string;
  status: "paid" | "awaiting" | "expired";
  copiedAddr: boolean;
  onCopyAddr: () => void;
}) {
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
            label="Bill to (Solana)"
            value={
              <span className="font-mono text-xs">
                {short(issued.invoice.payeeSolanaAddress)}
              </span>
            }
            title={issued.invoice.payeeSolanaAddress}
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
            <GateBadge id={SOLANA_GATE_ID} size="lg" active />
          </div>
        </div>
        <EdgeNotches />
      </div>

      <div className="relative px-8 py-7 border-b border-dashed border-line">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
              Send USDC to this address
            </div>
            <div className="mt-1 text-sm text-ink-dim">
              Pay from any of the 5 EVM gates below — funds bridge straight to
              the payee's Solana wallet the moment they touch down.
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

function PaidCard({ fillTx }: { fillTx?: string }) {
  return (
    <div className="rounded-2xl border border-green-500/30 bg-green-50 p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-green-300 mb-3">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Landed
      </div>
      <div className="text-sm text-ink-dim leading-relaxed">
        Confirmed by Across relay network — settled to the payee's Solana
        wallet.
      </div>
      {fillTx && (
        <a
          href={`https://solscan.io/tx/${fillTx}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium"
        >
          View on Solscan
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
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
        (expired ? "bg-red-50 border-red-500/30" : "bg-surface border-line")
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
          ? "The 24h pre-signed window passed. These routes will no longer execute — issue a fresh invoice to retry."
          : "Pay before the window closes. After expiry the pre-signed routes are no longer valid."}
      </div>
    </div>
  );
}

function RoutesDebugPanel({ issued }: { issued: IssuedSolanaInvoice }) {
  const okCount = issued.supertxs.filter((s) => s.hash).length;
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
          <ShieldCheck className="h-3.5 w-3.5" />
          Routes issued
        </div>
        <span className="text-[11px] font-mono text-ink-faint">
          {okCount}/{issued.supertxs.length}
        </span>
      </div>
      <ul className="space-y-2.5">
        {issued.supertxs.map((s) => (
          <li key={s.chainId} className="flex items-start gap-2.5 text-sm">
            {s.hash ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1.5 text-ink">
                <GateDot id={s.chainId} />
                {CHAIN_LABEL[s.chainId]}
              </div>
              {s.hash ? (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {s.meeScanLink && (
                    <a
                      href={s.meeScanLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium w-fit"
                    >
                      MEE Scan
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {s.meeFeeAmount !== undefined && (
                    <span className="text-[11px] text-ink-faint font-mono">
                      fee: {formatUnits(s.meeFeeAmount, 6)} USDC
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-red-400 break-words">
                  {s.error ?? "Failed to issue"}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 pt-4 border-t border-dashed border-line text-[11px] text-ink-faint leading-relaxed">
        Each gate has its own independently pre-signed route. If one shows an
        error above, that specific gate won't fire — the others are
        unaffected.
      </p>
    </div>
  );
}

function AutopayNote() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-3">
        <PlaneLanding className="h-3.5 w-3.5" />
        Auto-settlement
      </div>
      <p className="text-sm text-ink-dim leading-relaxed">
        We pre-signed a bridge instruction on every gate, targeting the
        payee's Solana wallet directly. Whichever gate the payer uses fires
        automatically — the signing key was discarded immediately after.
      </p>
    </div>
  );
}

function SettlementProgress({
  settlement,
}: {
  settlement: ReturnType<typeof useSolanaSettlement>;
}) {
  const sourceLabel = settlement.source
    ? `Gate ${gateLetter(settlement.source.chainId)} · ${CHAIN_LABEL[settlement.source.chainId]}`
    : "any gate";

  const boardStatus = settlement.complete
    ? "LANDED"
    : settlement.bridgeSubmitted
      ? "IN TRANSIT"
      : settlement.source
        ? "RECEIVED"
        : "AWAITING";

  const boardTone =
    boardStatus === "LANDED"
      ? "green"
      : boardStatus === "AWAITING"
        ? "ink"
        : "amber";

  const steps = [
    {
      done: !!settlement.source,
      title: settlement.source
        ? `Funds received at ${sourceLabel}`
        : "Waiting for funds",
      detail: settlement.source
        ? formatAmount(settlement.source.amount)
        : "Send USDC to any of the 5 gates",
      chainId: settlement.source?.chainId,
      txHash: settlement.source?.txHash,
    },
    {
      done: !!settlement.bridgeSubmitted,
      title: "Bridge submitted",
      detail: settlement.bridgeSubmitted
        ? `Deposit #${settlement.bridgeSubmitted.depositId}`
        : settlement.source
          ? "Submitting…"
          : "Pending",
      chainId: settlement.bridgeSubmitted?.chainId,
      txHash: settlement.bridgeSubmitted?.txHash,
    },
    {
      done: !!settlement.complete,
      title: "Landed on Solana",
      detail: settlement.complete
        ? "Confirmed by Across"
        : settlement.bridgeSubmitted
          ? "Awaiting fill…"
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
  chainId?: (typeof CHAINS)[number]["id"];
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
        <div
          className={"text-sm font-medium " + (done ? "text-ink" : "text-ink-dim")}
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
        pre-signed bridge routes to the Solana payee — nothing else can be
        done from this address.
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

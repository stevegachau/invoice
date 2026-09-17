import { useEffect, useState } from "react";
import { isAddress, parseUnits, type Address } from "viem";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Loader2,
  User,
} from "lucide-react";
import { CHAINS } from "../chains";
import { issueInvoice, type IssuedInvoice } from "../invoice";
import { previewQuote, type Destination, type PreviewQuote } from "../relayApi";
import { ChainDot, networkLabel } from "./NetworkBadge";

export function InvoiceForm({
  onIssued,
}: {
  onIssued: (i: IssuedInvoice) => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("25");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validAddress = isAddress(payee);
  const validAmount = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  })();
  const validCompany = companyName.trim().length > 0;
  const canSubmit = validAddress && validAmount && validCompany && !busy;

  function buildDestination(): Destination {
    return { type: "arc", address: payee as Address };
  }

  const [preview, setPreview] = useState<PreviewQuote | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Fires once the payout address is valid (and on amount changes),
  // debounced. The payer's actual origin chain isn't known at issue time,
  // so this quotes a representative origin (Base) -> Arc to preview how much
  // USDC lands after Relay's bridging fee.
  useEffect(() => {
    if (!validAddress || !validAmount) {
      setPreview(null);
      setPreviewFailed(false);
      return;
    }

    const destination = buildDestination();

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewFailed(false);

    const t = setTimeout(async () => {
      try {
        const result = await previewQuote({
          originChainId: CHAINS[0].id,
          destination,
          amount: parseUnits(amount, 6),
        });
        if (!cancelled) setPreview(result);
      } catch {
        if (!cancelled) {
          setPreview(null);
          setPreviewFailed(true);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validAddress, validAmount, payee, amount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await issueInvoice(
        { destination: buildDestination(), amount: parseUnits(amount, 6) },
        { companyName: companyName.trim(), description: description.trim() },
      );
      onIssued(issued);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const formattedAmount = formatAmountDisplay(amount);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-line bg-surface overflow-hidden"
    >
      <header className="px-7 pt-7 pb-5 border-b border-dashed border-line">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
          <CircleDollarSign className="h-3.5 w-3.5" />
          New invoice
        </div>
        <h2 className="font-display mt-2 text-2xl font-semibold tracking-tight text-ink">
          Request payment
        </h2>
        <p className="mt-1 text-sm text-ink-dim">
          Billed in USDC, settled on Arc. Your customer pays from Base,
          Arbitrum, or Polygon — it lands in your Arc account automatically.
        </p>
      </header>

      <section className="px-7 pt-7 grid sm:grid-cols-2 gap-4">
        <Field label="From" icon={<Building2 className="h-4 w-4 text-ink-faint" />}>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Capital"
            className="flex-1 bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint outline-none"
          />
        </Field>
        <Field
          label="Description"
          icon={<FileText className="h-4 w-4 text-ink-faint" />}
          optional
        >
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Invoice 0921 — advisory retainer"
            className="flex-1 bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint outline-none"
          />
        </Field>
      </section>

      <section className="px-7 pt-6">
        <Label>Amount</Label>
        <div className="mt-2 rounded-xl bg-surface-2 border border-line px-5 py-6 flex items-center gap-4">
          <span className="h-11 w-11 rounded-lg bg-bg ring-1 ring-line inline-flex items-center justify-center">
            <CircleDollarSign className="h-5 w-5 text-green-500" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-ink-faint text-2xl font-medium font-mono">
                $
              </span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="bg-transparent flex-1 min-w-0 text-[44px] leading-none font-semibold tracking-tight text-ink placeholder:text-ink-faint tabular font-mono"
              />
            </div>
            <div className="mt-1.5 text-xs text-ink-dim tabular font-mono">
              ≈ {formattedAmount} USDC
            </div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-green-50 ring-1 ring-green-500/30 text-green-300 text-xs font-mono font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            USDC
          </span>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Whatever actually arrives gets settled — this amount is just what
          shows on the invoice.
        </p>
      </section>

      <section className="px-7 pt-6">
        <Label>Your Arc payout address</Label>
        <div
          className={
            "mt-2 flex items-center gap-3 rounded-lg border bg-bg pl-4 pr-2 transition " +
            (payee && !validAddress
              ? "border-red-500/50 ring-1 ring-red-500/20"
              : "border-line focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/20")
          }
        >
          <User className="h-4 w-4 text-ink-faint shrink-0" />
          <input
            value={payee}
            onChange={(e) => setPayee(e.target.value.trim())}
            placeholder="0x… — your address on Arc"
            className="flex-1 bg-transparent py-3 text-sm text-ink font-mono placeholder:text-ink-faint outline-none"
          />
          {validAddress && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400 px-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Valid
            </span>
          )}
        </div>
        {payee && !validAddress ? (
          <p className="mt-1.5 text-xs text-red-400 inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Not a valid Arc address
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-ink-faint leading-relaxed">
            USDC is Arc's native asset — funds arrive spendable, gas included.
            Arc is EVM-compatible, so this is a standard 0x address.
          </p>
        )}
      </section>

      <section className="px-7 pt-6">
        <div className="flex items-center justify-between">
          <Label>Payable from</Label>
          <span className="text-[11px] text-ink-faint">Origin networks</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {CHAINS.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line bg-surface-2 text-ink-dim text-[11px] font-mono uppercase tracking-wider"
            >
              <ChainDot id={c.id} />
              {networkLabel(c.id)}
            </span>
          ))}
        </div>
      </section>

      <section className="px-7 pt-6">
        <div className="rounded-xl bg-surface-2 border border-dashed border-line p-4 space-y-2 text-sm">
          <SummaryRow label="From" value={companyName.trim() || "—"} />
          <SummaryRow label="Amount" value={`${formattedAmount} USDC`} />
          <SummaryRow
            label="Settles on"
            value="Arc"
            tag={<ChainDot id="arc" />}
            accent="amber"
          />
          <SummaryRow
            label="Est. received"
            value={
              previewLoading
                ? "Estimating…"
                : preview?.amountOutFormatted
                  ? `~${preview.amountOutFormatted} USDC on Arc`
                  : previewFailed
                    ? "Estimate unavailable"
                    : "Enter payout address"
            }
          />
        </div>
      </section>

      {error && (
        <div className="mx-7 mt-5 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2.5 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <footer className="px-7 pt-6 pb-7 mt-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="group w-full inline-flex items-center justify-center gap-2 h-12 rounded-lg bg-amber-500 text-bg text-sm font-semibold transition hover:bg-amber-400 disabled:bg-surface-2 disabled:text-ink-faint disabled:cursor-not-allowed"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating deposit address…
            </>
          ) : (
            <>
              Issue invoice
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-disabled:translate-x-0" />
            </>
          )}
        </button>
        <p className="mt-3 text-[11px] text-center text-ink-faint">
          One deposit address across all three origin networks. Whatever
          arrives is bridged to Arc automatically, gaslessly — no expiry.
        </p>
      </footer>
    </form>
  );
}

function Field({
  label,
  icon,
  optional,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {optional && (
          <span className="text-[11px] text-ink-faint">Optional</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 rounded-lg border border-line bg-bg pl-4 pr-2 focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/20 transition">
        {icon}
        {children}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-mono uppercase tracking-[0.14em] font-medium text-ink-faint">
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tag,
  accent,
}: {
  label: string;
  value: string;
  tag?: React.ReactNode;
  accent?: "amber";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-faint">{label}</span>
      <span
        className={
          "inline-flex items-center gap-1.5 font-medium tabular font-mono " +
          (accent === "amber" ? "text-amber-300" : "text-ink")
        }
      >
        {tag}
        {value}
      </span>
    </div>
  );
}

function formatAmountDisplay(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

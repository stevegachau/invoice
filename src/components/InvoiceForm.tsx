import { useState } from "react";
import { isAddress, parseUnits, type Address } from "viem";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Loader2,
  Send,
  User,
} from "lucide-react";
import { CHAINS, CHAIN_LABEL, type SupportedChainId } from "../chains";
import { issueInvoice, type Invoice } from "../invoice";
import { issueSolanaInvoice } from "../solanaInvoice";
import { isValidSolanaPubkey } from "../solana";
import type { AnyIssuedInvoice } from "../anyInvoice";
import { GateDot, gateLetter, SOLANA_GATE_ID, type GateId } from "./GateBadge";

export type { AnyIssuedInvoice } from "../anyInvoice";

const GATES: GateId[] = [...CHAINS.map((c) => c.id), SOLANA_GATE_ID];

function gateLabel(id: GateId): string {
  return id === SOLANA_GATE_ID ? "Solana" : CHAIN_LABEL[id as SupportedChainId];
}

export function InvoiceForm({
  onIssued,
}: {
  onIssued: (i: AnyIssuedInvoice) => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [destination, setDestination] = useState<GateId>(CHAINS[3].id);
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("25");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSolana = destination === SOLANA_GATE_ID;
  const validAddress = isSolana ? isValidSolanaPubkey(payee) : isAddress(payee);
  const validAmount = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  })();
  const validCompany = companyName.trim().length > 0;
  const canSubmit = validAddress && validAmount && validCompany && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const apiKey = import.meta.env.VITE_BICONOMY_API_KEY as
      | string
      | undefined;
    if (!apiKey) {
      setError("VITE_BICONOMY_API_KEY is not set.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = {
        companyName: companyName.trim(),
        description: description.trim(),
      };

      const issued: AnyIssuedInvoice = isSolana
        ? await issueSolanaInvoice(
            { payeeSolanaAddress: payee, amount: parseUnits(amount, 6) },
            meta,
            apiKey,
          )
        : await issueInvoice(
            {
              payeeAddress: payee as Address,
              destinationChainId: destination as SupportedChainId,
              amount: parseUnits(amount, 6),
            } satisfies Invoice,
            meta,
            apiKey,
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
      <header className="px-7 pt-7 pb-5 border-b border-dashed border-line flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint">
            <Send className="h-3.5 w-3.5" />
            Manifest · new
          </div>
          <h2 className="font-display mt-2 text-2xl font-semibold tracking-tight text-ink">
            Request payment
          </h2>
          <p className="mt-1 text-sm text-ink-dim">
            USDC, settled across chains. Payer can send from any gate below.
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-ink-faint">
          Form 3B
        </span>
      </header>

      {/* From / Description */}
      <section className="px-7 pt-7 grid sm:grid-cols-2 gap-4">
        <Field label="From" icon={<Building2 className="h-4 w-4 text-ink-faint" />}>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Loud Socks Studio"
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
            placeholder="Podcast intro pack, batch two"
            className="flex-1 bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint outline-none"
          />
        </Field>
      </section>

      {/* Amount hero */}
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
      </section>

      {/* Destination gate */}
      <section className="px-7 pt-6">
        <div className="flex items-center justify-between">
          <Label>Settle at gate</Label>
          <span className="text-[11px] text-ink-faint">
            Where you receive the funds
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {GATES.map((id) => {
            const selected = id === destination;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setDestination(id);
                  setPayee("");
                }}
                className={
                  "group relative rounded-lg border px-3 py-3 text-sm transition flex flex-col items-center justify-center gap-1 " +
                  (selected
                    ? "border-amber-500/50 bg-amber-50 text-ink ring-1 ring-amber-500/30"
                    : "border-line bg-bg text-ink-dim hover:border-line hover:bg-surface-2")
                }
              >
                <span className="text-[9px] font-mono uppercase tracking-widest text-ink-faint">
                  Gate {gateLetter(id)}
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <GateDot id={id} />
                  {gateLabel(id)}
                </span>
                {selected && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-400 absolute top-1.5 right-1.5" />
                )}
              </button>
            );
          })}
        </div>
        {isSolana && (
          <p className="mt-2 text-[11px] text-ink-faint leading-relaxed">
            Payer still sends from any of the 5 EVM gates — Solana is a
            settlement destination, funds bridge straight to the payee's
            Solana wallet.
          </p>
        )}
      </section>

      {/* Payee */}
      <section className="px-7 pt-6">
        <Label>{isSolana ? "Payee Solana address" : "Payee address"}</Label>
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
            placeholder={
              isSolana ? "Solana wallet address (base58)" : "0x… or yourname.eth"
            }
            className="flex-1 bg-transparent py-3 text-sm text-ink font-mono placeholder:text-ink-faint outline-none"
          />
          {validAddress && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400 px-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Valid
            </span>
          )}
        </div>
        {payee && !validAddress && (
          <p className="mt-1.5 text-xs text-red-400 inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {isSolana ? "Not a valid Solana address" : "Not a valid address"}
          </p>
        )}
      </section>

      {/* Summary */}
      <section className="px-7 pt-6">
        <div className="rounded-xl bg-surface-2 border border-dashed border-line p-4 space-y-2 text-sm">
          <SummaryRow label="From" value={companyName.trim() || "—"} />
          <SummaryRow label="Amount" value={`${formattedAmount} USDC`} />
          <SummaryRow
            label="Settles at"
            value={`Gate ${gateLetter(destination)} · ${gateLabel(destination)}`}
            tag={<GateDot id={destination} />}
          />
          <SummaryRow label="Network fee" value="Sponsored" accent="green" />
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
              {isSolana
                ? "Signing supertx to Solana…"
                : "Signing supertx across 5 gates…"}
            </>
          ) : (
            <>
              Issue invoice
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-disabled:translate-x-0" />
            </>
          )}
        </button>
        <p className="mt-3 text-[11px] text-center text-ink-faint">
          {isSolana
            ? "We pre-sign one supertx bridging directly to the Solana address from any of the 5 EVM gates — it expires after 24h."
            : "We pre-sign one supertx spanning all 5 gates. Whichever the payer uses fires automatically — it expires after 24h."}
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
  accent?: "green";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-faint">{label}</span>
      <span
        className={
          "inline-flex items-center gap-1.5 font-medium tabular font-mono " +
          (accent === "green" ? "text-green-400" : "text-ink")
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

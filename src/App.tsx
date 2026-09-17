import { useEffect, useState } from "react";
import { Fuel, Zap, Link as LinkIcon, ShieldCheck } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { InvoiceForm } from "./components/InvoiceForm";
import { InvoicePay } from "./components/InvoicePay";
import { ChainDot } from "./components/NetworkBadge";
import { CHAINS, SETTLEMENT_CHAIN_ID } from "./chains";
import type { IssuedInvoice } from "./invoice";
import type { RelayResult } from "./relayApi";
import { decodeInvoiceHash, encodeInvoiceHash } from "./share";

export default function App() {
  const [decoded, setDecoded] = useState<{
    issued: IssuedInvoice;
    relay?: RelayResult;
  } | null>(() => decodeInvoiceHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setDecoded(decodeInvoiceHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function handleIssued(issued: IssuedInvoice) {
    window.location.hash = encodeInvoiceHash(issued);
    setDecoded({ issued });
  }

  function handleBack() {
    if (window.location.hash) {
      history.pushState(null, "", window.location.pathname + window.location.search);
    }
    setDecoded(null);
  }

  return (
    <AppShell>
      {decoded ? (
        <InvoicePay
          issued={decoded.issued}
          cachedRelay={decoded.relay}
          onBack={handleBack}
        />
      ) : (
        <DashboardView onIssued={handleIssued} />
      )}
    </AppShell>
  );
}

function DashboardView({ onIssued }: { onIssued: (i: IssuedInvoice) => void }) {
  return (
    <div className="space-y-10">
      <Hero />
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <InvoiceForm onIssued={onIssued} />
        <HowItSettles />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="max-w-2xl">
      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-50 pl-2.5 pr-3.5 py-1.5">
        <ChainDot id={SETTLEMENT_CHAIN_ID} />
        <span className="text-[11px] font-mono uppercase tracking-widest text-amber-300">
          Settles on Circle Arc
        </span>
      </div>
      <h1 className="font-display text-[40px] md:text-[48px] leading-[1.05] font-semibold tracking-tight text-ink">
        Invoices that settle on Arc.{" "}
        <span className="text-ink-dim">Paid from anywhere.</span>
      </h1>
      <p className="mt-3 text-ink-dim text-[15px] leading-relaxed">
        Issue an invoice, share one link. Your customer pays USDC from Base,
        Arbitrum, Polygon, or Arc itself — and it lands in your account on
        Arc, Circle's L1 for stablecoin finance. Paying from Arc settles
        instantly with no bridge; everything else arrives in seconds.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <FeatureChip icon={<Zap className="h-3.5 w-3.5" />} label="Sub-second finality" />
        <FeatureChip icon={<Fuel className="h-3.5 w-3.5" />} label="Gas in dollars" />
        <FeatureChip icon={<LinkIcon className="h-3.5 w-3.5" />} label="One link" />
        <FeatureChip icon={<ShieldCheck className="h-3.5 w-3.5" />} label="No wallet connect" />
      </div>
    </section>
  );
}

function FeatureChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-ink-dim">
      <span className="text-amber-400">{icon}</span>
      {label}
    </span>
  );
}

function HowItSettles() {
  const steps = [
    {
      title: "Issue the invoice",
      body: "Company, amount, and your Arc payout address. You get one shareable link.",
    },
    {
      title: "Customer pays on any origin",
      body: "A single deposit address, live on Base, Arbitrum, Polygon, and Arc. USDC, no wallet connect.",
    },
    {
      title: "Settled on Arc",
      body: "Bridged automatically and gaslessly to your Arc account — or settled instantly if they paid on Arc.",
    },
  ];
  return (
    <aside className="rounded-2xl border border-line bg-surface p-6">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-5">
        How it settles
      </div>
      <ol className="relative">
        <span
          aria-hidden
          className="absolute left-[13px] top-2 bottom-2 w-px border-l border-dashed border-line"
        />
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 pb-6 last:pb-0">
            <span className="relative z-10 shrink-0 h-7 w-7 rounded-full bg-surface-2 border border-line text-amber-400 inline-flex items-center justify-center text-[11px] font-mono font-semibold">
              {i + 1}
            </span>
            <div className="pt-0.5">
              <div className="text-sm font-medium text-ink">{s.title}</div>
              <div className="text-xs text-ink-dim mt-0.5 leading-relaxed">
                {s.body}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-1 pt-4 border-t border-dashed border-line">
        <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-2">
          Origin networks
        </div>
        <div className="flex flex-wrap gap-2">
          {CHAINS.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-dim"
            >
              <ChainDot id={c.id} />
              {c.name}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}

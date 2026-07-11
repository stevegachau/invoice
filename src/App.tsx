import { useEffect, useState } from "react";
import { PlaneTakeoff } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { InvoiceForm } from "./components/InvoiceForm";
import { InvoicePay } from "./components/InvoicePay";
import { SplitFlap } from "./components/SplitFlap";
import { gateLetter } from "./components/GateBadge";
import { CHAINS } from "./chains";
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
        <RoutePlan />
      </div>
    </div>
  );
}

const CYCLE_LABELS = ["ANY CHAIN", "NO GAS FEE", "ONE LINK", "AUTO-LANDS"];

function Hero() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % CYCLE_LABELS.length), 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="max-w-2xl">
      <div className="mb-5 rounded-lg border border-line bg-surface inline-flex items-center gap-3 pl-3 pr-4 py-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-ink-faint">
          Now boarding
        </span>
        <SplitFlap text={CYCLE_LABELS[i]} tone="amber" size="sm" />
      </div>
      <h1 className="font-display text-[40px] md:text-[48px] leading-[1.05] font-semibold tracking-tight text-ink">
        Land the payment on any gate.{" "}
        <span className="text-ink-dim">We route it home.</span>
      </h1>
      <p className="mt-3 text-ink-dim text-[15px] leading-relaxed">
        Issue an invoice, get one link. Your customer sends USDC through
        whichever chain they're holding it on — we pre-sign nothing and
        pay no gas ourselves, and it forwards automatically the moment it
        touches down.
      </p>
    </section>
  );
}

function RoutePlan() {
  const steps = [
    {
      title: "File the manifest",
      body: "Company, description, amount, and where you want paid out.",
    },
    {
      title: "One address, three gates",
      body: "A single deterministic address, live on Base, Arbitrum, and Polygon at once.",
    },
    {
      title: "Touchdown, then forwarding",
      body: "USDC lands anywhere — it's forwarded to you automatically, gaslessly.",
    },
  ];
  return (
    <aside className="rounded-2xl border border-line bg-surface p-6">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-5">
        Route plan
      </div>
      <ol className="relative">
        <span
          aria-hidden
          className="absolute left-[13px] top-2 bottom-2 w-px border-l border-dashed border-line"
        />
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 pb-6 last:pb-0">
            <span className="relative z-10 shrink-0 h-7 w-7 rounded-full bg-surface-2 border border-line text-amber-400 inline-flex items-center justify-center text-[11px] font-mono font-semibold">
              {gateLetter(CHAINS[i % CHAINS.length].id)}
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
      <div className="mt-1 pt-4 border-t border-dashed border-line flex items-center gap-2 text-[11px] text-ink-faint">
        <PlaneTakeoff className="h-3.5 w-3.5 text-amber-500/70" />
        No expiry — pay whenever you're ready.
      </div>
    </aside>
  );
}

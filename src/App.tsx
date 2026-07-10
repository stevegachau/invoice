import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { InvoiceForm } from "./components/InvoiceForm";
import { InvoicePay } from "./components/InvoicePay";
import { SplitFlap } from "./components/SplitFlap";
import type { IssuedInvoice } from "./invoice";
import { decodeInvoiceHash, encodeInvoiceHash } from "./share";

export default function App() {
  const [issued, setIssued] = useState<IssuedInvoice | null>(() =>
    decodeInvoiceHash(window.location.hash),
  );

  useEffect(() => {
    const onHash = () => setIssued(decodeInvoiceHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function handleIssued(i: IssuedInvoice) {
    window.location.hash = encodeInvoiceHash(i);
    setIssued(i);
  }

  function handleBack() {
    if (window.location.hash) {
      history.pushState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    setIssued(null);
  }

  return (
    <AppShell>
      {issued ? (
        <InvoicePay issued={issued} onBack={handleBack} />
      ) : (
        <DashboardView onIssued={handleIssued} />
      )}
    </AppShell>
  );
}

function DashboardView({
  onIssued,
}: {
  onIssued: (i: IssuedInvoice) => void;
}) {
  return (
    <div className="space-y-10">
      <Hero />
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <InvoiceForm onIssued={onIssued} />
        <HowItWorks />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="max-w-2xl">
      <div className="mb-4">
        <SplitFlap text="USDC INBOUND" tone="amber" size="md" />
      </div>
      <h1 className="font-display text-[40px] md:text-[48px] leading-[1.05] font-semibold tracking-tight text-ink">
        Land the payment on any gate.{" "}
        <span className="text-ink-dim">We route it home.</span>
      </h1>
      <p className="mt-3 text-ink-dim text-[15px] leading-relaxed">
        Issue an invoice, get one link. Your customer sends USDC through
        whichever chain they're holding it on — Landfall pre-signs the
        route across all five and forwards it, gaslessly, the moment it
        touches down.
      </p>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "File the manifest",
      body: "Company, description, amount, and the address you want paid out to.",
    },
    {
      title: "One link, five gates open",
      body: "We mint an ephemeral address and pre-sign a route from every supported chain.",
    },
    {
      title: "Touchdown, then forwarding",
      body: "USDC lands on any chain — it's bridged and forwarded to you automatically.",
    },
  ];
  return (
    <aside className="rounded-2xl border border-line bg-surface p-6">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-faint mb-4">
        Flight plan
      </div>
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="shrink-0 h-7 w-7 rounded-md bg-surface-2 border border-line text-amber-400 inline-flex items-center justify-center text-xs font-mono font-semibold tabular">
              {i + 1}
            </span>
            <div>
              <div className="text-sm font-medium text-ink">{s.title}</div>
              <div className="text-xs text-ink-dim mt-0.5 leading-relaxed">
                {s.body}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

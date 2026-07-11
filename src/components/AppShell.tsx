import type { ReactNode } from "react";
import { Logomark } from "./Logomark";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 min-h-full flex flex-col">
      <TopBar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-10 md:py-14">
        {children}
      </main>
      <BottomBar />
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-20 backdrop-blur-xl bg-bg/80 border-b border-line-soft">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <a
          href="/"
          className="flex items-center gap-3 group shrink-0"
          onClick={(e) => {
            if (window.location.hash) {
              e.preventDefault();
              window.location.hash = "";
            }
          }}
        >
          <span className="transition group-hover:-translate-y-0.5">
            <Logomark size={30} />
          </span>
          <span className="flex items-center gap-2 leading-none">
            <span className="font-display text-[16px] font-semibold tracking-tight text-ink">
              Invoices
            </span>
            <span className="text-ink-faint">|</span>
            <span className="text-[13px] text-ink-dim">
              Self-Routing Payments
            </span>
          </span>
        </a>

        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 pulse-dot" />
          Tower online
        </div>
      </div>
    </header>
  );
}

function BottomBar() {
  return (
    <footer className="border-t border-line-soft">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between text-[11px] font-mono text-ink-faint uppercase tracking-wider">
        <span className="inline-flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 pulse-dot" />
          All systems operational
        </span>
        <div className="flex items-center gap-4">
          <a href="/api" className="text-ink-faint hover:text-ink transition normal-case">
            API
          </a>
          <a
            href="https://x.com/invoiceswtf"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Invoices on X"
            className="text-ink-faint hover:text-ink transition"
          >
            <XLogo className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </footer>
  );
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

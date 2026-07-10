import type { ReactNode } from "react";
import { RadioTower } from "lucide-react";

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
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a
          href="/"
          className="flex items-center gap-2.5 group"
          onClick={(e) => {
            if (window.location.hash) {
              e.preventDefault();
              window.location.hash = "";
            }
          }}
        >
          <span className="h-7 w-7 rounded-md bg-amber-50 border border-amber-500/30 inline-flex items-center justify-center">
            <RadioTower className="h-3.5 w-3.5 text-amber-400" />
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
            Landfall
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
        <span>USDC · 5 gates</span>
        <span>Landfall v1</span>
      </div>
    </footer>
  );
}

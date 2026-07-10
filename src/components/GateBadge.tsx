import { mainnet, arbitrum, optimism, base, polygon } from "viem/chains";
import type { SupportedChainId } from "../chains";

const CHAIN_THEME: Record<
  SupportedChainId,
  { dot: string; abbr: string; gate: string }
> = {
  [mainnet.id]: { dot: "#8ca0f5", abbr: "Eth", gate: "A" },
  [arbitrum.id]: { dot: "#57b7f5", abbr: "Arb", gate: "B" },
  [optimism.id]: { dot: "#ff6b6b", abbr: "Opt", gate: "C" },
  [base.id]: { dot: "#5b8cff", abbr: "Base", gate: "D" },
  [polygon.id]: { dot: "#b18aff", abbr: "Pol", gate: "E" },
};

export function gateLetter(id: SupportedChainId): string {
  return CHAIN_THEME[id].gate;
}

export function GateDot({ id }: { id: SupportedChainId }) {
  const t = CHAIN_THEME[id];
  return (
    <span
      className="block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: t.dot }}
    />
  );
}

export function GateBadge({
  id,
  size = "md",
  active,
}: {
  id: SupportedChainId;
  size?: "sm" | "md" | "lg";
  active?: boolean;
}) {
  const t = CHAIN_THEME[id];
  const dim =
    size === "sm"
      ? "h-7 px-2 text-[10px] gap-1"
      : size === "lg"
        ? "h-10 px-3.5 text-xs gap-2"
        : "h-8 px-3 text-[11px] gap-1.5";
  return (
    <span
      className={
        `inline-flex items-center ${dim} rounded-md border font-mono uppercase tracking-wider transition ` +
        (active
          ? "border-amber-500/50 bg-amber-50 text-amber-300"
          : "border-line bg-surface-2 text-ink-dim")
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: t.dot }}
      />
      Gate {t.gate}
      <span className="text-ink-faint">·</span>
      {t.abbr}
    </span>
  );
}

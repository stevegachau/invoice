import { base, arbitrum, polygon } from "viem/chains";
import { arc, type SupportedChainId } from "../chains";

// Origin chains use cool tones; Arc — the settlement chain — is warm amber,
// so a payment visibly converges from any cool origin into the one warm Arc
// destination. Amber doubles as the app's "value / settled" accent. (Arc is
// also a valid origin now, and still reads amber there, which is fine — it's
// the same network.)
export type NetworkId = SupportedChainId;

const THEME: Record<SupportedChainId, { dot: string; label: string }> = {
  [base.id]: { dot: "#5b8cff", label: "Base" },
  [arbitrum.id]: { dot: "#57b7f5", label: "Arbitrum" },
  [polygon.id]: { dot: "#b18aff", label: "Polygon" },
  [arc.id]: { dot: "#ffb020", label: "Arc" },
};

export function networkLabel(id: NetworkId): string {
  return THEME[id].label;
}

export function ChainDot({ id }: { id: NetworkId }) {
  return (
    <span
      className="block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: THEME[id].dot }}
    />
  );
}

export function NetworkBadge({
  id,
  size = "md",
  active,
}: {
  id: NetworkId;
  size?: "sm" | "md" | "lg";
  active?: boolean;
}) {
  const t = THEME[id];
  const isArc = id === arc.id;
  const dim =
    size === "sm"
      ? "h-7 px-2.5 text-[10px] gap-1.5"
      : size === "lg"
        ? "h-10 px-4 text-xs gap-2"
        : "h-8 px-3 text-[11px] gap-1.5";
  const activeClass = isArc
    ? "border-amber-500/50 bg-amber-50 text-amber-300"
    : "border-[#5b8cff]/40 bg-[#5b8cff]/10 text-[#8ca9ff]";
  return (
    <span
      className={
        `inline-flex items-center ${dim} rounded-md border font-mono uppercase tracking-wider transition ` +
        (active ? activeClass : "border-line bg-surface-2 text-ink-dim")
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: t.dot }}
      />
      {t.label}
    </span>
  );
}

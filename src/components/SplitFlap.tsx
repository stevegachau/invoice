import { useEffect, useRef, useState } from "react";

/**
 * Solari split-flap tile row — the page's signature element. Each character
 * gets its own tile; when `text` changes, every tile replays the flap-in
 * animation, mimicking a mechanical departures board updating a status.
 */
export function SplitFlap({
  text,
  size = "md",
  tone = "ink",
}: {
  text: string;
  size?: "sm" | "md" | "lg";
  tone?: "ink" | "amber" | "green" | "red";
}) {
  const [display, setDisplay] = useState(text);
  const [tick, setTick] = useState(0);
  const prev = useRef(text);

  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      setDisplay(text);
      setTick((t) => t + 1);
    }
  }, [text]);

  const dim =
    size === "sm"
      ? "h-6 min-w-[16px] text-[11px]"
      : size === "lg"
        ? "h-10 min-w-[24px] text-lg"
        : "h-8 min-w-[19px] text-sm";

  const toneClass =
    tone === "amber"
      ? "text-amber-300"
      : tone === "green"
        ? "text-green-300"
        : tone === "red"
          ? "text-red-300"
          : "text-ink";

  const chars = display.split("");

  return (
    <span className="inline-flex gap-[3px] font-mono uppercase tracking-wide">
      {chars.map((c, i) => (
        <span
          key={`${i}-${tick}`}
          className={
            `flap-char inline-flex items-center justify-center ${dim} rounded-[3px] border border-line-soft bg-surface-2 px-[3px] ${toneClass}`
          }
          style={{ animationDelay: `${i * 18}ms` }}
        >
          {c === " " ? "\u00A0" : c}
        </span>
      ))}
    </span>
  );
}

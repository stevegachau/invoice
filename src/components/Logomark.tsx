export function Logomark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="7" fill="var(--color-surface-2)" />
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="6.25"
        stroke="var(--color-amber-500)"
        strokeOpacity="0.3"
      />
      <path
        d="M6 20 L16 8 L26 20"
        stroke="var(--color-amber-500)"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="24" r="1.6" fill="var(--color-amber-500)" />
    </svg>
  );
}

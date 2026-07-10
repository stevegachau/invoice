# Landfall

A cross-chain USDC invoicing app — same engine as the original invoice demo,
new UI. Issue an invoice, get one link. Your customer sends USDC on whichever
of five chains they hold it on; a pre-signed Biconomy MEE "supertransaction"
bridges it via Across and forwards it to your payout address automatically,
gaslessly, no backend involved.

## What's identical to the source demo (untouched logic)

- `src/chains.ts` — supported chains, RPCs, USDC + Across SpokePool addresses
- `src/across.ts` — Across `/suggested-fees` quote fetch
- `src/abi.ts` — SpokePool `depositV3Now` ABI
- `src/invoice.ts` — builds the multichain Nexus account, composable
  bridge + forward instructions, gets a sponsored MEE quote, executes it
- `src/share.ts` — encodes/decodes the invoice into a URL hash (base64url) —
  this is the entire "database": there is no backend
- The settlement tracker in `InvoicePay.tsx` (event-scanning hooks, adaptive
  block-range retry, localStorage cache) — same behavior, restyled

## What's new (the actual ask: a new UI)

A control-tower / departures-board visual identity instead of the original's
soft SaaS look:

- **Palette** — deep graphite-navy surface, signal amber accent, runway
  green for "landed," instead of the original's ink/brand-blue/mint.
- **Type** — Space Grotesk (display) + IBM Plex Sans (body) + IBM Plex Mono
  (every number, address, and status), replacing Sora/JetBrains Mono.
- **Signature element** — a split-flap (Solari board) status indicator
  (`src/components/SplitFlap.tsx`) that flips through `AWAITING → IN
  TRANSIT → FORWARDING → LANDED` as the settlement tracker updates. Used on
  the hero and on the payer-side status board.
- **Vocabulary** — chains are "gates" (A–E), the invoice is a "manifest,"
  the payer view is a boarding pass. Copy rewritten throughout
  (`AppShell.tsx`, `App.tsx`, `InvoiceForm.tsx`, `InvoicePay.tsx`,
  `GateBadge.tsx`).

## Setup

```bash
npm install
cp .env.local.example .env.local
# put your Biconomy MEE API key in .env.local
npm run dev
```

Only one secret is required: `VITE_BICONOMY_API_KEY`, used client-side to call
`createMeeClient`. Everything else (RPCs) has public fallbacks baked in, with
optional overrides via `VITE_RPC_<CHAIN>` in `.env.local` if you want private
endpoints.

```bash
npm run build   # tsc -b && vite build — verified clean, outputs dist/
```

No backend, no database — deploy `dist/` anywhere static (Vercel, Netlify,
Cloudflare Pages, GitHub Pages).

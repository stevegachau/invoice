# Invoices by Virtuals

A cross-chain USDC invoicing app — same engine as the original invoice demo,
new brand and UI. Issue an invoice, get one link. Your customer sends USDC on
whichever of five chains they hold it on; a pre-signed Biconomy MEE
"supertransaction" bridges it via Across and forwards it to your payout
address automatically, gaslessly, no backend involved.

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

## What's new

**Brand** — "Invoices by Virtuals," logo lockup built from the arrow/peak
glyph (`src/components/Logomark.tsx`), used at real size in the header
instead of buried in a favicon.

**Visual identity** — control-tower/departures-board instead of the
original's soft SaaS look: deep graphite-navy surface, signal amber accent,
runway green for "landed." Space Grotesk (display) + IBM Plex Sans (body) +
IBM Plex Mono (every number, address, status) instead of Sora/JetBrains Mono.

**Structural differences from the source layout** (not just a palette swap):

- The payer-side invoice is a die-cut boarding pass — `EdgeNotches` in
  `InvoicePay.tsx` punches actual semicircular notches into the card edges
  at the perforation lines, using the page background color and the card's
  `overflow-hidden` to fake a physically torn ticket stub.
- The merchant-side "how it works" list is a route plan with a dashed
  connecting line and lettered gate markers (A/B/C) instead of a numbered
  01/02/03 list.
- The hero has a live split-flap readout (`SplitFlap.tsx`, the page's
  signature element) cycling through `ANY CHAIN → NO GAS FEE → ONE LINK →
  AUTO-LANDS`, and the same component re-appears as the payer-side status
  board flipping through `AWAITING → IN TRANSIT → FORWARDING → LANDED` as
  the settlement tracker updates.
- Chains are "gates" (A–E), the invoice is a "manifest," placeholder copy
  is airport-flavored rather than generic SaaS boilerplate (no Acme Inc.,
  no Q1 retainer).

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
Cloudflare Pages, GitHub Pages). On Vercel, add `VITE_BICONOMY_API_KEY` under
Project Settings → Environment Variables, then redeploy.

# Invoices | USDC Settlement on Arc

A USDC invoicing app that settles on **Arc**, Circle's USDC-native L1.
Issue an invoice, share one link. Your customer sends USDC on whichever of
3 origin chains they hold it on (Base, Arbitrum, Polygon); it's bridged to
your Arc account automatically and gaslessly — no wallet connect, no chain
selection, no gas ever required from either side. On Arc, USDC is the
native gas asset, so funds arrive spendable ("gas in dollars").

## Architecture

The relay backend ships **in this same repo** as a stateless Vercel
serverless function at [`api/relay.js`](api/relay.js) (exposed at
`/api/relay`), so the frontend and backend deploy together — one repo, one
origin, no CORS. Settlement uses [Relay](https://relay.link) deposit
addresses; the origin-chain relay is paid for by PayAI's free x402
facilitator. Quick summary of how the two halves fit together:

1. **Issuing an invoice** generates a random `invoiceId` client-side and
   calls the backend's `address` action, which deterministically derives
   a plain EOA address from `HMAC(masterSecret, invoiceId)` — the same
   address on Base, Arbitrum, and Polygon automatically, since it's a
   real keypair, not a smart-contract account.
2. **The frontend polls that address** across the 3 origin chains directly
   against public RPCs (no backend involved in this step) via adaptive
   log-scanning.
3. **On detecting inflow**, it calls the backend's `relay` action with
   `{invoiceId, chainId, destination}` (destination is always
   `{ type: "arc", address }`). The backend re-reads the live balance
   itself (never trusts the frontend's number) and settles by one of two
   paths, both delivering the same Arc ERC-20 USDC:
   - **Same-chain** (payer was already on Arc): an EIP-3009
     `transferWithAuthorization` straight to the merchant via the **Arcus**
     x402 facilitator. No bridge, no bridging fee.
   - **Cross-chain** (Base/Arbitrum/Polygon): a Relay deposit-address quote
     (origin USDC → Arc USDC), relayed to that deposit address via PayAI's
     x402 facilitator, which pays the origin gas. Relay's solvers deliver on
     Arc.
4. **Settlement** — same-chain is complete the moment it's relayed;
   cross-chain is tracked to completion by polling Relay's status endpoint
   by deposit address (proxied through the `status` action to avoid browser
   CORS) until it reports the Arc-side fill.
5. **The URL hash is the only "database"** — `{invoiceId, destination,
   amount, meta}`, plus the relay result once available so reopening the
   link shows "settled" without re-scanning.

## Arc settlement notes

- **Arc**: chain id `5042`, mainnet live 2026-09-16, ~500ms blocks. USDC
  for transfers/EIP-3009 is the **ERC-20** representation at `0x3600…0000`
  (6 decimals) — the native gas asset (`0x0000…0000`, 18 dec) can't do
  EIP-3009. Both settlement paths deliver this ERC-20 USDC, so the merchant
  receives one consistent asset however they were paid.
- **Origins**: Base, Arbitrum, Polygon (via PayAI + Relay), and Arc itself
  (same-chain via [Arcus](https://facilitator.arcusnetwork.co)). Ethereum
  mainnet and Optimism aren't covered by a gasless path and are excluded.
- **Facilitators**: PayAI (`facilitator.payai.network`) for the EVM
  origins; Arcus (`facilitator.arcusnetwork.co`) for Arc. Arcus is the only
  facilitator that covers Arc, so it's what makes Arc→Arc possible. If Arcus
  is unavailable, same-chain settles fail safely — funds stay at the derived
  address and settle on retry once it recovers.
- Earlier destinations (Solana, Robinhood Chain) and the unused NEAR 1Click
  status path were removed in the Arc pivot; the share-hash format is `v7`.

## Setup

```bash
npm install
npm run dev            # Vite frontend only
```

The frontend calls the relay backend at the same-origin `/api/relay` by
default, so there's nothing to configure for the client. To exercise the
serverless function locally (address derivation, relays, quotes), run it
with the Vercel CLI, which serves both the frontend and `api/`:

```bash
cp .env.local.example .env.local   # then fill in INVOICE_MASTER_SECRET
npx vercel dev
```

```bash
npm run build   # tsc -b && vite build — outputs dist/
```

### Environment variables

The function reads these **server-side** (set them in Vercel → Project
Settings → Environment Variables, or `.env.local` for `vercel dev`). None
are `VITE_`-prefixed, so none are exposed to the browser bundle — see
[`.env.local.example`](.env.local.example):

| Variable | Required | Purpose |
| --- | --- | --- |
| `INVOICE_MASTER_SECRET` | **yes** | Master secret every invoice keypair is derived from. Treat as highly sensitive — leaking it exposes every invoice's funds. |
| `RELAY_API_KEY` | no | relay.link API key; only raises the rate-limit ceiling. |
| `PUBLIC_APP_URL` | no | Origin used to build `createInvoiceUrl` share links (default `https://www.invoices.wtf`). |
| `VITE_RELAY_API_URL` | no | Client override to point the app at a separately-hosted backend instead of same-origin `/api/relay`. |

### Deploy (Vercel)

Import the repo into Vercel — the Vite frontend and the `api/` function are
detected automatically (build outputs `dist/`). Set `INVOICE_MASTER_SECRET`
(and any optional vars above) in the project's environment variables, then
deploy. No Biconomy/Across keys; everything else (RPCs, status polling) is
public and keyless.

The static API reference page is served at `/api-docs` (kept out of the
reserved `/api` serverless namespace).

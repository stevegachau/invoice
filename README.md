# Invoices | Self-Routing Payments

A cross-chain USDC invoicing app. Issue an invoice, get one link. Your
customer sends USDC on whichever of 3 chains they hold it on; it's
forwarded to your payout address automatically, gaslessly — no wallet
connect, no chain selection, no gas ever required from either side.

## Architecture

The relay backend ships **in this same repo** as a stateless Vercel
serverless function at [`api/relay.js`](api/relay.js) (exposed at
`/api/relay`). It was originally a separate Google Cloud Function
(`invoice-relay-fn`); the logic is unchanged, only the HTTP entrypoint was
swapped so the frontend and backend deploy together — one repo, one
origin, no CORS, no separate backend URL to configure. Quick summary of
how the two halves fit together:

1. **Issuing an invoice** generates a random `invoiceId` client-side and
   calls the backend's `address` action, which deterministically derives
   a plain EOA address from `HMAC(masterSecret, invoiceId)` — same
   address on Base, Arbitrum, and Polygon automatically, since it's a
   real keypair, not a smart-contract account.
2. **The frontend polls that address** across the 3 chains directly
   against public RPCs (no backend involved in this step) — same
   adaptive log-scanning approach used throughout this project.
3. **On detecting inflow**, it calls the backend's `relay` action with
   `{invoiceId, chainId, destination}`. The backend re-reads the live
   balance itself (never trusts the frontend's number) and either relays
   directly (same-chain) or via a NEAR 1Click quote (cross-chain,
   including to Solana), through PayAI's free x402 facilitator — which
   pays the gas. See `invoice-relay-fn`'s README for the full mechanism
   and the debugging history behind why it's built this way (in short: a
   Biconomy MEE-based pre-signed approach was tried first and abandoned —
   its sponsorship/feeToken modes turned out not to support "sign now,
   wait indefinitely for an unknown future deposit" cleanly).
4. **Cross-chain relays** get tracked to completion by polling 1Click's
   own `/v0/status` endpoint directly from the browser; same-chain
   relays are complete the moment the relay call returns.
5. **The URL hash is still the only "database"** — same principle as
   before, just carrying less: `{invoiceId, destination, amount, meta}`,
   plus the relay result once available so reopening the link shows
   "complete" without re-scanning.

## What changed from the MEE/Across version

Everything that used to live in `abi.ts`, `across.ts`, `solanaInvoice.ts`,
`useSolanaSettlement.ts`, and most of `invoice.ts` is gone — that
functionality now lives entirely in `invoice-relay-fn`. The
`@biconomy/abstractjs` dependency is removed. `InvoicePay.tsx` and the old
`SolanaInvoicePay.tsx` are merged into one component, since both EVM and
Solana destinations now go through the same backend call shape.

Supported chains dropped from 5 to 3 (Base, Arbitrum, Polygon) — matches
exactly what PayAI's facilitator covers gaslessly, confirmed live against
its `/supported` endpoint. Ethereum mainnet and Optimism were removed
rather than kept as a degraded "not actually gasless" option.

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

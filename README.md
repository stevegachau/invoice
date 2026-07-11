# Invoices | Self-Routing Payments

A cross-chain USDC invoicing app. Issue an invoice, get one link. Your
customer sends USDC on whichever of 3 chains they hold it on; it's
forwarded to your payout address automatically, gaslessly — no wallet
connect, no chain selection, no gas ever required from either side.

## Architecture

This app pairs with **`invoice-relay-fn`**, a separate stateless Cloud
Function — see that project's README for the backend side. Quick summary
of how they fit together:

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
cp .env.local.example .env.local
# set VITE_RELAY_API_URL to your deployed invoice-relay-fn URL
npm run dev
```

No Biconomy key, no Across key — the only thing this frontend needs is
the relay backend's URL. Everything else (RPCs, 1Click status polling) is
public and keyless.

```bash
npm run build   # tsc -b && vite build — verified clean, outputs dist/
```

Deploy `dist/` anywhere static (Vercel, Netlify, Cloudflare Pages, GitHub
Pages). Set `VITE_RELAY_API_URL` as an environment variable on whatever
platform you use, then redeploy.

# Invoices — USDC settlement on Arc

Send one link, get paid in USDC on **Arc**, Circle's USDC-native L1.

Your customer pays from whichever chain they already hold USDC on — Base,
Arbitrum, Polygon, or Arc — with no wallet connect and no gas. The funds
always land as USDC in your account on Arc.

## Features

- **One link, any chain in.** A single payment link works across all
  supported networks.
- **Always settles on Arc.** Payers on Arc settle instantly; payers on
  other chains are bridged in automatically.
- **Gasless for both sides.** No native gas token required to pay or
  receive.
- **No accounts, no database.** Everything an invoice needs travels in the
  link itself.

## Supported networks

Pay from **Base**, **Arbitrum**, **Polygon**, or **Arc**. Settlement is
always USDC on **Arc** (chain id `5042`).

## Tech

- React + Vite + TypeScript frontend (Tailwind).
- A serverless API under [`api/`](api/) (deploys on Vercel alongside the
  frontend).
- Cross-chain settlement via [Relay](https://relay.link).

## Getting started

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

### Configuration

Copy the example env file and fill in the values, then run with the Vercel
CLI to serve the frontend and API together:

```bash
cp .env.local.example .env.local
npx vercel dev
```

See [`.env.local.example`](.env.local.example) for the available settings.
All secrets are read server-side only and are never bundled into the
client.

## Deploy

Import the repo into Vercel. The frontend and the `api/` functions are
detected automatically; set the environment variables from
`.env.local.example` in the project settings and deploy.

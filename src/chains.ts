import { base, arbitrum, polygon } from "viem/chains";
import type { Address } from "viem";

// Only these 3 — matches invoice-relay-fn's chains.js exactly, which in
// turn matches what PayAI's facilitator actually covers (confirmed live
// against its /supported endpoint). Ethereum mainnet and Optimism are
// genuinely not covered — don't add them back here without a working
// gasless-relay path for them first.
export const CHAINS = [base, arbitrum, polygon] as const;

export type SupportedChainId = (typeof CHAINS)[number]["id"];

export const CHAIN_LABEL: Record<SupportedChainId, string> = {
  [base.id]: "Base",
  [arbitrum.id]: "Arbitrum",
  [polygon.id]: "Polygon",
};

export const USDC: Record<SupportedChainId, Address> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [arbitrum.id]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  [polygon.id]: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // native USDC, not bridged USDC.e
};

export const RPC_URLS: Record<SupportedChainId, string[]> = {
  [base.id]: [
    "https://mainnet.base.org",
    "https://base.publicnode.com",
    "https://base-rpc.publicnode.com",
  ],
  [arbitrum.id]: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.publicnode.com"],
  [polygon.id]: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"],
};

// Rough average block times (ms) — used only to estimate a starting block
// for the client-side balance-inflow scan, same as before.
export const BLOCK_TIME_MS: Record<SupportedChainId, number> = {
  [base.id]: 2000,
  [arbitrum.id]: 260,
  [polygon.id]: 2100,
};

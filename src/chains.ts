import { base, arbitrum, polygon } from "viem/chains";
import type { Address } from "viem";

// Origin chains — where payers send USDC from. Only these 3, matching the
// relay function's origins, which in turn match what PayAI's facilitator
// covers gaslessly (confirmed live against its /supported endpoint).
// Ethereum mainnet and Optimism are genuinely not covered — don't add them
// back without a working gasless-relay path first. Arc is NOT here: it's
// the settlement destination, never an origin (see ARC below).
export const CHAINS = [base, arbitrum, polygon] as const;

export type SupportedChainId = (typeof CHAINS)[number]["id"];

export const CHAIN_LABEL: Record<SupportedChainId, string> = {
  [base.id]: "Base",
  [arbitrum.id]: "Arbitrum",
  [polygon.id]: "Polygon",
};

// Arc — Circle's USDC-native L1 and the one settlement chain. Every invoice
// pays out here in USDC (Arc's native gas asset). Chain id 5042, mainnet
// live 2026-09-16. We never read balances or relay FROM Arc, so it isn't a
// viem chain in CHAINS — this descriptor is only for display and the
// settlement explorer link. Explorer URL confirmed via Relay's /chains.
export const ARC = {
  id: 5042,
  label: "Arc",
  explorerUrl: "https://explorer.arc.io",
} as const;

export function arcTxUrl(txHash: string): string {
  return `${ARC.explorerUrl}/tx/${txHash}`;
}

export function arcAddressUrl(address: string): string {
  return `${ARC.explorerUrl}/address/${address}`;
}

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
  [polygon.id]: [
    // polygon-rpc.com dropped — confirmed dead in testing.
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.llamarpc.com",
    "https://rpc.ankr.com/polygon",
    "https://1rpc.io/matic",
  ],
};

// Rough average block times (ms) — used only to estimate a starting block
// for the client-side balance-inflow scan, same as before.
export const BLOCK_TIME_MS: Record<SupportedChainId, number> = {
  [base.id]: 2000,
  [arbitrum.id]: 260,
  [polygon.id]: 2100,
};

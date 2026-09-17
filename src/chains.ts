import { base, arbitrum, polygon } from "viem/chains";
import { defineChain, type Address } from "viem";

export const ARC_EXPLORER = "https://explorer.arc.io";

// Arc — Circle's USDC-native L1, chain id 5042 (mainnet live 2026-09-16).
// viem doesn't ship an Arc chain yet, so define a minimal one. On Arc, USDC
// for transfers/EIP-3009 is the ERC-20 representation at 0x3600…0000 (6
// decimals); the native gas asset (18 decimals) can't do EIP-3009, so all
// movement here uses the ERC-20 form. ~500ms blocks.
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC_EXPLORER } },
});

// Networks a payer can send USDC from. Base/Arbitrum/Polygon bridge to Arc
// via Relay (gas paid by PayAI's facilitator); Arc itself is here too, so a
// payer already on Arc settles same-chain with no bridge (gas paid by the
// Arcus facilitator). Every invoice still SETTLES on Arc — that's fixed;
// this list is just where funds can come FROM.
export const CHAINS = [base, arbitrum, polygon, arc] as const;

// Arc is always the settlement chain, whoever pays.
export const SETTLEMENT_CHAIN_ID = arc.id;

export type SupportedChainId = (typeof CHAINS)[number]["id"];

export const CHAIN_LABEL: Record<SupportedChainId, string> = {
  [base.id]: "Base",
  [arbitrum.id]: "Arbitrum",
  [polygon.id]: "Polygon",
  [arc.id]: "Arc",
};

export function arcTxUrl(txHash: string): string {
  return `${ARC_EXPLORER}/tx/${txHash}`;
}

export function arcAddressUrl(address: string): string {
  return `${ARC_EXPLORER}/address/${address}`;
}

export const USDC: Record<SupportedChainId, Address> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [arbitrum.id]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  [polygon.id]: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // native USDC, not bridged USDC.e
  [arc.id]: "0x3600000000000000000000000000000000000000", // ERC-20 USDC (6 dec)
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
  [arc.id]: ["https://rpc.mainnet.arc.io"],
};

// Rough average block times (ms) — used only to estimate a starting block
// for the client-side balance-inflow scan, same as before. Arc runs ~500ms
// blocks (measured live), so its block numbers climb fast — the estimate
// matters most here.
export const BLOCK_TIME_MS: Record<SupportedChainId, number> = {
  [base.id]: 2000,
  [arbitrum.id]: 260,
  [polygon.id]: 2100,
  [arc.id]: 500,
};

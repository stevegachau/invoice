import { base, arbitrum, polygon } from "viem/chains";
import { defineChain, type Address } from "viem";

export const ARC_EXPLORER = "https://explorer.arc.io";

// Arc (chain 5042). viem doesn't ship it yet, so define a minimal chain.
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC_EXPLORER } },
});

// Networks a payer can send USDC from. Settlement is always Arc.
export const CHAINS = [base, arbitrum, polygon, arc] as const;

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
  [polygon.id]: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  [arc.id]: "0x3600000000000000000000000000000000000000",
};

export const RPC_URLS: Record<SupportedChainId, string[]> = {
  [base.id]: [
    "https://mainnet.base.org",
    "https://base.publicnode.com",
    "https://base-rpc.publicnode.com",
  ],
  [arbitrum.id]: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.publicnode.com"],
  [polygon.id]: [
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.llamarpc.com",
    "https://rpc.ankr.com/polygon",
    "https://1rpc.io/matic",
  ],
  [arc.id]: ["https://rpc.mainnet.arc.io"],
};

// Approximate block times (ms), used to estimate a scan start block.
export const BLOCK_TIME_MS: Record<SupportedChainId, number> = {
  [base.id]: 2000,
  [arbitrum.id]: 260,
  [polygon.id]: 2100,
  [arc.id]: 500,
};

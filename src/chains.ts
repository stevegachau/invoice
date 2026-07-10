import { mainnet, arbitrum, optimism, base, polygon } from "viem/chains";
import type { Address } from "viem";

export const CHAINS = [mainnet, arbitrum, optimism, base, polygon] as const;
export type SupportedChainId = (typeof CHAINS)[number]["id"];

export const CHAIN_LABEL: Record<SupportedChainId, string> = {
  [mainnet.id]: "Ethereum",
  [arbitrum.id]: "Arbitrum",
  [optimism.id]: "Optimism",
  [base.id]: "Base",
  [polygon.id]: "Polygon",
};

// Approximate block times. Used to translate `issuedAt` into a starting block
// for log scans so we don't query unbounded ranges.
export const BLOCK_TIME_MS: Record<SupportedChainId, number> = {
  [mainnet.id]: 12_000,
  [arbitrum.id]: 250,
  [optimism.id]: 2_000,
  [base.id]: 2_000,
  [polygon.id]: 2_000,
};

// CORS-friendly public RPCs. We use multiple per chain and let viem's
// `fallback` transport rotate on failure. Override any of these via
// VITE_RPC_<NAME> in env.local to use a private endpoint (Alchemy/Infura/etc).
const env = import.meta.env as Record<string, string | undefined>;

export const RPC_URLS: Record<SupportedChainId, string[]> = {
  [mainnet.id]: [
    env.VITE_RPC_MAINNET,
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
  ].filter(Boolean) as string[],
  [arbitrum.id]: [
    env.VITE_RPC_ARBITRUM,
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
    "https://rpc.ankr.com/arbitrum",
  ].filter(Boolean) as string[],
  [optimism.id]: [
    env.VITE_RPC_OPTIMISM,
    "https://optimism-rpc.publicnode.com",
    "https://mainnet.optimism.io",
    "https://rpc.ankr.com/optimism",
  ].filter(Boolean) as string[],
  [base.id]: [
    env.VITE_RPC_BASE,
    "https://base-rpc.publicnode.com",
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
  ].filter(Boolean) as string[],
  [polygon.id]: [
    env.VITE_RPC_POLYGON,
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon-rpc.com",
    "https://rpc.ankr.com/polygon",
  ].filter(Boolean) as string[],
};

// Canonical USDC on each chain
export const USDC: Record<SupportedChainId, Address> = {
  [mainnet.id]: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  [arbitrum.id]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  [optimism.id]: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [polygon.id]: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};

// Across V3 SpokePool (verified against suggested-fees response)
export const ACROSS_SPOKE: Record<SupportedChainId, Address> = {
  [mainnet.id]: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
  [arbitrum.id]: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
  [optimism.id]: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
  [base.id]: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
  [polygon.id]: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
};

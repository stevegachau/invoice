import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
  greaterThanOrEqualTo,
} from "@biconomy/abstractjs";
import { erc20Abi, fallback, http, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAINS, RPC_URLS, USDC, ACROSS_SPOKE } from "./chains";
import { depositNowAbi } from "./abi";
import { fetchAcrossQuote } from "./across";
import {
  SOLANA_CHAIN_ID,
  SOLANA_USDC_MINT,
  solanaPubkeyToBytes32,
  isValidSolanaPubkey,
} from "./solana";
import { makeInvoiceNumber } from "./invoice";

// This mirrors invoice.ts's issueInvoice/issueAllChains, but for a Solana
// destination. Two structural differences from the EVM flow, both forced
// by Solana having no Nexus/ERC-4337 equivalent:
//
// 1. Bridges go straight to the payee's real Solana wallet. There's no
//    smart account to receive-then-forward on the Solana side, so the
//    "destForward" instruction from the EVM flow doesn't exist here — the
//    bridge `recipient` IS the final payee.
// 2. Settlement tracking loses the "unique address = unambiguously this
//    invoice" property for the final leg (see useSolanaSettlement.ts),
//    since payee's wallet isn't disposable the way the EVM smart account
//    is. Source-leg tracking (funds arriving at the smart account on the
//    origin EVM chain) is unaffected.
//
// Verified live: this exact `depositNow` call, encoded by hand, landed
// 9.838564 USDC from Base to a real Solana wallet in ~3 seconds.

export type SolanaInvoice = {
  payeeSolanaAddress: string; // base58
  amount: bigint; // USDC, 6 decimals
};

export type SolanaInvoiceMeta = {
  companyName: string;
  description: string;
};

export type IssuedSolanaInvoice = {
  kind: "solana";
  invoice: SolanaInvoice;
  meta: SolanaInvoiceMeta;
  invoiceAddress: Address; // same address on all 5 EVM origin chains
  invoiceNumber: string;
  issuedAt: number;
  expiresAt: number;
  supertx: { hash?: `0x${string}`; error?: string };
};

const ISSUE_LIFETIME_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
const SIMULATION_RETRY_MS = 60_000;
const FILL_DEADLINE_OFFSET = 4 * 60 * 60; // 4h
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export async function issueSolanaInvoice(
  invoice: SolanaInvoice,
  meta: SolanaInvoiceMeta,
  apiKey: string,
): Promise<IssuedSolanaInvoice> {
  if (!isValidSolanaPubkey(invoice.payeeSolanaAddress)) {
    throw new Error(
      `"${invoice.payeeSolanaAddress}" is not a valid Solana address`,
    );
  }

  const ephemeralKey = generatePrivateKey();
  const eoa = privateKeyToAccount(ephemeralKey);

  const orchestrator = await toMultichainNexusAccount({
    signer: eoa,
    chainConfigurations: CHAINS.map((chain) => ({
      chain,
      transport: fallback(
        RPC_URLS[chain.id].map((url) =>
          http(url, { timeout: 10_000, retryCount: 1 }),
        ),
        { rank: false, retryCount: 1 },
      ),
      version: getMEEVersion(MEEVersion.V2_1_0),
    })),
  });

  const meeClient = await createMeeClient({ account: orchestrator, apiKey });

  const issuedAt = Date.now();
  const expiresAt = issuedAt + ISSUE_LIFETIME_MS;
  const upperBoundTimestamp = Math.floor(expiresAt / 1000);

  // Same address on every EVM chain regardless of destination — pick any
  // of the 5 for display/tracking purposes.
  const invoiceAddress = orchestrator.addressOn(CHAINS[0].id, true);

  const recipientBytes32 = solanaPubkeyToBytes32(invoice.payeeSolanaAddress);
  const outputTokenBytes32 = solanaPubkeyToBytes32(SOLANA_USDC_MINT);

  const supertx = await (async () => {
    try {
      const bridgeInstructions = (
        await Promise.all(
          CHAINS.map(async (origin) => {
            const smartAddrOnOrigin = orchestrator.addressOn(origin.id, true);

            const acrossQuote = await fetchAcrossQuote({
              inputToken: USDC[origin.id],
              outputToken: SOLANA_USDC_MINT,
              originChainId: origin.id,
              destinationChainId: SOLANA_CHAIN_ID,
              amount: invoice.amount,
              recipient: invoice.payeeSolanaAddress,
            });

            const approve = await orchestrator.buildComposable({
              type: "approve",
              data: {
                chainId: origin.id,
                tokenAddress: USDC[origin.id],
                spender: ACROSS_SPOKE[origin.id],
                amount: invoice.amount,
              },
            });

            const bridge = await orchestrator.buildComposable({
              type: "default",
              data: {
                chainId: origin.id,
                to: ACROSS_SPOKE[origin.id],
                abi: depositNowAbi,
                functionName: "depositNow",
                args: [
                  addressToBytes32(smartAddrOnOrigin),
                  recipientBytes32,
                  addressToBytes32(USDC[origin.id]),
                  outputTokenBytes32,
                  invoice.amount,
                  acrossQuote.outputAmount,
                  SOLANA_CHAIN_ID,
                  ZERO_BYTES32,
                  FILL_DEADLINE_OFFSET,
                  0,
                  "0x",
                ],
                conditions: [
                  {
                    targetContract: USDC[origin.id],
                    functionAbi: erc20Abi,
                    functionName: "balanceOf",
                    args: [smartAddrOnOrigin],
                    constraint: greaterThanOrEqualTo(invoice.amount),
                    description: "Wait for USDC ≥ invoice.amount on origin",
                  },
                ],
              },
            });

            return [approve, bridge];
          }),
        )
      ).flat();

      const quote = await meeClient.getQuote({
        sponsorship: true,
        instructions: bridgeInstructions,
        upperBoundTimestamp,
        executionSimulationRetryDelay: SIMULATION_RETRY_MS,
      });

      const { hash } = await meeClient.executeQuote({ quote });
      return { hash };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();

  void ephemeralKey;

  return {
    kind: "solana",
    invoice,
    meta,
    invoiceAddress,
    invoiceNumber: makeInvoiceNumber(invoiceAddress),
    issuedAt,
    expiresAt,
    supertx,
  };
}

function addressToBytes32(address: Address): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

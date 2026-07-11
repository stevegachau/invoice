import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
  greaterThanOrEqualTo,
  getMeeScanLink,
} from "@biconomy/abstractjs";
import { erc20Abi, fallback, http, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  CHAINS,
  RPC_URLS,
  USDC,
  ACROSS_SPOKE,
  type SupportedChainId,
} from "./chains";
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
//
// A bigger structural difference: this issues 5 INDEPENDENT supertxs, one
// per origin chain, instead of one combined supertx like the EVM flow.
// Reason: MEE's feeToken is one declaration per quote. On the EVM flow that
// works fine as a single combined supertx because the fee is always paid
// on the *destination* chain, which is fixed regardless of which origin
// the payer uses. Solana has no fixed EVM anchor point — the bridge goes
// straight from whichever origin gets funded, so there's no single chain
// to always point the fee at. Splitting into 5 independent supertxs, each
// fee-tokened to its OWN origin chain, means whichever one the payer
// actually funds is self-contained: its own balance pays its own fee, no
// guessing which single chain to anchor to. Each gets the same two-pass
// probe-then-reduce treatment invoice.ts's single destination leg didn't
// need (that one tolerates the fee via a live-balance sweep; these don't,
// since each bridge instruction's inputAmount is fixed).

export type SolanaInvoice = {
  payeeSolanaAddress: string; // base58
  amount: bigint; // USDC, 6 decimals
};

export type SolanaInvoiceMeta = {
  companyName: string;
  description: string;
};

export type PerChainSupertx = {
  chainId: SupportedChainId;
  hash?: `0x${string}`;
  meeScanLink?: string;
  meeFeeAmount?: bigint;
  error?: string;
};

export type IssuedSolanaInvoice = {
  kind: "solana";
  invoice: SolanaInvoice;
  meta: SolanaInvoiceMeta;
  invoiceAddress: Address; // same address on all 5 EVM origin chains
  invoiceNumber: string;
  issuedAt: number;
  expiresAt: number;
  // One independent, self-contained supertx per origin chain — see note
  // above for why this can't be a single combined supertx the way the EVM
  // flow is.
  supertxs: PerChainSupertx[];
};

const ISSUE_LIFETIME_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
const SIMULATION_RETRY_MS = 60_000;
const FILL_DEADLINE_OFFSET = 4 * 60 * 60; // 4h
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

type Orchestrator = Awaited<ReturnType<typeof toMultichainNexusAccount>>;
type MeeClient = Awaited<ReturnType<typeof createMeeClient>>;

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

  // Fully independent per origin — one chain's failure (bad quote, no
  // liquidity, whatever) doesn't block the other 4 from being issued.
  const supertxs = await Promise.all(
    CHAINS.map((origin) =>
      issueOneChain({
        origin: origin.id,
        orchestrator,
        meeClient,
        invoice,
        upperBoundTimestamp,
      }),
    ),
  );

  void ephemeralKey;

  return {
    kind: "solana",
    invoice,
    meta,
    invoiceAddress,
    invoiceNumber: makeInvoiceNumber(invoiceAddress),
    issuedAt,
    expiresAt,
    supertxs,
  };
}

async function issueOneChain({
  origin,
  orchestrator,
  meeClient,
  invoice,
  upperBoundTimestamp,
}: {
  origin: SupportedChainId;
  orchestrator: Orchestrator;
  meeClient: MeeClient;
  invoice: SolanaInvoice;
  upperBoundTimestamp: number;
}): Promise<PerChainSupertx> {
  try {
    // Pass 1: build with the full amount, purely to read MEE's real fee
    // for this specific chain from getQuote(). Never executed.
    const probeInstructions = await buildOneChainInstructions({
      orchestrator,
      invoice,
      origin,
      amount: invoice.amount,
    });

    const probeQuote = await meeClient.getQuote({
      feeToken: { address: USDC[origin], chainId: origin },
      instructions: probeInstructions,
      upperBoundTimestamp,
      executionSimulationRetryDelay: SIMULATION_RETRY_MS,
    });

    const meeFeeAmount = parseMeeFeeAmount(probeQuote.paymentInfo?.tokenAmount);

    if (meeFeeAmount !== undefined && meeFeeAmount >= invoice.amount) {
      throw new Error(
        `Invoice amount (${invoice.amount}) is too small to cover the MEE fee (${meeFeeAmount}) on this chain.`,
      );
    }

    // Pass 2: rebuild with the amount reduced by the known fee, so the
    // balance-gate can still trip once that fee is deducted from this same
    // chain's balance. This is the quote actually signed/executed.
    const amount =
      meeFeeAmount !== undefined ? invoice.amount - meeFeeAmount : invoice.amount;

    const finalInstructions = await buildOneChainInstructions({
      orchestrator,
      invoice,
      origin,
      amount,
    });

    const quote = await meeClient.getQuote({
      feeToken: { address: USDC[origin], chainId: origin },
      instructions: finalInstructions,
      upperBoundTimestamp,
      executionSimulationRetryDelay: SIMULATION_RETRY_MS,
    });

    const { hash } = await meeClient.executeQuote({ quote });
    const meeScanLink = getMeeScanLink(hash);
    console.log(`MEE Scan [chain ${origin}]:`, meeScanLink, "| fee:", meeFeeAmount);
    return { chainId: origin, hash, meeScanLink, meeFeeAmount };
  } catch (e) {
    return { chainId: origin, error: e instanceof Error ? e.message : String(e) };
  }
}

async function buildOneChainInstructions({
  orchestrator,
  invoice,
  origin,
  amount,
}: {
  orchestrator: Orchestrator;
  invoice: SolanaInvoice;
  origin: SupportedChainId;
  amount: bigint;
}) {
  const recipientBytes32 = solanaPubkeyToBytes32(invoice.payeeSolanaAddress);
  const outputTokenBytes32 = solanaPubkeyToBytes32(SOLANA_USDC_MINT);
  const smartAddrOnOrigin = orchestrator.addressOn(origin, true);

  const acrossQuote = await fetchAcrossQuote({
    inputToken: USDC[origin],
    outputToken: SOLANA_USDC_MINT,
    originChainId: origin,
    destinationChainId: SOLANA_CHAIN_ID,
    amount,
    recipient: invoice.payeeSolanaAddress,
  });

  const approve = await orchestrator.buildComposable({
    type: "approve",
    data: {
      chainId: origin,
      tokenAddress: USDC[origin],
      spender: ACROSS_SPOKE[origin],
      amount,
    },
  });

  const bridge = await orchestrator.buildComposable({
    type: "default",
    data: {
      chainId: origin,
      to: ACROSS_SPOKE[origin],
      abi: depositNowAbi,
      functionName: "depositNow",
      args: [
        addressToBytes32(smartAddrOnOrigin),
        recipientBytes32,
        addressToBytes32(USDC[origin]),
        outputTokenBytes32,
        amount,
        acrossQuote.outputAmount,
        SOLANA_CHAIN_ID,
        ZERO_BYTES32,
        FILL_DEADLINE_OFFSET,
        0,
        "0x",
      ],
      conditions: [
        {
          targetContract: USDC[origin],
          functionAbi: erc20Abi,
          functionName: "balanceOf",
          args: [smartAddrOnOrigin],
          constraint: greaterThanOrEqualTo(amount),
          description: "Wait for USDC ≥ amount on origin",
        },
      ],
    },
  });

  return [approve, bridge];
}

function parseMeeFeeAmount(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return BigInt(value as string | number | bigint);
  } catch {
    return undefined;
  }
}

function addressToBytes32(address: Address): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
  runtimeERC20BalanceOf,
  greaterThanOrEqualTo,
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
import { spokePoolAbi } from "./abi";
import { fetchAcrossQuote } from "./across";

export type Invoice = {
  payeeAddress: Address;
  destinationChainId: SupportedChainId;
  amount: bigint;
};

export type InvoiceMeta = {
  companyName: string;
  description: string;
};

export type Supertx = {
  hash?: `0x${string}`;
  error?: string;
};

export type IssuedInvoice = {
  invoice: Invoice;
  meta: InvoiceMeta;
  invoiceAddress: Address;
  invoiceNumber: string;
  issuedAt: number;
  expiresAt: number;
  supertx: Supertx;
};

// MEE caps the execution window at exactly 86400s. The node also pads the
// lower bound by ~90s (clock-skew buffer), so we stay a few minutes under
// 24h to avoid a "window > 86400s" rejection.
const ISSUE_LIFETIME_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
const SIMULATION_RETRY_MS = 60_000;

export function makeInvoiceNumber(invoiceAddress: Address): string {
  return `INV-${invoiceAddress.slice(-6).toUpperCase()}`;
}

type Orchestrator = Awaited<ReturnType<typeof toMultichainNexusAccount>>;
type MeeClient = Awaited<ReturnType<typeof createMeeClient>>;

async function buildOrchestrator(eoa: ReturnType<typeof privateKeyToAccount>) {
  return toMultichainNexusAccount({
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
}

export async function issueInvoice(
  invoice: Invoice,
  meta: InvoiceMeta,
  apiKey: string,
): Promise<IssuedInvoice> {
  const ephemeralKey = generatePrivateKey();
  const eoa = privateKeyToAccount(ephemeralKey);
  const orchestrator = await buildOrchestrator(eoa);
  const meeClient = await createMeeClient({ account: orchestrator, apiKey });

  const issuedAt = Date.now();
  const expiresAt = issuedAt + ISSUE_LIFETIME_MS;
  const upperBoundTimestamp = Math.floor(expiresAt / 1000);

  const invoiceAddress = orchestrator.addressOn(
    invoice.destinationChainId,
    true,
  );

  const supertx: Supertx = await issueAllChains({
    orchestrator,
    meeClient,
    invoice,
    upperBoundTimestamp,
  })
    .then((hash) => ({ hash }))
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  // The ephemeral key has signed and submitted the supertx to the MEE node.
  // It is no longer needed — settlement is autonomous from here. The node
  // waits for the runtime GTE balance check to pass (i.e. for USDC to arrive
  // at the invoice address), then fires whichever instruction matches.
  void ephemeralKey;

  return {
    invoice,
    meta,
    invoiceAddress,
    invoiceNumber: makeInvoiceNumber(invoiceAddress),
    issuedAt,
    expiresAt,
    supertx,
  };
}

async function issueAllChains({
  orchestrator,
  meeClient,
  invoice,
  upperBoundTimestamp,
}: {
  orchestrator: Orchestrator;
  meeClient: MeeClient;
  invoice: Invoice;
  upperBoundTimestamp: number;
}): Promise<`0x${string}`> {
  const dest = invoice.destinationChainId;
  const smartAddrOnDest = orchestrator.addressOn(dest, true);

  // Destination instruction — sweep the entire USDC balance to the payee.
  // Gated on ≥ 1 base unit so it fires as soon as anything lands: a direct
  // payment on dest, a bridge fill (which arrives net of relayer fees), or
  // any combination. The transferred amount is the live balanceOf.
  const destForward = await orchestrator.buildComposable({
    type: "default",
    data: {
      chainId: dest,
      to: USDC[dest],
      abi: erc20Abi,
      functionName: "transfer",
      args: [
        invoice.payeeAddress,
        runtimeERC20BalanceOf({
          tokenAddress: USDC[dest],
          targetAddress: smartAddrOnDest,
          constraints: [greaterThanOrEqualTo(1n)],
        }),
      ],
    },
  });

  // depositV3Now resolves quoteTimestamp/fillDeadline at execution time,
  // so each bridge stays valid for the full 24h pre-signed window. We waive
  // exclusivity (anyone can fill) so the deposit fills as fast as possible.
  const FILL_DEADLINE_OFFSET = 4 * 60 * 60; // 4h, ≤ chain's fillDeadlineBuffer
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

  const origins = CHAINS.filter((c) => c.id !== dest).map((c) => c.id);

  const bridgeInstructions = (
    await Promise.all(
      origins.map(async (origin) => {
        const smartAddrOnOrigin = orchestrator.addressOn(origin, true);

        const acrossQuote = await fetchAcrossQuote({
          inputToken: USDC[origin],
          outputToken: USDC[dest],
          originChainId: origin,
          destinationChainId: dest,
          amount: invoice.amount,
          recipient: smartAddrOnOrigin,
        });

        const approve = await orchestrator.buildComposable({
          type: "approve",
          data: {
            chainId: origin,
            tokenAddress: USDC[origin],
            spender: ACROSS_SPOKE[origin],
            amount: invoice.amount,
          },
        });

        // STATIC_CALL precondition: the bridge cannot fire until the smart
        // account on origin actually holds USDC ≥ invoice.amount. Required
        // because `executionSimulationRetryDelay` only controls re-simulation
        // cadence — it does NOT itself gate execution.
        const bridge = await orchestrator.buildComposable({
          type: "default",
          data: {
            chainId: origin,
            to: ACROSS_SPOKE[origin],
            abi: spokePoolAbi,
            functionName: "depositV3Now",
            args: [
              smartAddrOnOrigin,
              smartAddrOnDest,
              USDC[origin],
              USDC[dest],
              invoice.amount,
              acrossQuote.outputAmount,
              BigInt(dest),
              ZERO_ADDRESS,
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
    instructions: [...bridgeInstructions, destForward],
    upperBoundTimestamp,
    executionSimulationRetryDelay: SIMULATION_RETRY_MS,
  });

  const { hash } = await meeClient.executeQuote({ quote });
  return hash;
}

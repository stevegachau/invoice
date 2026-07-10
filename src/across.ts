import type { Address } from "viem";

export type AcrossQuote = {
  outputAmount: bigint;
  totalRelayFee: bigint;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusiveRelayer: Address;
  exclusivityDeadline: number;
  spokePoolAddress: string;
};

// Across now requires a Bearer token + integratorId on every API call
// (confirmed live — the same request that worked in manual testing 400'd
// here until these were added). Get a key at docs.across.to/api-reference.
const env = import.meta.env as Record<string, string | undefined>;
const ACROSS_API_KEY = env.VITE_ACROSS_API_KEY;
const ACROSS_INTEGRATOR_ID = env.VITE_ACROSS_INTEGRATOR_ID ?? "0xdead";

function authHeaders(): HeadersInit {
  return ACROSS_API_KEY ? { Authorization: `Bearer ${ACROSS_API_KEY}` } : {};
}

// `outputToken`/`recipient` accept a plain string, not just `Address` —
// Solana destinations use base58 pubkeys, which aren't valid `Address`
// values. `destinationChainId` accepts `number | bigint` for the same
// reason (Solana's pseudo chain ID, 34268394551451, still fits in a JS
// number safely, but bigint is accepted so callers don't have to care).
export async function fetchAcrossQuote(params: {
  inputToken: Address;
  outputToken: Address | string;
  originChainId: number;
  destinationChainId: number | bigint;
  amount: bigint;
  recipient: Address | string;
}): Promise<AcrossQuote> {
  const url = new URL("https://app.across.to/api/suggested-fees");
  url.searchParams.set("inputToken", params.inputToken);
  url.searchParams.set("outputToken", params.outputToken);
  url.searchParams.set("originChainId", String(params.originChainId));
  url.searchParams.set(
    "destinationChainId",
    params.destinationChainId.toString(),
  );
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("recipient", params.recipient);
  url.searchParams.set("integratorId", ACROSS_INTEGRATOR_ID);

  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Across quote ${r.status}: ${await r.text()}`);
  const j = await r.json();

  return {
    outputAmount: BigInt(j.outputAmount),
    totalRelayFee: BigInt(j.totalRelayFee.total),
    quoteTimestamp: Number(j.timestamp),
    fillDeadline: Number(j.fillDeadline),
    exclusiveRelayer: j.exclusiveRelayer,
    exclusivityDeadline: Number(j.exclusivityDeadline),
    spokePoolAddress: j.spokePoolAddress,
  };
}

export type DepositStatus = {
  status: "pending" | "filled" | "expired" | "refunded" | "unknown";
  fillTx?: string;
  fillChainId?: number;
};

// NOTE: exact response field names here are inferred from Across's docs
// (docs.across.to mentions this endpoint but we haven't independently
// verified the response shape against a live call the way we did for
// /suggested-fees). Verify against a real depositId before relying on this
// in production — the status enum values in particular may not match
// exactly.
export async function fetchDepositStatus(params: {
  originChainId: number;
  depositId: string | bigint;
}): Promise<DepositStatus> {
  const url = new URL("https://app.across.to/api/deposit/status");
  url.searchParams.set("originChainId", String(params.originChainId));
  url.searchParams.set("depositId", params.depositId.toString());
  url.searchParams.set("integratorId", ACROSS_INTEGRATOR_ID);

  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Across deposit status ${r.status}: ${await r.text()}`);
  const j = await r.json();

  return {
    status: j.status ?? "unknown",
    fillTx: j.fillTx ?? j.fillTxHash,
    fillChainId: j.fillChainId ? Number(j.fillChainId) : undefined,
  };
}

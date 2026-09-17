import type { Address } from "viem";
import type { SupportedChainId } from "./chains";

// The only settlement destination is Arc (Circle's USDC-native L1). It's
// EVM-compatible, so the payout is a plain 0x address. Kept as a tagged
// object rather than a bare address so a second settlement chain could be
// added later without changing every call site.
export type Destination = { type: "arc"; address: Address };

// Every settlement is cross-chain (an origin chain -> Arc), so there's a
// single relayed shape. `chainId` is the ORIGIN the payer used.
export type RelayResult =
  | { status: "no-balance"; address: Address }
  | {
      status: "relayed";
      mode: "cross-chain";
      chainId: SupportedChainId;
      address: Address;
      amount: string;
      relayTxHash: string;
      bridgeDepositAddress: string;
      bridgeAmountOutEstimate?: string;
    };

// The relay backend now ships in this same repo as a Vercel serverless
// function at /api/relay, so it's same-origin by default — no env var, no
// CORS. VITE_RELAY_API_URL stays supported as an override for pointing at
// a separately-hosted backend (e.g. the old Cloud Run URL) during local
// dev or a split deploy.
function apiBaseUrl(): string {
  return (
    (import.meta.env as Record<string, string | undefined>).VITE_RELAY_API_URL ??
    "/api/relay"
  );
}

async function callApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(apiBaseUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? `Relay API ${res.status}`);
  }
  return json;
}

/** Derives (or re-derives) the invoice's deposit address. Same address on
 * all 3 origin chains — it's a plain EOA, not per-chain. */
export async function getInvoiceAddress(invoiceId: string): Promise<Address> {
  const { address } = await callApi<{ address: Address }>({
    action: "address",
    invoiceId,
  });
  return address;
}

/** Triggers a relay attempt for whatever's actually sitting at the invoice
 * address on `chainId` right now. The backend re-reads the live balance
 * itself — this never sends an amount, since sweeping the exact live
 * balance is what makes the whole thing safely stateless (see
 * invoice-relay-fn's README). */
export async function triggerRelay(params: {
  invoiceId: string;
  chainId: SupportedChainId;
  destination: Destination;
}): Promise<RelayResult> {
  return callApi<RelayResult>({ action: "relay", ...params });
}

export type PreviewQuote = {
  amountIn?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  timeEstimate?: number;
};

/** Dry-run quote — no real deposit address reserved, just an estimate of
 * how much USDC lands on Arc after Relay's bridging fee. Used by the
 * invoice form to preview the settlement amount before the invoice is
 * issued. */
export async function previewQuote(params: {
  originChainId: SupportedChainId;
  destination: Destination;
  amount: bigint;
}): Promise<PreviewQuote> {
  return callApi<PreviewQuote>({
    action: "previewQuote",
    originChainId: params.originChainId,
    destination: params.destination,
    amount: params.amount.toString(),
  });
}

import type { Address } from "viem";
import type { SupportedChainId } from "./chains";

// Settlement destination — always Arc.
export type Destination = { type: "arc"; address: Address };

// `chainId` is the origin the payer used.
export type RelayResult =
  | { status: "no-balance"; address: Address }
  | {
      status: "relayed";
      mode: "same-chain";
      chainId: SupportedChainId;
      address: Address;
      amount: string;
      relayTxHash: string;
    }
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

// Same-origin /api/relay by default; VITE_RELAY_API_URL overrides it.
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

/** The invoice's deposit address (same across all origin chains). */
export async function getInvoiceAddress(invoiceId: string): Promise<Address> {
  const { address } = await callApi<{ address: Address }>({
    action: "address",
    invoiceId,
  });
  return address;
}

/** Triggers settlement of whatever is at the invoice address on `chainId`. */
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

/** Estimate of how much USDC lands on Arc, for the invoice form preview. */
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

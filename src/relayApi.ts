import type { Address } from "viem";
import type { SupportedChainId } from "./chains";

export type Destination =
  | { type: "evm"; chainId: SupportedChainId; address: Address }
  | { type: "solana"; address: string };

export type RelayResult =
  | { status: "no-balance"; address: Address }
  | {
      status: "relayed";
      mode: "same-chain";
      address: Address;
      amount: string;
      relayTxHash: string;
    }
  | {
      status: "relayed";
      mode: "cross-chain";
      address: Address;
      amount: string;
      relayTxHash: string;
      oneClickDepositAddress: string;
      oneClickAmountOutEstimate?: string;
    };

function apiBaseUrl(): string {
  const url = (import.meta.env as Record<string, string | undefined>)
    .VITE_RELAY_API_URL;
  if (!url) {
    throw new Error(
      "VITE_RELAY_API_URL is not set — point it at the deployed invoice-relay-fn Cloud Run URL.",
    );
  }
  return url;
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
 * all 3 supported EVM chains — it's a plain EOA, not per-chain. */
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

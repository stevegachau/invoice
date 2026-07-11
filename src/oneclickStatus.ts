export type OneClickStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export type OneClickStatusResponse = {
  status: OneClickStatus;
  swapDetails?: {
    amountOutFormatted?: string;
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    // Confirmed live against a real completed invoice — this is the
    // actual step-3 delivery tx, not the origin-chain relay/deposit hash.
    // `explorerUrl` came back empty in that response, so the link shown
    // to the user is built from our own chain config instead of trusting
    // this field.
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
  };
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

// Proxied through our own backend rather than calling
// 1click.chaindefuser.com directly from the browser, to avoid any
// possible CORS restriction on a direct browser fetch().
export async function fetchOneClickStatus(
  depositAddress: string,
): Promise<OneClickStatusResponse> {
  const res = await fetch(apiBaseUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status", depositAddress }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? `Relay API ${res.status}`);
  }
  return json;
}

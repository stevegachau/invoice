// Relay's status values, confirmed live: waiting -> pending -> success
// (or refund/failure). Lowercase, unlike 1Click's uppercase enum — worth
// remembering if this ever gets compared against old logs/screenshots
// from before the switch.
export type BridgeStatus = "waiting" | "pending" | "success" | "refund" | "failure";

export type BridgeStatusResponse = {
  status: BridgeStatus;
  // The real step-3 delivery tx on the destination chain, once Relay
  // reports it (confirmed live under requests[0].data.outTxs[0].hash on
  // the backend) — distinct from relay.relayTxHash, which for a
  // cross-chain relay is only the step-2 bridge deposit on the origin
  // chain.
  destinationTxHash?: string;
  amountOutFormatted?: string;
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

// Proxied through our own backend rather than calling api.relay.link
// directly from the browser, to avoid any possible CORS restriction on a
// direct browser fetch(). Tracked by deposit address — Relay's own
// documented best practice, and what makes this resilient to a fresh
// browser reload with zero cached state (see useInvoiceSettlement.ts).
export async function fetchBridgeStatus(
  depositAddress: string,
): Promise<BridgeStatusResponse> {
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

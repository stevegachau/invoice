export type BridgeStatus = "waiting" | "pending" | "success" | "refund" | "failure";

export type BridgeStatusResponse = {
  status: BridgeStatus;
  destinationTxHash?: string;
  amountOutFormatted?: string;
};

// Same-origin /api/relay by default; VITE_RELAY_API_URL overrides it.
function apiBaseUrl(): string {
  return (
    (import.meta.env as Record<string, string | undefined>).VITE_RELAY_API_URL ??
    "/api/relay"
  );
}

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

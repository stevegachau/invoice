export type OneClickStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

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
// 1click.chaindefuser.com directly from the browser — a plain fetch() is
// subject to CORS, and if that API doesn't send permissive CORS headers on
// /v0/status, polling attempts fail silently and never converge. Our
// backend hits it server-to-server, no such restriction.
export async function fetchOneClickStatus(
  depositAddress: string,
): Promise<{ status: OneClickStatus }> {
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

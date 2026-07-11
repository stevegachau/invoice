const ONE_CLICK_BASE = "https://1click.chaindefuser.com/v0";

export type OneClickStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export async function fetchOneClickStatus(
  depositAddress: string,
): Promise<{ status: OneClickStatus; raw: unknown }> {
  const url = new URL(`${ONE_CLICK_BASE}/status`);
  url.searchParams.set("depositAddress", depositAddress);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`1Click /status ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return { status: json.status, raw: json };
}

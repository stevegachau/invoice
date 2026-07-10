import type { Address } from "viem";

export type AcrossQuote = {
  outputAmount: bigint;
  totalRelayFee: bigint;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusiveRelayer: Address;
  exclusivityDeadline: number;
};

export async function fetchAcrossQuote(params: {
  inputToken: Address;
  outputToken: Address;
  originChainId: number;
  destinationChainId: number;
  amount: bigint;
  recipient: Address;
}): Promise<AcrossQuote> {
  const url = new URL("https://app.across.to/api/suggested-fees");
  url.searchParams.set("inputToken", params.inputToken);
  url.searchParams.set("outputToken", params.outputToken);
  url.searchParams.set("originChainId", String(params.originChainId));
  url.searchParams.set("destinationChainId", String(params.destinationChainId));
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("recipient", params.recipient);

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Across quote ${r.status}`);
  const j = await r.json();

  return {
    outputAmount: BigInt(j.outputAmount),
    totalRelayFee: BigInt(j.totalRelayFee.total),
    quoteTimestamp: Number(j.timestamp),
    fillDeadline: Number(j.fillDeadline),
    exclusiveRelayer: j.exclusiveRelayer,
    exclusivityDeadline: Number(j.exclusivityDeadline),
  };
}

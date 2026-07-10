// Across V3 SpokePool. We call `depositV3Now`, which internally sets
// `quoteTimestamp = block.timestamp` and `fillDeadline = block.timestamp +
// fillDeadlineOffset`. This matters: it means the bridge instruction can
// execute at any point inside our pre-signed window — we don't have to
// pre-commit a quote/fill timestamp that would go stale.
export const spokePoolAbi = [
  {
    type: "function",
    name: "depositV3Now",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "address" },
      { name: "recipient", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "address" },
      { name: "fillDeadlineOffset", type: "uint32" },
      { name: "exclusivityDeadline", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

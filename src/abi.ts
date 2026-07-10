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

// `depositNow` — the bytes32-typed sibling of `depositV3Now`. Same
// auto-quoteTimestamp semantics (safe to pre-sign without knowing execution
// time), but recipient/inputToken/outputToken/depositor/exclusiveRelayer are
// bytes32 instead of address, so a 32-byte Solana pubkey actually fits.
// Verified live: a Base -> Solana deposit through this exact ABI landed
// correctly (see solana.ts for the address encoding).
export const depositNowAbi = [
  {
    type: "function",
    name: "depositNow",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "bytes32" },
      { name: "recipient", type: "bytes32" },
      { name: "inputToken", type: "bytes32" },
      { name: "outputToken", type: "bytes32" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "bytes32" },
      { name: "fillDeadlineOffset", type: "uint32" },
      { name: "exclusivityDeadline", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// The bytes32-typed `FundsDeposited` event (replaces the deprecated
// address-typed `V3FundsDeposited`). Emitted by `depositNow` on the origin
// chain — this is how we recover `depositId` to poll Across's
// `/deposit/status` for the Solana-destination settlement tracker.
export const fundsDepositedEventAbi = [
  {
    type: "event",
    name: "FundsDeposited",
    inputs: [
      { name: "inputToken", type: "bytes32", indexed: false },
      { name: "outputToken", type: "bytes32", indexed: false },
      { name: "inputAmount", type: "uint256", indexed: false },
      { name: "outputAmount", type: "uint256", indexed: false },
      { name: "destinationChainId", type: "uint256", indexed: true },
      { name: "depositId", type: "uint256", indexed: true },
      { name: "quoteTimestamp", type: "uint32", indexed: false },
      { name: "fillDeadline", type: "uint32", indexed: false },
      { name: "exclusivityDeadline", type: "uint32", indexed: false },
      { name: "depositor", type: "bytes32", indexed: true },
      { name: "recipient", type: "bytes32", indexed: false },
      { name: "exclusiveRelayer", type: "bytes32", indexed: false },
      { name: "message", type: "bytes", indexed: false },
    ],
  },
] as const;

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  createPublicClient,
  http as viemHttp,
  erc20Abi,
  fallback,
  isAddress,
  parseUnits,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, arbitrum, polygon } from "viem/chains";

// =============================================================================
// invoice-relay — a stateless serverless function replacing Biconomy MEE +
// Across for the "collect USDC, deliver anywhere (including Solana and Robinhood
// Chain/USDG)" leg of the invoicing app.
//
// This is the Vercel port of what used to be a Google Cloud Function
// (`invoice-relay-fn`). The logic is byte-for-byte the same — only the HTTP
// entrypoint at the bottom changed (functions-framework `http()` -> a Vercel
// `export default (req, res)` handler). Everything now lives in one repo/deploy
// alongside the frontend, so there's no separate backend URL or CORS story:
// the app calls this at the same origin as `/api/relay`.
//
// The idea: each invoice gets a plain EOA address, deterministically derived
// from HMAC(masterSecret, invoiceId) — same address on every EVM chain for
// free, since it's a real keypair, not a smart-contract account needing
// counterfactual deployment. The frontend polls that address client-side.
// When a balance shows up, it calls this function, which:
//   1. Re-derives the same keypair (pure function of invoiceId + secret —
//      no lookup, no database).
//   2. Reads the LIVE on-chain USDC balance itself (never trusts a
//      client-supplied amount).
//   3. Delivers the entire balance to `destination`, via one of two paths:
//        - same chain as the payer used  -> direct EIP-3009 relay, no
//          bridging at all.
//        - anywhere else (a different EVM chain, Solana, or Robinhood
//          Chain/USDG) -> a Relay (relay.link) deposit-address quote,
//          relayed to the deposit address it returns on the ORIGIN chain;
//          Relay's solver network delivers the rest. All three
//          destination kinds go through this exact same code path below
//          — the only difference is which destinationChainId/Currency
//          gets passed in. Solana/Robinhood can only ever be a
//          destination here, never an origin, since this whole approach
//          is EOA/EIP-3009-based and neither is EVM-with-PayAI-coverage.
//   4. Either way, relaying goes through PayAI's free x402 facilitator,
//      which submits the on-chain tx and pays gas itself. The invoice
//      address never holds native gas.
//
// Why no database: sweeping the ENTIRE live balance (not a fixed amount)
// makes this safely stateless. Resumability is handled by the frontend
// writing the relay result back into the invoice's URL hash, same pattern
// the app already uses. Idempotency: a second concurrent call re-reads the
// balance; if it's already zero, it's a no-op. If two calls race before
// either settles, both might submit, but ERC20 balances can't go negative,
// so the second one just reverts — harmless, and PayAI eats the gas either
// way, not us.
// =============================================================================

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// -----------------------------------------------------------------------
// Chain config — only these 3. Confirmed live against PayAI's own
// /supported endpoint. Ethereum mainnet and Optimism are genuinely NOT
// covered by their facilitator — don't add them here without either a
// different gasless-relay path for those chains, or accepting the payer
// covers their own gas.
// -----------------------------------------------------------------------
const SUPPORTED_CHAINS = {
  8453: {
    chain: base,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrls: [
      "https://mainnet.base.org",
      "https://base.publicnode.com",
      "https://base-rpc.publicnode.com",
    ],
    caip2: "eip155:8453",
  },
  42161: {
    chain: arbitrum,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.publicnode.com"],
    caip2: "eip155:42161",
  },
  137: {
    chain: polygon,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // native USDC, NOT bridged USDC.e
    rpcUrls: [
      // polygon-rpc.com dropped — confirmed dead in testing.
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon.llamarpc.com",
      "https://rpc.ankr.com/polygon",
      "https://1rpc.io/matic",
    ],
    caip2: "eip155:137",
  },
};

// USDC on Solana (mainnet) — confirmed against multiple live quotes (both
// 1Click and Relay) and real settled transfers earlier in this project.
// Relay identifies Solana with this pseudo chain ID (not a real Solana
// concept — analogous to how 1Click used 34268394551451 for the same
// purpose) — confirmed live against a real Relay quote.
const SOLANA_CHAIN_ID = 792703809;
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Robinhood Chain — destination-only, same reasoning as Solana: no
// same-chain relay path (PayAI doesn't support this chain, confirmed
// against their live /supported endpoint — it launched July 1, 2026, only
// ~2 weeks ago). USDG does implement EIP-3009 (confirmed from Paxos's own
// usdg-contract repo), so the token itself isn't the blocker — the
// facilitator coverage is. destination-only means every delivery here goes
// through Relay, never a direct same-chain transfer.
const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // confirmed via Blockscout + a real Relay quote

function requireChainConfig(chainId) {
  const cfg = SUPPORTED_CHAINS[Number(chainId)];
  if (!cfg) {
    throw new HttpError(
      400,
      `Unsupported chainId ${chainId}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`,
    );
  }
  return cfg;
}

function publicClientFor(chainId) {
  const cfg = requireChainConfig(chainId);
  return createPublicClient({
    chain: cfg.chain,
    transport: fallback(
      cfg.rpcUrls.map((url) => viemHttp(url, { timeout: 10_000, retryCount: 1 })),
      { rank: false, retryCount: 1 },
    ),
  });
}

// -----------------------------------------------------------------------
// Deterministic keypair derivation
// -----------------------------------------------------------------------

// secp256k1 curve order — a valid private key must be a nonzero scalar
// strictly less than this. HMAC-SHA256 output is uniformly random over
// 2^256, so landing outside [1, n-1] is astronomically unlikely, but this
// handles it correctly rather than assuming.
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function deriveInvoiceAccount(masterSecret, invoiceId) {
  if (!masterSecret) throw new Error("INVOICE_MASTER_SECRET is not set");
  if (!invoiceId || typeof invoiceId !== "string") {
    throw new Error("invoiceId is required");
  }

  let material = invoiceId;
  for (let attempt = 0; attempt < 8; attempt++) {
    const digest = createHmac("sha256", masterSecret)
      .update(`invoice-relay-v1:${material}`)
      .digest();
    const scalar = BigInt(`0x${digest.toString("hex")}`);
    if (scalar > 0n && scalar < SECP256K1_ORDER) {
      return privateKeyToAccount(`0x${digest.toString("hex")}`);
    }
    material = `${invoiceId}:${attempt}`; // vanishingly unlikely branch
  }
  throw new Error("Failed to derive a valid private key after 8 attempts");
}

// -----------------------------------------------------------------------
// Relay (relay.link) API — deposit-address quote + status
// -----------------------------------------------------------------------
const RELAY_BASE = "https://api.relay.link";

function relayAuthHeaders() {
  // Optional — unauthenticated works fine for moderate volume (confirmed
  // against their docs), an API key just raises the rate limit ceiling.
  return process.env.RELAY_API_KEY ? { "x-api-key": process.env.RELAY_API_KEY } : {};
}

// Relay addresses tokens with plain chainId + raw contract address — no
// NEAR-intents-style wrapped asset-ID scheme to resolve, unlike 1Click.
// This is why there's no token-list-lookup/caching module here anymore:
// everything needed is already in SUPPORTED_CHAINS or the Solana/Robinhood
// constants above.
function resolveDestinationChainAndCurrency(destination) {
  if (destination.type === "solana") {
    return { chainId: SOLANA_CHAIN_ID, currency: SOLANA_USDC_MINT };
  }
  if (destination.type === "robinhood") {
    return { chainId: ROBINHOOD_CHAIN_ID, currency: ROBINHOOD_USDG };
  }
  const destCfg = requireChainConfig(destination.chainId);
  return { chainId: destination.chainId, currency: destCfg.usdc };
}

// The response's steps[0].depositAddress is on the ORIGIN chain — that's
// what gets relayed to below; Relay's solver network watches it and
// delivers to `recipient` on the destination chain automatically.
// useDepositAddress:false (the default) gives a plain quote with no real
// deposit address reserved — used for previewQuote.
async function getRelayQuote({
  userAddress,
  originChainId,
  originCurrency,
  destinationChainId,
  destinationCurrency,
  amount,
  recipient,
  refundTo,
  useDepositAddress = false,
}) {
  const body = {
    user: userAddress,
    originChainId,
    originCurrency,
    destinationChainId,
    destinationCurrency,
    tradeType: "EXACT_INPUT",
    recipient,
    amount: amount.toString(),
    refundTo,
  };
  if (useDepositAddress) body.useDepositAddress = true;

  const r = await fetch(`${RELAY_BASE}/quote/v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...relayAuthHeaders() },
    body: JSON.stringify(body),
  });

  if (!r.ok) throw new Error(`Relay /quote/v2 ${r.status}: ${await r.text()}`);
  return r.json();
}

// Tracked by deposit address, not requestId — this is Relay's own
// documented best practice ("Always track transactions by deposit
// address, not by requestId"), and it's what makes settlement tracking
// resilient to a fresh browser reload with zero cached state: the
// outbound Transfer event on-chain reveals the deposit address, which is
// enough on its own to recover full status here — no need to have
// captured requestId from the original quote response.
//
// "open" deposit addresses (the default, what we use) can in principle
// receive more than one historical request — /requests/v2 returns an
// array; sorting by updatedAt desc and taking [0] gets the most recent,
// which is the right one for our case (single-use in practice, since each
// invoice's balance only ever gets swept once).
async function getRelayRequestStatus(depositAddress) {
  const url = new URL(`${RELAY_BASE}/requests/v2`);
  url.searchParams.set("depositAddress", depositAddress);
  url.searchParams.set("sortBy", "updatedAt");
  url.searchParams.set("sortDirection", "desc");
  url.searchParams.set("limit", "1");

  const r = await fetch(url, { headers: relayAuthHeaders() });
  if (!r.ok) throw new Error(`Relay /requests/v2 ${r.status}: ${await r.text()}`);
  return r.json();
}

// -----------------------------------------------------------------------
// PayAI x402 facilitator — EIP-3009 authorization + verify/settle
// -----------------------------------------------------------------------
const FACILITATOR_BASE = "https://facilitator.payai.network";

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

// EIP-712 domain name/version read live from the token contract's own
// name()/version() views rather than hardcoded — "USD Coin"/"2" is what
// every Circle deployment uses in practice, but reading it live means a
// wrong guess can't silently produce invalid signatures.
async function getEip712Domain(publicClient, tokenAddress) {
  const [name, version] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "name",
    }),
    publicClient
      .readContract({
        address: tokenAddress,
        abi: [
          {
            type: "function",
            name: "version",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "string" }],
          },
        ],
        functionName: "version",
      })
      .catch(() => "2"), // some tokens omit version(); "2" is the common default
  ]);
  return { name, version };
}

// Signs an EIP-3009 transferWithAuthorization moving `amount` from the
// invoice's derived EOA to `to`, then relays it through PayAI's
// facilitator, which verifies the signature and submits the on-chain
// transaction itself, paying gas. The invoice address never needs native
// gas.
async function relayViaFacilitator({
  publicClient,
  account,
  chainId,
  caip2,
  tokenAddress,
  to,
  amount,
}) {
  const domain = await getEip712Domain(publicClient, tokenAddress);
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60;
  const validBefore = now + 600; // 10 minutes
  const nonce = `0x${randomBytes(32).toString("hex")}`;

  const authorization = {
    from: account.address,
    to,
    value: amount.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
  };

  const signature = await account.signTypedData({
    domain: {
      name: domain.name,
      version: domain.version,
      chainId,
      verifyingContract: tokenAddress,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const paymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: caip2,
    accepted: {
      scheme: "exact",
      network: caip2,
      amount: authorization.value,
      asset: tokenAddress,
      payTo: to,
      maxTimeoutSeconds: 600,
    },
    payload: { signature, authorization },
    extensions: {},
  };
  const paymentRequirements = {
    scheme: "exact",
    network: caip2,
    amount: authorization.value,
    asset: tokenAddress,
    payTo: to,
    maxTimeoutSeconds: 600,
    extra: { name: domain.name, version: domain.version },
  };

  const verifyRes = await fetch(`${FACILITATOR_BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const verifyJson = await verifyRes.json();
  if (!verifyRes.ok || verifyJson.isValid === false) {
    throw new Error(
      `Facilitator /verify rejected: ${verifyJson.invalidReason ?? verifyRes.status}`,
    );
  }

  const settleRes = await fetch(`${FACILITATOR_BASE}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const settleJson = await settleRes.json();
  if (!settleRes.ok || settleJson.success === false) {
    throw new Error(
      `Facilitator /settle failed: ${settleJson.errorReason ?? settleRes.status}`,
    );
  }

  return { txHash: settleJson.transaction, payer: settleJson.payer };
}

// -----------------------------------------------------------------------
// Destination validation
// -----------------------------------------------------------------------

// Length/charset sanity check only — doesn't guarantee validity the way a
// full base58 decode + exact-32-bytes check would, but catches obvious
// typos early rather than failing deep inside a Relay call with a less
// clear error.
function isLikelyBase58SolanaAddress(s) {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function validateDestination(destination) {
  if (!destination || typeof destination !== "object") {
    throw new HttpError(400, "destination is required");
  }
  if (destination.type === "evm") {
    requireChainConfig(destination.chainId); // throws a clear 400 if unsupported
    if (!isAddress(destination.address)) {
      throw new HttpError(
        400,
        `destination.address "${destination.address}" is not a valid EVM address`,
      );
    }
    return;
  }
  if (destination.type === "solana") {
    if (!isLikelyBase58SolanaAddress(destination.address)) {
      throw new HttpError(
        400,
        `destination.address "${destination.address}" doesn't look like a valid Solana address`,
      );
    }
    return;
  }
  if (destination.type === "robinhood") {
    // Robinhood Chain is EVM-compatible — plain 0x address, same check as
    // the "evm" case, just no requireChainConfig lookup since it isn't one
    // of the 3 origin chains.
    if (!isAddress(destination.address)) {
      throw new HttpError(
        400,
        `destination.address "${destination.address}" is not a valid EVM address`,
      );
    }
    return;
  }
  throw new HttpError(
    400,
    `destination.type must be "evm", "solana", or "robinhood", got "${destination?.type}"`,
  );
}

// -----------------------------------------------------------------------
// Action handlers
// -----------------------------------------------------------------------

const MASTER_SECRET = process.env.INVOICE_MASTER_SECRET;

// action: "address" — returns the invoice's deposit address. Same address
// on all 3 supported EVM chains (plain EOA, no per-chain deployment).
// Input: { invoiceId }
async function handleAddress(body) {
  const { invoiceId } = body;
  if (!invoiceId) throw new HttpError(400, "invoiceId is required");
  const account = deriveInvoiceAccount(MASTER_SECRET, invoiceId);
  return { address: account.address };
}

// The frontend's own invoice number is display-only, derived deterministically
// from the address — kept identical here so a link generated by this API
// looks indistinguishable from one generated by the actual form.
function makeInvoiceNumber(address) {
  const hash = keccak256(toBytes(address));
  const n = BigInt(hash) % 1_000_000n;
  return `INV-${n.toString().padStart(6, "0")}`;
}

// Matches the frontend's toBase64Url in share.ts exactly — both are
// standard base64url encodings of the same UTF-8 bytes, so this and the
// browser's btoa-based version produce byte-identical output.
function toBase64Url(jsonString) {
  return Buffer.from(jsonString, "utf8").toString("base64url");
}

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "https://www.invoices.wtf";
const SHARE_HASH_VERSION = 6; // must match share.ts's VERSION — bump both together

// action: "createInvoiceUrl" — the programmatic equivalent of filling out
// the invoice form. Generates a random invoiceId exactly like the frontend
// does, derives its deposit address, and returns a full URL encoding the
// same wire format share.ts produces — so a link from this API and one
// from the actual UI are byte-for-byte interchangeable; either can be
// opened by the same frontend and decoded identically.
//
// Input: { companyName, description?, amount, destination }
//   amount is a plain decimal string/number in USDC (e.g. "25" or 25.5),
//   NOT atomic units — converted here the same way parseUnits(amount, 6)
//   does on the frontend.
async function handleCreateInvoiceUrl(body) {
  const { companyName, description, amount, destination } = body;
  if (!companyName) throw new HttpError(400, "companyName is required");
  if (amount === undefined || amount === null || amount === "") {
    throw new HttpError(400, "amount is required");
  }
  validateDestination(destination);

  let amountAtomic;
  try {
    amountAtomic = parseUnits(String(amount), 6);
  } catch {
    throw new HttpError(400, `amount "${amount}" is not a valid decimal USDC value`);
  }

  const invoiceId = randomUUID();
  const account = deriveInvoiceAccount(MASTER_SECRET, invoiceId);
  const address = account.address;
  const invoiceNumber = makeInvoiceNumber(address);

  const issuedAt = Date.now();
  const expiresAt = issuedAt + 24 * 60 * 60 * 1000;

  const wire = {
    v: SHARE_HASH_VERSION,
    id: invoiceId,
    addr: address,
    n: invoiceNumber,
    t: issuedAt,
    exp: expiresAt,
    co: companyName,
    d: description || "",
    a: amountAtomic.toString(),
    dest: destination,
  };

  const url = `${PUBLIC_APP_URL}/#i=${toBase64Url(JSON.stringify(wire))}`;

  // Deliberately not returning `address` here — a caller seeing the raw
  // deposit address might reasonably assume they can watch/track it
  // independently (their own script, a block explorer) and expect
  // detection + relaying to happen regardless. It doesn't: that only
  // happens because the invoice page itself is open and polling in the
  // browser (useInvoiceSettlement) — there's no server-side watcher. The
  // `url` is the one thing that actually works standalone.
  return { invoiceId, invoiceNumber, url };
}

// action: "relay" — re-derives the same keypair, reads the LIVE balance on
// the given origin chain, and if there's anything there, delivers the
// entire balance to `destination`:
//
//   - destination.type === "evm" && destination.chainId === chainId
//       -> same-chain direct relay. No bridge involved at all.
//   - anything else (a different EVM chainId, "solana", or "robinhood")
//     -> cross-chain via Relay. All three cases run through the exact
//     same code below — the only difference is which
//     destinationChainId/currency gets resolved.
//
// Input:
//   { invoiceId, chainId,
//     destination: { type: "evm", chainId, address } | { type: "solana", address } | { type: "robinhood", address } }
async function handleRelay(body) {
  const { invoiceId, chainId, destination } = body;
  if (!invoiceId) throw new HttpError(400, "invoiceId is required");
  validateDestination(destination);

  const cfg = requireChainConfig(chainId);
  const account = deriveInvoiceAccount(MASTER_SECRET, invoiceId);
  const publicClient = publicClientFor(chainId);

  const balance = await publicClient.readContract({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  if (balance === 0n) {
    return { status: "no-balance", address: account.address };
  }

  const isSameChain =
    destination.type === "evm" && Number(destination.chainId) === Number(chainId);

  if (isSameChain) {
    const { txHash } = await relayViaFacilitator({
      publicClient,
      account,
      chainId: Number(chainId),
      caip2: cfg.caip2,
      tokenAddress: cfg.usdc,
      to: destination.address,
      amount: balance,
    });

    return {
      status: "relayed",
      mode: "same-chain",
      chainId: Number(chainId),
      address: account.address,
      amount: balance.toString(),
      relayTxHash: txHash,
    };
  }

  // Cross-chain — a different EVM chain, Solana, or Robinhood Chain. Same
  // Relay call either way; only destinationChainId/currency differs.
  const { chainId: destChainId, currency: destCurrency } =
    resolveDestinationChainAndCurrency(destination);

  const quote = await getRelayQuote({
    userAddress: account.address,
    originChainId: Number(chainId),
    originCurrency: cfg.usdc,
    destinationChainId: destChainId,
    destinationCurrency: destCurrency,
    amount: balance,
    recipient: destination.address,
    refundTo: account.address, // if the swap fails, funds come back to this same address
    useDepositAddress: true,
  });

  const depositAddress = quote?.steps?.[0]?.depositAddress;
  if (!depositAddress) {
    throw new Error(`Relay quote returned no depositAddress: ${JSON.stringify(quote)}`);
  }

  const { txHash } = await relayViaFacilitator({
    publicClient,
    account,
    chainId: Number(chainId),
    caip2: cfg.caip2,
    tokenAddress: cfg.usdc,
    to: depositAddress,
    amount: balance,
  });

  return {
    status: "relayed",
    mode: "cross-chain",
    chainId: Number(chainId),
    address: account.address,
    amount: balance.toString(),
    relayTxHash: txHash,
    bridgeDepositAddress: depositAddress,
    bridgeAmountOutEstimate: quote?.details?.currencyOut?.amountFormatted,
  };
}

// action: "status" — proxies a Relay status check. This exists so the
// frontend never calls api.relay.link directly: a browser fetch() is
// subject to CORS, and a server-to-server call from here has no such
// restriction. Also centralizes the "track by deposit address" pattern
// Relay recommends, rather than depending on requestId (which only ever
// exists in the original quote response, not on-chain — see
// useInvoiceSettlement.ts for why that distinction matters for reload
// resilience).
// Input: { depositAddress }
async function handleStatus(body) {
  const { depositAddress } = body;
  if (!depositAddress) throw new HttpError(400, "depositAddress is required");

  const json = await getRelayRequestStatus(depositAddress);
  const request = json?.requests?.[0];
  if (!request) {
    return { status: "unknown" };
  }

  // Confirmed live: the destination-chain delivery tx is under
  // data.outTxs[0].hash once status is "success" — distinct from the
  // origin-chain deposit tx, same distinction 1Click had between
  // originChainTxHashes/destinationChainTxHashes.
  return {
    status: request.status, // "waiting" | "pending" | "success" | "refund" | ...
    destinationTxHash: request.data?.outTxs?.[0]?.hash,
    amountOutFormatted: request.data?.metadata?.currencyOut?.amountFormatted,
  };
}

// action: "previewQuote" — a quote used by the invoice form to show an
// estimated fee/fill amount before the invoice is even issued.
// useDepositAddress is omitted (defaults to false) — no real deposit
// address is reserved for a preview. The payer's actual origin chain
// isn't known yet at invoice-creation time — only the destination is —
// so the frontend picks a representative origin (any chain other than
// the destination) to illustrate the cross-chain fee. Same-chain
// payments are always free (sponsored, no bridging at all); the frontend
// doesn't call this for that case.
// Input: { originChainId, destination, amount }
async function handlePreviewQuote(body) {
  const { originChainId, destination, amount } = body;
  if (!originChainId) throw new HttpError(400, "originChainId is required");
  if (!amount) throw new HttpError(400, "amount is required");
  validateDestination(destination);

  const cfg = requireChainConfig(originChainId);
  const { chainId: destChainId, currency: destCurrency } =
    resolveDestinationChainAndCurrency(destination);

  const quote = await getRelayQuote({
    userAddress: "0x0000000000000000000000000000000000000000", // dry preview — never actually used
    originChainId: Number(originChainId),
    originCurrency: cfg.usdc,
    destinationChainId: destChainId,
    destinationCurrency: destCurrency,
    amount: BigInt(amount),
    recipient: destination.address,
    refundTo: "0x0000000000000000000000000000000000000000",
  });

  return {
    amountIn: quote?.details?.currencyIn?.amount,
    amountOut: quote?.details?.currencyOut?.amount,
    amountOutFormatted: quote?.details?.currencyOut?.amountFormatted,
    amountOutUsd: quote?.details?.currencyOut?.amountUsd,
    timeEstimate: quote?.details?.timeEstimate,
  };
}

const ACTIONS = {
  address: handleAddress,
  relay: handleRelay,
  status: handleStatus,
  previewQuote: handlePreviewQuote,
  createInvoiceUrl: handleCreateInvoiceUrl,
};

// -----------------------------------------------------------------------
// HTTP entrypoint — Vercel serverless function.
//
// Vercel's Node runtime hands us an Express-like (req, res): it parses a
// JSON request body into req.body automatically, and res has .status()/
// .json()/.setHeader() helpers. CORS headers are kept permissive so the
// `createInvoiceUrl` action stays usable as a public programmatic API
// (the app itself calls this same-origin and doesn't need them).
// -----------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  // Vercel parses application/json bodies for us, but be defensive in case
  // a raw string comes through (e.g. a missing/odd Content-Type).
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  }
  body = body || {};

  const action = body.action;
  const fn = ACTIONS[action];
  if (!fn) {
    res.status(400).json({
      error: `Unknown or missing action. Expected one of: ${Object.keys(ACTIONS).join(", ")}`,
    });
    return;
  }

  try {
    const result = await fn(body);
    res.status(200).json(result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    console.error(`[invoiceRelay:${action}]`, err);
    res.status(status).json({ error: err.message ?? String(err) });
  }
}

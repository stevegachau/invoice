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
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, arbitrum, polygon } from "viem/chains";

// Invoice relay API. Collects USDC on Base/Arbitrum/Polygon/Arc and settles
// it as USDC on Arc.

const FACILITATOR_PAYAI = "https://facilitator.payai.network";
const FACILITATOR_ARCUS = "https://facilitator.arcusnetwork.co";

const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ARC_CHAIN_ID = 5042;
const ARC_USDC = "0x3600000000000000000000000000000000000000"; // 6 decimals

// Origin chains and their x402 facilitator.
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
    facilitator: FACILITATOR_PAYAI,
  },
  42161: {
    chain: arbitrum,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.publicnode.com"],
    caip2: "eip155:42161",
    facilitator: FACILITATOR_PAYAI,
  },
  137: {
    chain: polygon,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    rpcUrls: [
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon.llamarpc.com",
      "https://rpc.ankr.com/polygon",
      "https://1rpc.io/matic",
    ],
    caip2: "eip155:137",
    facilitator: FACILITATOR_PAYAI,
  },
  5042: {
    chain: arc,
    usdc: ARC_USDC,
    rpcUrls: ["https://rpc.mainnet.arc.io"],
    caip2: "eip155:5042",
    facilitator: FACILITATOR_ARCUS,
  },
};

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
    material = `${invoiceId}:${attempt}`;
  }
  throw new Error("Failed to derive a valid private key after 8 attempts");
}

// Relay (relay.link) — quotes and status.
const RELAY_BASE = "https://api.relay.link";

function relayAuthHeaders() {
  return process.env.RELAY_API_KEY ? { "x-api-key": process.env.RELAY_API_KEY } : {};
}

function resolveDestinationChainAndCurrency() {
  return { chainId: ARC_CHAIN_ID, currency: ARC_USDC };
}

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

// x402 facilitator — EIP-3009 authorization + verify/settle (base URL per call).

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
      .catch(() => "2"),
  ]);
  return { name, version };
}

async function relayViaFacilitator({
  facilitatorBase,
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
  const validBefore = now + 600;
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

  const verifyRes = await fetch(`${facilitatorBase}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
  });
  const verifyJson = await verifyRes.json();
  if (!verifyRes.ok || verifyJson.isValid === false) {
    throw new Error(
      `Facilitator /verify rejected: ${verifyJson.invalidReason ?? verifyRes.status}`,
    );
  }

  const settleRes = await fetch(`${facilitatorBase}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
  });
  const settleJson = await settleRes.json();
  if (!settleRes.ok || settleJson.success === false) {
    throw new Error(
      `Facilitator /settle failed: ${settleJson.errorReason ?? settleRes.status}`,
    );
  }

  return { txHash: settleJson.transaction, payer: settleJson.payer };
}

function validateDestination(destination) {
  if (!destination || typeof destination !== "object") {
    throw new HttpError(400, "destination is required");
  }
  if (destination.type !== "arc") {
    throw new HttpError(
      400,
      `destination.type must be "arc", got "${destination?.type}"`,
    );
  }
  if (!isAddress(destination.address)) {
    throw new HttpError(
      400,
      `destination.address "${destination.address}" is not a valid Arc (EVM) address`,
    );
  }
}

// Action handlers

const MASTER_SECRET = process.env.INVOICE_MASTER_SECRET;

// { invoiceId } -> { address }
async function handleAddress(body) {
  const { invoiceId } = body;
  if (!invoiceId) throw new HttpError(400, "invoiceId is required");
  const account = deriveInvoiceAccount(MASTER_SECRET, invoiceId);
  return { address: account.address };
}

function makeInvoiceNumber(address) {
  const hash = keccak256(toBytes(address));
  const n = BigInt(hash) % 1_000_000n;
  return `INV-${n.toString().padStart(6, "0")}`;
}

function toBase64Url(jsonString) {
  return Buffer.from(jsonString, "utf8").toString("base64url");
}

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "https://www.invoices.wtf";
const SHARE_HASH_VERSION = 7; // must match share.ts's VERSION

// { companyName, description?, amount, destination } -> { invoiceId, invoiceNumber, url }
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
  return { invoiceId, invoiceNumber, url };
}

// { invoiceId, chainId, destination } -> relay result.
// Arc origin settles same-chain; other origins bridge to Arc via Relay.
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

  // Same-chain (Arc): hand the balance straight to the merchant.
  if (Number(chainId) === ARC_CHAIN_ID) {
    const { txHash } = await relayViaFacilitator({
      facilitatorBase: cfg.facilitator,
      publicClient,
      account,
      chainId: ARC_CHAIN_ID,
      caip2: cfg.caip2,
      tokenAddress: cfg.usdc,
      to: destination.address,
      amount: balance,
    });

    return {
      status: "relayed",
      mode: "same-chain",
      chainId: ARC_CHAIN_ID,
      address: account.address,
      amount: balance.toString(),
      relayTxHash: txHash,
    };
  }

  // Cross-chain: bridge to Arc via Relay.
  const { chainId: destChainId, currency: destCurrency } =
    resolveDestinationChainAndCurrency();

  const quote = await getRelayQuote({
    userAddress: account.address,
    originChainId: Number(chainId),
    originCurrency: cfg.usdc,
    destinationChainId: destChainId,
    destinationCurrency: destCurrency,
    amount: balance,
    recipient: destination.address,
    refundTo: account.address,
    useDepositAddress: true,
  });

  const depositAddress = quote?.steps?.[0]?.depositAddress;
  if (!depositAddress) {
    throw new Error(`Relay quote returned no depositAddress: ${JSON.stringify(quote)}`);
  }

  const { txHash } = await relayViaFacilitator({
    facilitatorBase: cfg.facilitator,
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

// { depositAddress } -> Relay settlement status.
async function handleStatus(body) {
  const { depositAddress } = body;
  if (!depositAddress) throw new HttpError(400, "depositAddress is required");

  const json = await getRelayRequestStatus(depositAddress);
  const request = json?.requests?.[0];
  if (!request) {
    return { status: "unknown" };
  }

  return {
    status: request.status,
    destinationTxHash: request.data?.outTxs?.[0]?.hash,
    amountOutFormatted: request.data?.metadata?.currencyOut?.amountFormatted,
  };
}

// { originChainId, destination, amount } -> estimated amount received on Arc.
async function handlePreviewQuote(body) {
  const { originChainId, destination, amount } = body;
  if (!originChainId) throw new HttpError(400, "originChainId is required");
  if (!amount) throw new HttpError(400, "amount is required");
  validateDestination(destination);

  const cfg = requireChainConfig(originChainId);

  // Arc origin is same-chain: full amount, no fee.
  if (Number(originChainId) === ARC_CHAIN_ID) {
    const formatted = (Number(amount) / 1e6).toString();
    return {
      amountIn: String(amount),
      amountOut: String(amount),
      amountOutFormatted: formatted,
      timeEstimate: 1,
    };
  }

  const { chainId: destChainId, currency: destCurrency } =
    resolveDestinationChainAndCurrency();

  const quote = await getRelayQuote({
    userAddress: "0x0000000000000000000000000000000000000000",
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

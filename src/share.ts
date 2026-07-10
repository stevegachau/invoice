import type { Address } from "viem";
import type { AnyIssuedInvoice } from "./anyInvoice";
import type { SupportedChainId } from "./chains";

const HASH_PREFIX = "i=";
const VERSION = 4; // bumped: added `k` (kind) to support Solana-destination invoices

type WireCommon = {
  v: number;
  k: "evm" | "solana";
  addr: Address;
  n: string;
  t: number;
  exp: number;
  co: string;
  d: string;
  a: string;
  h?: `0x${string}`;
  e?: string;
};

type WireEvm = WireCommon & {
  k: "evm";
  p: Address;
  c: SupportedChainId;
};

type WireSolana = WireCommon & {
  k: "solana";
  p: string; // base58 Solana address
};

type Wire = WireEvm | WireSolana;

export function encodeInvoiceHash(i: AnyIssuedInvoice): string {
  const common = {
    v: VERSION,
    addr: i.invoiceAddress,
    n: i.invoiceNumber,
    t: i.issuedAt,
    exp: i.expiresAt,
    co: i.meta.companyName,
    d: i.meta.description,
    a: i.invoice.amount.toString(),
    h: i.supertx.hash,
    e: i.supertx.error,
  };

  const wire: Wire =
    i.kind === "evm"
      ? {
          ...common,
          k: "evm",
          p: i.invoice.payeeAddress,
          c: i.invoice.destinationChainId,
        }
      : {
          ...common,
          k: "solana",
          p: i.invoice.payeeSolanaAddress,
        };

  return HASH_PREFIX + toBase64Url(JSON.stringify(wire));
}

export function decodeInvoiceHash(hash: string): AnyIssuedInvoice | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  try {
    const json = fromBase64Url(raw.slice(HASH_PREFIX.length));
    const w = JSON.parse(json) as Wire;
    if (w.v !== VERSION) return null;

    const meta = { companyName: w.co, description: w.d };
    const shared = {
      invoiceAddress: w.addr,
      invoiceNumber: w.n,
      issuedAt: w.t,
      expiresAt: w.exp,
      meta,
      supertx: { hash: w.h, error: w.e },
    };

    if (w.k === "evm") {
      return {
        kind: "evm",
        ...shared,
        invoice: {
          payeeAddress: w.p,
          destinationChainId: w.c,
          amount: BigInt(w.a),
        },
      };
    }

    return {
      kind: "solana",
      ...shared,
      invoice: {
        payeeSolanaAddress: w.p,
        amount: BigInt(w.a),
      },
    };
  } catch {
    return null;
  }
}

export function buildShareUrl(i: AnyIssuedInvoice): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${encodeInvoiceHash(i)}`;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

import type { Address } from "viem";
import type { AnyIssuedInvoice } from "./anyInvoice";
import type { SupportedChainId } from "./chains";

const HASH_PREFIX = "i=";
const VERSION = 5; // bumped: solana invoices now carry an array of per-chain supertxs, not one

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
};

type WireSupertx = {
  h?: `0x${string}`;
  ms?: string;
  mf?: string; // meeFeeAmount, stringified bigint
  e?: string;
};

type WireEvm = WireCommon & {
  k: "evm";
  p: Address;
  c: SupportedChainId;
} & WireSupertx;

type WireSolana = WireCommon & {
  k: "solana";
  p: string; // base58 Solana address
  sx: (WireSupertx & { c: SupportedChainId })[]; // one per origin chain
};

type Wire = WireEvm | WireSolana;

export function encodeInvoiceHash(i: AnyIssuedInvoice): string {
  const common: WireCommon = {
    v: VERSION,
    k: i.kind,
    addr: i.invoiceAddress,
    n: i.invoiceNumber,
    t: i.issuedAt,
    exp: i.expiresAt,
    co: i.meta.companyName,
    d: i.meta.description,
    a: i.invoice.amount.toString(),
  };

  const wire: Wire =
    i.kind === "evm"
      ? {
          ...common,
          k: "evm",
          p: i.invoice.payeeAddress,
          c: i.invoice.destinationChainId,
          h: i.supertx.hash,
          ms: i.supertx.meeScanLink,
          mf: i.supertx.meeFeeAmount?.toString(),
          e: i.supertx.error,
        }
      : {
          ...common,
          k: "solana",
          p: i.invoice.payeeSolanaAddress,
          sx: i.supertxs.map((s) => ({
            c: s.chainId,
            h: s.hash,
            ms: s.meeScanLink,
            mf: s.meeFeeAmount?.toString(),
            e: s.error,
          })),
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
    const base = {
      invoiceAddress: w.addr,
      invoiceNumber: w.n,
      issuedAt: w.t,
      expiresAt: w.exp,
      meta,
    };

    if (w.k === "evm") {
      return {
        kind: "evm",
        ...base,
        invoice: {
          payeeAddress: w.p,
          destinationChainId: w.c,
          amount: BigInt(w.a),
        },
        supertx: {
          hash: w.h,
          meeScanLink: w.ms,
          meeFeeAmount: w.mf !== undefined ? BigInt(w.mf) : undefined,
          error: w.e,
        },
      };
    }

    return {
      kind: "solana",
      ...base,
      invoice: {
        payeeSolanaAddress: w.p,
        amount: BigInt(w.a),
      },
      supertxs: w.sx.map((s) => ({
        chainId: s.c,
        hash: s.h,
        meeScanLink: s.ms,
        meeFeeAmount: s.mf !== undefined ? BigInt(s.mf) : undefined,
        error: s.e,
      })),
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

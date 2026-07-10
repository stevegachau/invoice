import type { Address } from "viem";
import type { IssuedInvoice } from "./invoice";
import type { SupportedChainId } from "./chains";

const HASH_PREFIX = "i=";
const VERSION = 3;

type Wire = {
  v: number;
  p: Address;
  c: SupportedChainId;
  a: string;
  addr: Address;
  n: string;
  t: number;
  exp: number;
  co: string;
  d: string;
  h?: `0x${string}`;
  e?: string;
};

export function encodeInvoiceHash(i: IssuedInvoice): string {
  const wire: Wire = {
    v: VERSION,
    p: i.invoice.payeeAddress,
    c: i.invoice.destinationChainId,
    a: i.invoice.amount.toString(),
    addr: i.invoiceAddress,
    n: i.invoiceNumber,
    t: i.issuedAt,
    exp: i.expiresAt,
    co: i.meta.companyName,
    d: i.meta.description,
    h: i.supertx.hash,
    e: i.supertx.error,
  };
  return HASH_PREFIX + toBase64Url(JSON.stringify(wire));
}

export function decodeInvoiceHash(hash: string): IssuedInvoice | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  try {
    const json = fromBase64Url(raw.slice(HASH_PREFIX.length));
    const w = JSON.parse(json) as Wire;
    if (w.v !== VERSION) return null;
    return {
      invoice: {
        payeeAddress: w.p,
        destinationChainId: w.c,
        amount: BigInt(w.a),
      },
      invoiceAddress: w.addr,
      invoiceNumber: w.n,
      issuedAt: w.t,
      expiresAt: w.exp,
      meta: { companyName: w.co, description: w.d },
      supertx: { hash: w.h, error: w.e },
    };
  } catch {
    return null;
  }
}

export function buildShareUrl(i: IssuedInvoice): string {
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

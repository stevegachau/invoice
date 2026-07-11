import type { Address } from "viem";
import type { IssuedInvoice } from "./invoice";
import type { Destination, RelayResult } from "./relayApi";

const HASH_PREFIX = "i=";
const VERSION = 6; // bumped: dropped the whole MEE/Across supertx model —
// invoices are now just {invoiceId, destination, amount}, backed by the
// relay Cloud Function instead of pre-signed supertransactions.

type Wire = {
  v: number;
  id: string; // invoiceId
  addr: Address;
  n: string;
  t: number;
  exp: number;
  co: string;
  d: string;
  a: string;
  dest: Destination;
  // Cached relay result, if we have one — lets reopening the link show
  // "complete" immediately without re-scanning from scratch. Optional:
  // absence just means the settlement hook re-derives it live.
  relay?: RelayResult;
};

export function encodeInvoiceHash(
  issued: IssuedInvoice,
  relay?: RelayResult,
): string {
  const wire: Wire = {
    v: VERSION,
    id: issued.invoiceId,
    addr: issued.invoiceAddress,
    n: issued.invoiceNumber,
    t: issued.issuedAt,
    exp: issued.expiresAt,
    co: issued.meta.companyName,
    d: issued.meta.description,
    a: issued.invoice.amount.toString(),
    dest: issued.invoice.destination,
    relay,
  };
  return HASH_PREFIX + toBase64Url(JSON.stringify(wire, bigIntReplacer));
}

export function decodeInvoiceHash(
  hash: string,
): { issued: IssuedInvoice; relay?: RelayResult } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  try {
    const json = fromBase64Url(raw.slice(HASH_PREFIX.length));
    const w = JSON.parse(json) as Wire;
    if (w.v !== VERSION) return null;

    const issued: IssuedInvoice = {
      invoiceId: w.id,
      invoiceAddress: w.addr,
      invoiceNumber: w.n,
      issuedAt: w.t,
      expiresAt: w.exp,
      meta: { companyName: w.co, description: w.d },
      invoice: { destination: w.dest, amount: BigInt(w.a) },
    };
    return { issued, relay: w.relay };
  } catch {
    return null;
  }
}

export function buildShareUrl(issued: IssuedInvoice, relay?: RelayResult): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${encodeInvoiceHash(issued, relay)}`;
}

function bigIntReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
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

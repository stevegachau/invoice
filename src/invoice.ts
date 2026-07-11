import { keccak256, toBytes, type Address } from "viem";
import type { Destination } from "./relayApi";
import { getInvoiceAddress } from "./relayApi";

export type Invoice = {
  destination: Destination;
  amount: bigint; // requested amount, 6 decimals — display/UX only; the
  // actual relay always sweeps whatever's really sitting at the address,
  // not this number. See invoice-relay-fn's README for why.
};

export type InvoiceMeta = {
  companyName: string;
  description: string;
};

export type IssuedInvoice = {
  invoiceId: string; // random UUID — the only thing the backend needs to
  // re-derive the same deposit address later. This is the entire
  // "database": whoever holds this string (via the URL hash) can look up
  // and act on this invoice; the backend itself stores nothing.
  invoice: Invoice;
  meta: InvoiceMeta;
  invoiceAddress: Address;
  invoiceNumber: string;
  issuedAt: number;
  expiresAt: number; // soft, cosmetic only now — there's no pre-signed
  // window to actually expire (no MEE, nothing pre-signed at all). Kept
  // purely as a "please pay soon" UX convention; the backend will happily
  // relay funds that show up after this time too.
};

export async function issueInvoice(
  invoice: Invoice,
  meta: InvoiceMeta,
): Promise<IssuedInvoice> {
  const invoiceId = crypto.randomUUID();
  const invoiceAddress = await getInvoiceAddress(invoiceId);

  const issuedAt = Date.now();
  const expiresAt = issuedAt + 24 * 60 * 60 * 1000;

  return {
    invoiceId,
    invoice,
    meta,
    invoiceAddress,
    invoiceNumber: makeInvoiceNumber(invoiceAddress),
    issuedAt,
    expiresAt,
  };
}

export function makeInvoiceNumber(address: Address): string {
  const hash = keccak256(toBytes(address));
  const n = BigInt(hash) % 1_000_000n;
  return `INV-${n.toString().padStart(6, "0")}`;
}

import { keccak256, toBytes, type Address } from "viem";
import type { Destination } from "./relayApi";
import { getInvoiceAddress } from "./relayApi";

export type Invoice = {
  destination: Destination;
  amount: bigint; // requested amount, 6 decimals (display only)
};

export type InvoiceMeta = {
  companyName: string;
  description: string;
};

export type IssuedInvoice = {
  invoiceId: string;
  invoice: Invoice;
  meta: InvoiceMeta;
  invoiceAddress: Address;
  invoiceNumber: string;
  issuedAt: number;
  expiresAt: number; // soft, cosmetic only
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

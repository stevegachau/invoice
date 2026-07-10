import type { IssuedInvoice } from "./invoice";
import type { IssuedSolanaInvoice } from "./solanaInvoice";

export type AnyIssuedInvoice = IssuedInvoice | IssuedSolanaInvoice;

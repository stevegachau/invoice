import bs58 from "bs58";

export function isValidSolanaPubkey(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

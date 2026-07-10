import bs58 from "bs58";

// The Solana USDC mint (base58) and Across's pseudo chain ID for Solana.
// Verified against a live /suggested-fees response — destinationSpokePoolAddress
// came back as "DLv3NggMiSaef97YCkew5xKUHDh13tVGZ7tydt3ZeAru", matching
// docs.across.to's documented SVM SpokePool exactly.
export const SOLANA_CHAIN_ID = 34268394551451n;
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Base58-decode a Solana pubkey (or the Solana USDC mint) into a 0x-prefixed
 * 32-byte hex value, for use as a `bytes32` param in `depositNow`. Unlike an
 * EVM address (20 bytes, left-padded), a Solana pubkey is already 32 raw
 * bytes — no padding, no truncation.
 */
export function solanaPubkeyToBytes32(base58Address: string): `0x${string}` {
  const raw = bs58.decode(base58Address);
  if (raw.length !== 32) {
    throw new Error(
      `Expected 32-byte Solana pubkey, got ${raw.length} bytes for "${base58Address}"`,
    );
  }
  return bytesToHex(raw);
}

export function isValidSolanaPubkey(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

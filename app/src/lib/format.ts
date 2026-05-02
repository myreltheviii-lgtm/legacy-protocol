// app/src/lib/format.ts
//
// Formatting utilities used across all components. Centralised here so a
// change in display convention requires exactly one edit.
//
// Bug fix: formatSolCompact previously produced an incorrect result when
// fracPart >= 999_950_000 (i.e., when rounding to 4 decimal places of SOL
// causes a carry into the whole-SOL digit). In that case fracFour reached
// 10_000, and ".padStart(4)" produced a 5-character string, giving output
// like "1.10000 SOL" instead of "2.0000 SOL". The fix handles the carry
// explicitly before formatting.

import { ActivityZone } from "@legacy-protocol/sdk";

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Formats a lamport amount as a human-readable SOL string. */
export function formatSol(lamports: bigint): string {
  const sol    = lamports / LAMPORTS_PER_SOL;
  const frac   = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "") || "0";
  return `${sol.toString()}.${fracStr} SOL`;
}

/**
 * Formats a lamport count as a compact SOL string for tight spaces.
 *
 * Uses BigInt division throughout to preserve precision above 2^53 lamports.
 *
 * Round-half-up at 4 decimal places of SOL:
 *   fracFour = (fracPart * 10_000 + 500_000_000) / 1_000_000_000
 *
 * When fracFour reaches 10_000 (fracPart >= 999_950_000), the fractional part
 * rounds up to 1.0 SOL and must be carried into the whole-SOL digit. Without
 * the carry, ".padStart(4)" on "10000" would produce a 5-character string and
 * corrupt the display.
 */
export function formatSolCompact(lamports: bigint): string {
  let wholeSol = lamports / LAMPORTS_PER_SOL;
  const fracPart = lamports % LAMPORTS_PER_SOL;

  // Round-half-up: add half the denominator before BigInt-dividing.
  let fracFour = (fracPart * 10_000n + 500_000_000n) / 1_000_000_000n;

  // Carry: rounding pushed the fractional part to a full SOL.
  if (fracFour >= 10_000n) {
    wholeSol += 1n;
    fracFour  = 0n;
  }

  const fracStr = fracFour.toString().padStart(4, "0");
  return `${wholeSol.toString()}.${fracStr} SOL`;
}

/**
 * Formats a slot count as a human-readable duration string.
 * Uses ~2 slots/second as the approximation constant.
 */
export function formatSlotDuration(slots: bigint): string {
  if (slots <= 0n) return "0 seconds";

  const totalSeconds = Number(slots) / 2;

  if (totalSeconds < 60)        return `${Math.round(totalSeconds)} seconds`;
  if (totalSeconds < 3600)      return `${Math.round(totalSeconds / 60)} minutes`;
  if (totalSeconds < 86400)     return `${Math.round(totalSeconds / 3600)} hours`;
  if (totalSeconds < 86400 * 7) return `${Math.round(totalSeconds / 86400)} days`;
  return `${(totalSeconds / 86400 / 7).toFixed(1)} weeks`;
}

/** Formats a slot count as a days-only string for threshold display. */
export function formatSlotDays(slots: bigint): string {
  const days = Number(slots) / 2 / 86400;
  return `${days.toFixed(1)} days`;
}

/** Formats an absolute slot number compactly. */
export function formatSlot(slot: bigint): string {
  return slot.toLocaleString();
}

/** Returns a short human label for an ActivityZone. */
export function zoneLabel(zone: ActivityZone): string {
  switch (zone) {
    case ActivityZone.Green:  return "Healthy";
    case ActivityZone.Yellow: return "Unusual silence";
    case ActivityZone.Orange: return "Critical silence";
    case ActivityZone.Red:    return "Threshold crossed";
  }
}

/** Returns the CSS colour variable for a zone. */
export function zoneColor(zone: ActivityZone): string {
  switch (zone) {
    case ActivityZone.Green:  return "var(--zone-green)";
    case ActivityZone.Yellow: return "var(--zone-yellow)";
    case ActivityZone.Orange: return "var(--zone-orange)";
    case ActivityZone.Red:    return "var(--zone-red)";
  }
}

/** Returns the Tailwind text colour class for a zone. */
export function zoneTailwindText(zone: ActivityZone): string {
  switch (zone) {
    case ActivityZone.Green:  return "text-emerald-400";
    case ActivityZone.Yellow: return "text-yellow-400";
    case ActivityZone.Orange: return "text-orange-400";
    case ActivityZone.Red:    return "text-red-400";
  }
}

/** Truncates a base58 address for display. */
export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** Formats an integer percentage score. */
export function formatScore(score: bigint): string {
  const capped = score > 100n ? 100n : score;
  return `${capped}%`;
}

/** Converts a bigint score (0–100+) to a 0–1 float for SVG path calculations. */
export function scoreToFraction(score: bigint): number {
  return Math.min(Number(score) / 100, 1);
}

/** Returns an approximate "time remaining" string given a seconds count. */
export function formatSecondsRemaining(seconds: number): string {
  if (seconds <= 0)               return "Now";
  if (seconds < 3600)             return `${Math.round(seconds / 60)}m remaining`;
  if (seconds < 86400)            return `${Math.round(seconds / 3600)}h remaining`;
  return `${Math.round(seconds / 86400)}d remaining`;
}

/** Returns a Solana Explorer URL for an address. */
export function explorerAddressUrl(address: string): string {
  const cluster =
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/address/${address}${cluster}`;
}

/** Returns a Solana Explorer URL for a transaction signature. */
export function explorerTxUrl(sig: string): string {
  const cluster =
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${sig}${cluster}`;
}

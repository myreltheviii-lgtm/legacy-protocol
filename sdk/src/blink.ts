// sdk/src/blink.ts
//
// Solana Actions / Blink URL helpers for Level 3 SDK.
//
// A Blink is a URL that encodes a Solana Action — a standardised API
// endpoint that wallets and dApps can discover and invoke with a single
// click. The Legacy Protocol Blink endpoints live in the Next.js app under
// /api/actions/. These helpers construct the correct URLs so the watcher,
// SDK consumers, and the app itself all generate identical, interoperable
// Blink URLs.
//
// Blink URL format: https://app.legacyprotocol.xyz/api/actions/<action>?<params>
// The wallet reads the URL, calls GET to discover the action schema, then
// calls POST to build the transaction for the connected wallet to sign.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LegacyBlinkUrls {
  /** Blink that calls claim_inheritance for the given vault. */
  claim: string;
  /** Blink that calls trigger_inheritance for the given vault. */
  trigger: string;
  /** Blink that calls check_in for the given vault. */
  checkIn: string;
}

// ── URL builders ──────────────────────────────────────────────────────────────

/**
 * Builds all three Blink URLs for a vault in a single call. Callers that only
 * need one URL should use the individual functions below.
 */
export function buildVaultBlinkUrls(
  appBaseUrl:   string,
  vaultAddress: string,
): LegacyBlinkUrls {
  return {
    claim:   buildClaimBlinkUrl(appBaseUrl, vaultAddress),
    trigger: buildTriggerBlinkUrl(appBaseUrl, vaultAddress),
    checkIn: buildCheckInBlinkUrl(appBaseUrl, vaultAddress),
  };
}

/**
 * Constructs the claim_inheritance Blink URL.
 * Example: https://app.legacyprotocol.xyz/api/actions/claim?vault=<address>
 *
 * The beneficiary shares this URL so their heirs can execute the claim with
 * a single wallet tap, even without knowing anything about the protocol.
 */
export function buildClaimBlinkUrl(appBaseUrl: string, vaultAddress: string): string {
  const url = new URL("/api/actions/claim", appBaseUrl);
  url.searchParams.set("vault", vaultAddress);
  return url.toString();
}

/**
 * Constructs the trigger_inheritance Blink URL.
 * Example: https://app.legacyprotocol.xyz/api/actions/trigger?vault=<address>
 *
 * Anyone can trigger a vault whose threshold has been crossed. Embedding
 * this URL in a beneficiary notification lets them trigger with one tap.
 */
export function buildTriggerBlinkUrl(appBaseUrl: string, vaultAddress: string): string {
  const url = new URL("/api/actions/trigger", appBaseUrl);
  url.searchParams.set("vault", vaultAddress);
  return url.toString();
}

/**
 * Constructs the check_in Blink URL.
 * Example: https://app.legacyprotocol.xyz/api/actions/checkin?vault=<address>
 *
 * Wallet integrators can embed this in the vault's notification card so the
 * owner checks in with a single tap from any Blink-compatible wallet.
 */
export function buildCheckInBlinkUrl(appBaseUrl: string, vaultAddress: string): string {
  const url = new URL("/api/actions/checkin", appBaseUrl);
  url.searchParams.set("vault", vaultAddress);
  return url.toString();
}

/**
 * Parses a Legacy Protocol Blink URL and returns its action type and vault
 * address. Returns null if the URL is not a recognised Legacy Protocol action.
 */
export function parseLegacyBlinkUrl(url: string): {
  action: "claim" | "trigger" | "checkin";
  vaultAddress: string;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  // Expected path: /api/actions/<action>
  if (
    pathParts.length < 3 ||
    pathParts[0] !== "api" ||
    pathParts[1] !== "actions"
  ) {
    return null;
  }

  const action = pathParts[2] as "claim" | "trigger" | "checkin";
  if (!["claim", "trigger", "checkin"].includes(action)) return null;

  const vaultAddress = parsed.searchParams.get("vault");
  if (!vaultAddress) return null;

  return { action, vaultAddress };
}


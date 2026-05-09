// relayer/src/retry.ts
//
// Generic retry engine with exponential backoff and jitter. Every transaction
// the relayer submits goes through this module because Solana RPC calls fail
// for transient reasons (node congestion, leader rotation, network blips) that
// have nothing to do with the validity of the transaction itself.
//
// Exponential backoff prevents the relayer from hammering a degraded RPC node.
// Jitter (random offset on each delay) prevents multiple relayer instances from
// synchronising their retries and creating a thundering-herd effect.
//
// This module is intentionally generic — it retries any async function, not
// just Solana transactions. broadcast.ts and verify_threshold.ts both use it.

import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /**
   * Maximum number of attempts before giving up.
   * The first call counts as attempt 1, so maxAttempts = 1 means no retries.
   */
  maxAttempts: number;

  /**
   * Base delay in milliseconds before the first retry.
   * Each subsequent retry doubles this value (exponential backoff).
   * Default: 1000 (1 second).
   */
  baseDelayMs: number;

  /**
   * Maximum delay cap in milliseconds. Prevents the backoff from growing
   * to absurd values on very long retry sequences.
   * Default: 30_000 (30 seconds).
   */
  maxDelayMs: number;

  /**
   * Maximum random jitter added to each delay in milliseconds.
   * Actual jitter is a uniform random value in [0, maxJitterMs].
   * Default: 500ms.
   */
  maxJitterMs: number;

  /**
   * Optional predicate that receives the error from each failed attempt
   * and returns true if the retry should continue, false if it should abort
   * immediately regardless of remaining attempts.
   *
   * Use this to fast-fail on known-permanent errors (e.g., the on-chain
   * program returned "VaultAlreadyTriggered" — retrying is pointless).
   */
  isRetryable?: (err: unknown) => boolean;

  /**
   * Optional label for log messages so retry sequences from different
   * call sites are distinguishable in the log stream.
   */
  label?: string;
}

export interface RetryResult<T> {
  success:    boolean;
  value?:     T;
  error?:     unknown;
  attempts:   number;
  totalDelayMs: number;
}

// ── Default options ───────────────────────────────────────────────────────────

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs:  30_000,
  maxJitterMs: 500,
};

/**
 * High-stakes retry options for trigger_inheritance transactions.
 * Inheritance transactions warrant more aggressive retry because a single
 * missed trigger means a family may not receive their funds automatically.
 */
export const TRIGGER_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 10,
  baseDelayMs: 2_000,
  maxDelayMs:  60_000,
  maxJitterMs: 1_000,
  label:       "trigger_inheritance",
};

// ── Core retry function ───────────────────────────────────────────────────────

/**
 * Executes `fn` up to `options.maxAttempts` times, applying exponential
 * backoff with jitter between attempts.
 *
 * Returns a RetryResult that the caller uses to decide whether to escalate
 * (e.g., alert a human operator) rather than throwing directly, so the
 * caller retains full control over the error handling path.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<RetryResult<T>> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const label = opts.label ?? "operation";

  let lastError: unknown;
  let totalDelayMs = 0;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const value = await fn();
      if (attempt > 1) {
        logger.info(
          { label, attempt, totalDelayMs },
          "Retry succeeded",
        );
      }
      return { success: true, value, attempts: attempt, totalDelayMs };
    } catch (err) {
      lastError = err;

      // Check if this error is worth retrying.
      if (opts.isRetryable && !opts.isRetryable(err)) {
        logger.warn(
          { label, attempt, err },
          "Non-retryable error encountered — aborting retry sequence",
        );
        return { success: false, error: err, attempts: attempt, totalDelayMs };
      }

      if (attempt === opts.maxAttempts) {
        // Final attempt failed — fall through to return below.
        logger.error(
          { label, attempt, maxAttempts: opts.maxAttempts, err },
          "All retry attempts exhausted",
        );
        break;
      }

      // Compute the next delay: base * 2^(attempt-1) capped at maxDelayMs,
      // plus uniform random jitter.
      const exponentialDelay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs,
      );
      const jitter    = Math.random() * opts.maxJitterMs;
      const delayMs   = Math.floor(exponentialDelay + jitter);
      totalDelayMs   += delayMs;

      logger.warn(
        { label, attempt, maxAttempts: opts.maxAttempts, delayMs, err },
        "Attempt failed — retrying after delay",
      );

      await sleep(delayMs);
    }
  }

  return {
    success:      false,
    error:        lastError,
    attempts:     opts.maxAttempts,
    totalDelayMs,
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used by withRetry() to implement the inter-attempt delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if the error appears to be a transient Solana RPC error
 * worth retrying (rate limit, timeout, connection reset) rather than a
 * permanent program error (invalid instruction, constraint violation).
 *
 * Used as the default `isRetryable` predicate for transaction submissions.
 *
 * Permanent-error detection matches against the human-readable error strings
 * that Anchor embeds in thrown errors (from the msg() annotation in errors.rs).
 * These strings appear in the wrapped error.message regardless of whether
 * Anchor raises an AnchorError or a SendTransactionError, so matching on
 * substrings of the msg() text is more reliable than matching on the Anchor
 * simulation prefix (whose exact format varies across @solana/web3.js versions
 * and Anchor releases).
 */
export function isSolanaTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return true; // Unknown errors: retry by default.

  const msg = err.message.toLowerCase();

  // Permanent on-chain program errors — no point retrying.
  // Each string is a lowercase substring of the exact msg() in errors.rs so
  // the match survives Anchor wrapping the message in a larger error string.
  const permanentPatterns = [
    "already triggered for inheritance",          // VaultAlreadyTriggered
    "already been claimed",                       // VaultAlreadyClaimed
    "already been emergency-swept",               // VaultAlreadySwept
    "inheritance threshold has not been reached", // VaultNotTriggered & ThresholdNotReached
    "not enough guardian signatures",             // InsufficientSignatures
    "only the vault owner",                       // UnauthorisedOwner
    "only an active guardian",                    // UnauthorisedGuardian
    "only the vault beneficiary",                 // UnauthorisedBeneficiary
  ];

  for (const pattern of permanentPatterns) {
    if (msg.includes(pattern)) return false;
  }

  // Transient errors — worth retrying.
  return true;
}

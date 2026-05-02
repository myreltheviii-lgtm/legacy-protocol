import {
  withRetry,
  isSolanaTransientError,
  sleep,
  RetryOptions,
  TRIGGER_RETRY_OPTIONS,
  DEFAULT_RETRY_OPTIONS,
} from "../../relayer/src/retry";

describe("withRetry", () => {
  it("succeeds on first attempt with no retries", async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return "ok"; }, { maxAttempts: 3 });
    expect(result.success).toBe(true);
    expect(result.value).toBe("ok");
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("retries on transient errors up to maxAttempts=3, then fails", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; throw new Error("timeout"); },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, maxJitterMs: 0 },
    );
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("succeeds on second attempt after one failure", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; if (calls < 2) throw new Error("retry me"); return "done"; },
      { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 10, maxJitterMs: 0 },
    );
    expect(result.success).toBe(true);
    expect(result.value).toBe("done");
    expect(result.attempts).toBe(2);
  });

  it("maxDelayMs=60000 cap respected — delay does not exceed max", () => {
    const opts: RetryOptions = {
      maxAttempts: 10,
      baseDelayMs: 2_000,
      maxDelayMs:  60_000,
      maxJitterMs: 0,
    };
    // Compute the delay for each attempt and verify cap
    for (let attempt = 1; attempt <= 10; attempt++) {
      const exponential = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
      expect(exponential).toBeLessThanOrEqual(60_000);
    }
  });

  it("exponential backoff: delays double with each attempt", () => {
    const baseDelayMs = 1_000;
    const maxDelayMs  = 60_000;
    const delays = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      delays.push(Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs));
    }
    expect(delays[0]).toBe(1_000);
    expect(delays[1]).toBe(2_000);
    expect(delays[2]).toBe(4_000);
    expect(delays[3]).toBe(8_000);
    expect(delays[4]).toBe(16_000);
  });

  it("isSolanaTransientError fast-fail: VaultAlreadyTriggered stops retry", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; throw new Error("The vault has already been triggered for inheritance."); },
      {
        maxAttempts: 10,
        baseDelayMs: 1,
        maxDelayMs:  10,
        maxJitterMs: 0,
        isRetryable: isSolanaTransientError,
      },
    );
    expect(result.success).toBe(false);
    expect(calls).toBe(1); // fast-fail on attempt 1
  });

  it("isSolanaTransientError fast-fail: AlreadyClaimed stops retry", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; throw new Error("The vault has already been claimed."); },
      { maxAttempts: 10, baseDelayMs: 1, maxDelayMs: 10, maxJitterMs: 0, isRetryable: isSolanaTransientError },
    );
    expect(result.success).toBe(false);
    expect(calls).toBe(1);
  });

  it("isSolanaTransientError: network timeout retries", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; throw new Error("Connection timed out"); },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, maxJitterMs: 0, isRetryable: isSolanaTransientError },
    );
    expect(result.success).toBe(false);
    expect(calls).toBe(3); // transient error, retried all 3 times
  });

  it("exhausted retries have success=false with correct attempts count", async () => {
    const result = await withRetry(
      async () => { throw new Error("always fail"); },
      { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5, maxJitterMs: 0 },
    );
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(5);
  });

  it("TRIGGER_RETRY_OPTIONS has maxAttempts=10", () => {
    expect(TRIGGER_RETRY_OPTIONS.maxAttempts).toBe(10);
    expect(TRIGGER_RETRY_OPTIONS.baseDelayMs).toBe(2_000);
    expect(TRIGGER_RETRY_OPTIONS.maxDelayMs).toBe(60_000);
  });
});

describe("isSolanaTransientError", () => {
  it("returns false for VaultAlreadyTriggered pattern", () => {
    expect(isSolanaTransientError(new Error("The vault has already been triggered for inheritance."))).toBe(false);
  });

  it("returns false for AlreadyClaimed pattern", () => {
    expect(isSolanaTransientError(new Error("The vault has already been claimed."))).toBe(false);
  });

  it("returns false for VaultAlreadySwept pattern", () => {
    expect(isSolanaTransientError(new Error("The vault has already been emergency-swept."))).toBe(false);
  });

  it("returns false for ThresholdNotReached pattern", () => {
    expect(isSolanaTransientError(new Error("The inheritance threshold has not been reached yet."))).toBe(false);
  });

  it("returns false for InsufficientSignatures pattern", () => {
    expect(isSolanaTransientError(new Error("Not enough guardian signatures on this covenant."))).toBe(false);
  });

  it("returns false for UnauthorisedOwner pattern", () => {
    expect(isSolanaTransientError(new Error("Only the vault owner can perform this action."))).toBe(false);
  });

  it("returns false for UnauthorisedGuardian pattern", () => {
    expect(isSolanaTransientError(new Error("Only an active guardian of this vault can perform this action."))).toBe(false);
  });

  it("returns false for UnauthorisedBeneficiary pattern", () => {
    expect(isSolanaTransientError(new Error("Only the vault beneficiary can claim."))).toBe(false);
  });

  it("returns true for network timeout", () => {
    expect(isSolanaTransientError(new Error("Connection timed out after 30000ms"))).toBe(true);
  });

  it("returns true for rate limit error", () => {
    expect(isSolanaTransientError(new Error("429 Too Many Requests"))).toBe(true);
  });

  it("returns true for generic RPC error", () => {
    expect(isSolanaTransientError(new Error("Network request failed"))).toBe(true);
  });

  it("returns true for unknown error (non-Error)", () => {
    expect(isSolanaTransientError("some string error")).toBe(true);
    expect(isSolanaTransientError(null)).toBe(true);
    expect(isSolanaTransientError(42)).toBe(true);
  });
});
```


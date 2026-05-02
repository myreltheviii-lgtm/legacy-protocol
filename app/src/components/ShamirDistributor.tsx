// app/src/components/ShamirDistributor.tsx
//
// Level 4 frontend feature: in-browser Shamir's Secret Sharing for guardian
// key distribution. Lets the vault owner split a secret (e.g., a seed phrase,
// a hardware wallet PIN, or a recovery phrase) into N shares such that any M
// of them can reconstruct the original.
//
// Security model:
//   - All GF(256) arithmetic runs entirely in the browser via the SDK's
//     splitSecret() function, which mirrors crates/shamir/ exactly.
//   - Share bytes never leave the browser unless the user explicitly downloads
//     or copies them. No network requests are made during share generation.
//   - Each share is presented as a downloadable .txt "guardian card" that the
//     owner physically delivers to each guardian (in person, encrypted email,
//     etc.). The card contains the share index, base64-encoded share data, and
//     step-by-step recovery instructions.
//   - The secret is cleared from component state as soon as shares are
//     generated, minimising the window in which it exists in memory.
//   - Verify phase: shows the reconstructed plaintext for 8 seconds so the
//     owner can confirm the content is correct, then clears it automatically.
//
// WCAG 2.1 AA: every interactive element has aria-label. Keyboard navigation
// follows logical reading order. No information is conveyed by colour alone.

"use client";

import React, { useState, useRef } from "react";
import {
  splitSecret,
  reconstructSecret,
  encodeShareBase64,
  decodeShareBase64,
  ShamirShare,
  ShamirError,
} from "@legacy-protocol/sdk";

interface ShamirDistributorProps {
  /** The vault PDA address — included in guardian cards for reference. */
  vaultPda:  string;
  /** Called after shares are generated so the parent can log the event. */
  onShared?: (threshold: number, numShares: number) => void;
}

type Phase = "configure" | "enter-secret" | "generated" | "verify";

const MAX_SHARES    = 10;
const MAX_THRESHOLD = 10;

export function ShamirDistributor({ vaultPda, onShared }: ShamirDistributorProps) {
  const [phase,            setPhase]            = useState<Phase>("configure");
  const [numShares,        setNumShares]        = useState(3);
  const [threshold,        setThreshold]        = useState(2);
  const [secretInput,      setSecretInput]      = useState("");
  const [shares,           setShares]           = useState<ShamirShare[]>([]);
  const [error,            setError]            = useState<string | null>(null);
  const [verifyInputs,     setVerifyInputs]     = useState<string[]>([]);
  const [verifyResult,     setVerifyResult]     = useState<"ok" | "fail" | null>(null);
  // Reconstructed secret shown during verify — cleared automatically after 8 s.
  const [verifySecret,     setVerifySecret]     = useState<string | null>(null);
  const secretRef = useRef<HTMLTextAreaElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setPhase("configure");
    setSecretInput("");
    setShares([]);
    setError(null);
    setVerifyInputs([]);
    setVerifyResult(null);
    setVerifySecret(null);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }

  function handleGenerate() {
    setError(null);
    if (!secretInput.trim()) {
      setError("Enter the secret to split.");
      return;
    }
    try {
      const encoded   = new TextEncoder().encode(secretInput.trim());
      const generated = splitSecret(encoded, threshold, numShares);
      setShares(generated);
      // Clear the secret input from component state immediately after shares are
      // produced — the secret no longer needs to reside in memory.
      setSecretInput("");
      setPhase("generated");
      onShared?.(threshold, numShares);
    } catch (err) {
      setError(err instanceof ShamirError ? err.message : String(err));
    }
  }

  function downloadShare(share: ShamirShare, index: number) {
    const encoded     = encodeShareBase64(share);
    const guardianNum = index + 1;
    const text = [
      `LEGACY PROTOCOL — GUARDIAN SHARE`,
      ``,
      `Vault:         ${vaultPda}`,
      `Share:         ${share.index} of ${numShares}`,
      `Threshold:     ${threshold}-of-${numShares} shares required to reconstruct`,
      ``,
      `SHARE DATA (base64):`,
      encoded,
      ``,
      `INSTRUCTIONS:`,
      `1. Store this card in a secure, offline location.`,
      `2. Never share it digitally unless using end-to-end encryption.`,
      `3. In a recovery event, provide this share to the designated`,
      `   recovery coordinator along with the other ${threshold - 1} guardian(s).`,
      `4. The coordinator will combine ${threshold} shares to reconstruct`,
      `   the secret and execute the vault recovery process.`,
      ``,
      `IMPORTANT: This file contains a cryptographic secret. Losing`,
      `${numShares - threshold + 1} or more shares permanently destroys the secret.`,
      ``,
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `legacy-vault-share-${guardianNum}-of-${numShares}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAllShares() {
    shares.forEach((share, i) => downloadShare(share, i));
  }

  function startVerify() {
    setVerifyInputs(Array(threshold).fill(""));
    setVerifyResult(null);
    setVerifySecret(null);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setPhase("verify");
  }

  function handleVerifyChange(idx: number, value: string) {
    setVerifyInputs((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }

  function handleVerify() {
    setError(null);
    setVerifyResult(null);
    setVerifySecret(null);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);

    try {
      const decoded = verifyInputs.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error(`Share ${i + 1} is empty.`);
        return decodeShareBase64(trimmed);
      });

      const reconstructed = reconstructSecret(decoded);
      const text          = new TextDecoder().decode(reconstructed);

      setVerifyResult("ok");
      // Show the reconstructed text briefly so the owner can confirm the
      // content is correct, then clear it automatically for security.
      setVerifySecret(text);
      clearTimerRef.current = setTimeout(() => {
        setVerifySecret(null);
      }, 8_000);
    } catch (err) {
      setVerifyResult("fail");
      setError(err instanceof ShamirError ? err.message : String(err));
    }
  }

  return (
    <div
      className="card"
      style={{ borderColor: "rgba(129,140,248,0.3)", background: "rgba(129,140,248,0.04)" }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          aria-hidden="true"
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "rgba(129,140,248,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}
        >
          🔑
        </div>
        <div>
          <h2 className="font-display text-xl text-cream leading-none">
            Guardian Share Distribution
          </h2>
          <p className="text-stone-500 text-xs mt-0.5">
            Split a secret into shares — require M-of-N to reconstruct
          </p>
        </div>
      </div>

      {/* ── Phase: Configure ── */}
      {phase === "configure" && (
        <div className="space-y-5 animate-fade-in">
          <p className="text-stone-400 text-sm leading-relaxed">
            Shamir's Secret Sharing splits any secret — a seed phrase, hardware wallet PIN, or
            recovery key — into <strong className="text-cream">{numShares} shares</strong> such
            that any <strong className="text-cream">{threshold}</strong> of them can reconstruct
            the original. All computation happens entirely in your browser; nothing is sent
            to any server.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="shamir-num-shares" className="label block mb-2">
                Total shares (N)
              </label>
              <input
                id="shamir-num-shares"
                type="number"
                className="input"
                min={2}
                max={MAX_SHARES}
                value={numShares}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setNumShares(n);
                  if (threshold > n) setThreshold(n);
                }}
                aria-label="Total number of shares to generate"
              />
              <p className="text-stone-600 text-xs mt-1">One per guardian, max {MAX_SHARES}</p>
            </div>

            <div>
              <label htmlFor="shamir-threshold" className="label block mb-2">
                Required shares (M)
              </label>
              <input
                id="shamir-threshold"
                type="number"
                className="input"
                min={1}
                max={numShares}
                value={threshold}
                onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
                aria-label="Minimum shares required to reconstruct secret"
              />
              <p className="text-stone-600 text-xs mt-1">Minimum to reconstruct</p>
            </div>
          </div>

          <div
            className="p-3 rounded-lg text-sm text-stone-400"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
            role="note"
          >
            With these settings: any <strong className="text-cream">{threshold}</strong> of{" "}
            <strong className="text-cream">{numShares}</strong> guardians can reconstruct the
            secret. Losing <strong className="text-cream">{numShares - threshold + 1}</strong> or
            more shares permanently destroys it.
          </div>

          <div className="flex gap-3">
            <button
              className="btn-primary"
              onClick={() => setPhase("enter-secret")}
              aria-label="Proceed to enter the secret"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: Enter secret ── */}
      {phase === "enter-secret" && (
        <div className="space-y-4 animate-slide-up">
          <button
            className="text-stone-400 text-sm hover:text-cream flex items-center gap-1"
            onClick={() => setPhase("configure")}
            aria-label="Back to configuration"
          >
            ← Back
          </button>

          <div
            className="p-3 rounded-lg text-xs text-orange-300"
            style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.3)" }}
            role="alert"
          >
            ⚠ Only enter this secret on a device you trust. The secret exists in browser memory
            during generation and is cleared immediately after shares are produced.
          </div>

          <div>
            <label htmlFor="shamir-secret" className="label block mb-2">
              Secret to split
            </label>
            <textarea
              id="shamir-secret"
              ref={secretRef}
              className="input font-mono text-sm"
              rows={4}
              placeholder="Seed phrase, PIN, or other secret..."
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              aria-label="Secret value to split into shares"
              style={{ resize: "none" }}
            />
          </div>

          {error && (
            <p role="alert" className="text-red-400 text-xs">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              className="btn-primary"
              onClick={handleGenerate}
              disabled={!secretInput.trim()}
              aria-label={`Generate ${numShares} shares requiring ${threshold} to reconstruct`}
            >
              Generate {numShares} Shares
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: Generated ── */}
      {phase === "generated" && (
        <div className="space-y-5 animate-fade-in">
          <div
            className="p-3 rounded-lg text-sm text-emerald-400"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)" }}
            role="status"
            aria-live="polite"
          >
            ✓ {numShares} shares generated. Download each share card and distribute one to each guardian.
            Any {threshold} shares can reconstruct the secret.
          </div>

          <div className="space-y-3">
            {shares.map((share, i) => (
              <div
                key={share.index}
                className="rounded-lg p-4"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                aria-label={`Share ${share.index} of ${numShares}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-mono font-medium"
                      style={{ background: "rgba(129,140,248,0.15)", color: "#818CF8" }}
                    >
                      Share {share.index} of {numShares}
                    </span>
                    <p
                      className="font-mono text-xs text-stone-400 mt-2 break-all"
                      style={{ wordBreak: "break-all", fontSize: 10 }}
                    >
                      {encodeShareBase64(share).slice(0, 32)}…
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={() => {
                        navigator.clipboard?.writeText(encodeShareBase64(share));
                      }}
                      aria-label={`Copy share ${share.index} to clipboard`}
                    >
                      Copy
                    </button>
                    <button
                      className="btn-primary text-xs px-3 py-1.5"
                      onClick={() => downloadShare(share, i)}
                      aria-label={`Download share ${share.index} as text file`}
                    >
                      ↓ Download
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="btn-primary"
              onClick={downloadAllShares}
              aria-label="Download all share cards at once"
            >
              ↓ Download All Shares
            </button>
            <button
              className="btn-secondary"
              onClick={startVerify}
              aria-label="Verify reconstruction by entering shares"
            >
              Verify reconstruction
            </button>
            <button
              className="btn-secondary"
              onClick={reset}
              aria-label="Start over with new configuration"
            >
              Start over
            </button>
          </div>

          <p className="text-stone-600 text-xs">
            After distributing shares, delete this browser tab or clear your browser history
            to remove any cached data. The shares are now the only copies of this secret.
          </p>
        </div>
      )}

      {/* ── Phase: Verify ── */}
      {phase === "verify" && (
        <div className="space-y-4 animate-slide-up">
          <button
            className="text-stone-400 text-sm hover:text-cream flex items-center gap-1"
            onClick={() => setPhase("generated")}
            aria-label="Back to generated shares"
          >
            ← Back
          </button>

          <p className="text-stone-400 text-sm">
            Enter any {threshold} share values (base64) to verify that reconstruction works correctly.
            The reconstructed secret will be shown briefly for confirmation, then cleared automatically.
          </p>

          <div className="space-y-3">
            {verifyInputs.map((val, i) => (
              <div key={i}>
                <label htmlFor={`verify-share-${i}`} className="label block mb-1">
                  Share {i + 1}
                </label>
                <input
                  id={`verify-share-${i}`}
                  type="text"
                  className="input font-mono text-xs"
                  placeholder="Paste base64 share value…"
                  value={val}
                  onChange={(e) => handleVerifyChange(i, e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Verification share ${i + 1} input`}
                />
              </div>
            ))}
          </div>

          {error && (
            <div role="alert" className="text-red-400 text-xs p-2 rounded"
              style={{ background: "rgba(239,68,68,0.08)" }}>
              {error}
            </div>
          )}

          {verifyResult === "ok" && (
            <div
              role="status"
              aria-live="polite"
              className="space-y-3"
            >
              <div
                className="p-3 rounded-lg text-sm text-emerald-400"
                style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)" }}
              >
                ✓ Shares reconstruct correctly. Distribution is valid.
              </div>

              {verifySecret !== null && (
                <div className="p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="label">Reconstructed secret</span>
                    <span className="text-stone-500 text-xs">Clears in 8 s</span>
                  </div>
                  <pre
                    className="font-mono text-sm text-cream break-all whitespace-pre-wrap"
                    style={{ wordBreak: "break-all" }}
                    aria-label="Reconstructed secret — will clear automatically"
                  >
                    {verifySecret}
                  </pre>
                </div>
              )}
            </div>
          )}

          {verifyResult === "fail" && (
            <div
              role="alert"
              className="p-3 rounded-lg text-sm text-red-400"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              ✗ Reconstruction failed. Check that the share values are correct.
            </div>
          )}

          <button
            className="btn-primary"
            onClick={handleVerify}
            disabled={verifyInputs.some((v) => !v.trim())}
            aria-label="Attempt to reconstruct secret from entered shares"
          >
            Verify
          </button>
        </div>
      )}
    </div>
  );
}
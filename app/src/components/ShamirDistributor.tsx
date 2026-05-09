"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import {
  splitSecret,
  reconstructSecret,
  encodeShareBase64,
  decodeShareBase64,
  ShamirShare,
  ShamirError,
} from "@legacy-protocol/sdk";

interface ShamirDistributorProps {
  vaultPda:  string;
  onShared?: (threshold: number, numShares: number) => void;
}

type Phase = "configure" | "enter-secret" | "generated" | "verify";

const MAX_SHARES = 10;

export function ShamirDistributor({ vaultPda, onShared }: ShamirDistributorProps) {
  const [phase,        setPhase]        = useState<Phase>("configure");
  const [numShares,    setNumShares]    = useState(3);
  const [threshold,    setThreshold]    = useState(2);
  const [secretInput,  setSecretInput]  = useState("");
  const [shares,       setShares]       = useState<ShamirShare[]>([]);
  const [error,        setError]        = useState<string | null>(null);
  const [verifyInputs, setVerifyInputs] = useState<string[]>([]);
  const [verifyResult, setVerifyResult] = useState<"ok" | "fail" | null>(null);
  const [verifySecret, setVerifySecret] = useState<string | null>(null);
  const [copiedShare,  setCopiedShare]  = useState<number | null>(null);
  const [isOnline,     setIsOnline]     = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const secretRef     = useRef<HTMLTextAreaElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Network status listeners — cleaned up on unmount.
  useEffect(() => {
    function onOnline()  { setIsOnline(true); }
    function onOffline() { setIsOnline(false); }
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Clear the auto-dismiss timer on unmount to prevent calling setState on
  // an unmounted component if the user navigates away within 8 seconds of
  // a successful verification.
  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, []);

  function reset() {
    setPhase("configure");
    setSecretInput("");
    setShares([]);
    setError(null);
    setVerifyInputs([]);
    setVerifyResult(null);
    setVerifySecret(null);
    setCopiedShare(null);
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }

  function handleGenerate() {
    setError(null);
    if (!secretInput.trim()) { setError("Enter the secret to split."); return; }
    if (threshold < 1 || threshold > numShares) {
      setError(`M (${threshold}) must be between 1 and N (${numShares}).`);
      return;
    }
    try {
      const encoded   = new TextEncoder().encode(secretInput.trim());
      const generated = splitSecret(encoded, threshold, numShares);
      setShares(generated);
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
      `3. In a recovery event, provide this share to the recovery coordinator`,
      `   along with the other ${threshold - 1} guardian(s).`,
      `4. The coordinator will combine ${threshold} shares to reconstruct`,
      `   the secret and execute the vault recovery process.`,
      ``,
      `IMPORTANT: This file contains a cryptographic secret.`,
      `Losing ${numShares - threshold + 1} or more shares permanently destroys the secret.`,
      ``,
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `legacy-share-${guardianNum}-of-${numShares}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAllShares() {
    shares.forEach((share, i) => downloadShare(share, i));
  }

  async function handleCopyShare(share: ShamirShare) {
    const encoded = encodeShareBase64(share);
    try {
      await navigator.clipboard.writeText(encoded);
      setCopiedShare(share.index);
      setTimeout(() => setCopiedShare(null), 2000);
    } catch { /* ignore */ }
  }

  function startVerify() {
    setVerifyInputs(Array(threshold).fill(""));
    setVerifyResult(null);
    setVerifySecret(null);
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setPhase("verify");
  }

  function handleVerifyChange(idx: number, value: string) {
    setVerifyInputs((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }

  function handleVerify() {
    setError(null);
    setVerifyResult(null);
    setVerifySecret(null);
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    try {
      const decoded = verifyInputs.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error(`Share ${i + 1} is empty.`);
        return decodeShareBase64(trimmed);
      });
      const reconstructed = reconstructSecret(decoded);
      const text          = new TextDecoder().decode(reconstructed);
      setVerifyResult("ok");
      setVerifySecret(text);
      clearTimerRef.current = setTimeout(() => { setVerifySecret(null); }, 8_000);
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
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "rgba(129,140,248,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, flexShrink: 0,
            }}
          >
            🔑
          </div>
          <div>
            <h2 className="font-display text-xl text-cream leading-none">Guardian Share Distribution</h2>
            <p className="text-stone-500 text-xs mt-0.5">Split a secret into shares — require M-of-N to reconstruct</p>
          </div>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: isOnline ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
            color:      isOnline ? "var(--zone-green)"     : "var(--accent)",
            border:     `1px solid ${isOnline ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
          }}
        >
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      <div
        className="p-2 rounded-lg text-xs text-stone-400 mb-4"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
      >
        ⚡ Offline mode — No data leaves your browser. Disconnect internet to verify.
      </div>

      {/* Phase: Configure */}
      {phase === "configure" && (
        <div className="space-y-5 animate-fade-in">
          <p className="text-stone-400 text-sm leading-relaxed">
            Shamir&apos;s Secret Sharing splits any secret into{" "}
            <strong className="text-cream">{numShares} shares</strong> such that any{" "}
            <strong className="text-cream">{threshold}</strong> of them can reconstruct the original.
            All computation happens entirely in your browser; nothing is sent to any server.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="shamir-num-shares" className="label block mb-2">Total shares (N)</label>
              <input
                id="shamir-num-shares"
                type="number"
                className="input"
                min={2}
                max={MAX_SHARES}
                value={numShares}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10) || 2;
                  setNumShares(n);
                  if (threshold > n) setThreshold(n);
                }}
                aria-label="Total number of shares to generate"
              />
              <p className="text-stone-600 text-xs mt-1">One per guardian, max {MAX_SHARES}</p>
            </div>
            <div>
              <label htmlFor="shamir-threshold" className="label block mb-2">Required shares (M)</label>
              <input
                id="shamir-threshold"
                type="number"
                className="input"
                min={1}
                max={numShares}
                value={threshold}
                onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 1)}
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
            <strong className="text-cream">{numShares}</strong> guardians can reconstruct the secret.
            Losing <strong className="text-cream">{numShares - threshold + 1}</strong> or more shares permanently destroys it.
          </div>

          <button className="btn-primary" onClick={() => setPhase("enter-secret")} aria-label="Proceed to enter the secret">
            Continue →
          </button>
        </div>
      )}

      {/* Phase: Enter secret */}
      {phase === "enter-secret" && (
        <div className="space-y-4 animate-slide-up">
          <button className="text-stone-400 text-sm hover:text-cream flex items-center gap-1" onClick={() => setPhase("configure")} aria-label="Back to configuration">
            ← Back
          </button>
          <div
            className="p-3 rounded-lg text-xs text-orange-300"
            style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.3)" }}
            role="alert"
          >
            ⚠ This secret never leaves your device. Zero network requests are made during generation.
            Only enter this on a device you trust.
          </div>
          <div>
            <label htmlFor="shamir-secret" className="label block mb-2">Secret to split</label>
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
          {error && <p role="alert" className="text-red-400 text-xs">{error}</p>}
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={!secretInput.trim()}
            aria-label={`Generate ${numShares} shares requiring ${threshold} to reconstruct`}
          >
            Generate {numShares} Shares
          </button>
        </div>
      )}

      {/* Phase: Generated */}
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

          <div className="space-y-4">
            {shares.map((share, i) => {
              const encoded = encodeShareBase64(share);
              const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(encoded)}`;

              return (
                <div
                  key={share.index}
                  className="rounded-lg p-4"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                  aria-label={`Share ${share.index} of ${numShares}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <Image
                        src={qrUrl}
                        alt={`QR code for share ${share.index} of ${numShares}`}
                        width={80}
                        height={80}
                        style={{ borderRadius: 6, imageRendering: "pixelated" }}
                        unoptimized
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-mono font-medium"
                          style={{ background: "rgba(129,140,248,0.15)", color: "#818CF8" }}
                        >
                          Share {share.index} of {numShares}
                        </span>
                      </div>
                      <p
                        className="font-mono text-stone-400 break-all"
                        style={{ fontSize: 10, wordBreak: "break-all", lineHeight: 1.5 }}
                        aria-label={`Share ${share.index} base64 data (truncated)`}
                      >
                        {encoded.slice(0, 40)}…
                      </p>
                      <div className="flex gap-2 mt-3">
                        <button
                          className="btn-secondary text-xs px-3 py-1.5"
                          onClick={() => { void handleCopyShare(share); }}
                          aria-label={`Copy share ${share.index} base64 to clipboard`}
                        >
                          {copiedShare === share.index ? "✓ Copied" : "Copy"}
                        </button>
                        <button
                          className="btn-primary text-xs px-3 py-1.5"
                          onClick={() => downloadShare(share, i)}
                          aria-label={`Download share ${share.index} of ${numShares} as text file`}
                        >
                          ↓ Download Share {share.index}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={downloadAllShares} aria-label="Download all share cards at once">
              ↓ Download All Shares
            </button>
            <button className="btn-secondary" onClick={startVerify} aria-label="Verify reconstruction by entering shares">
              Verify reconstruction
            </button>
            <button className="btn-secondary" onClick={reset} aria-label="Start over with new configuration">
              Start over
            </button>
          </div>

          <p className="text-stone-600 text-xs">
            After distributing shares, delete this browser tab or clear your browser history to remove any cached data.
          </p>
        </div>
      )}

      {/* Phase: Verify */}
      {phase === "verify" && (
        <div className="space-y-4 animate-slide-up">
          <button className="text-stone-400 text-sm hover:text-cream flex items-center gap-1" onClick={() => setPhase("generated")} aria-label="Back to generated shares">
            ← Back
          </button>
          <p className="text-stone-400 text-sm">
            Enter any {threshold} share values (base64) to verify that reconstruction works correctly.
            The reconstructed secret will be shown briefly for confirmation, then cleared automatically.
          </p>
          <div className="space-y-3">
            {verifyInputs.map((val, i) => (
              <div key={i}>
                <label htmlFor={`verify-share-${i}`} className="label block mb-1">Share {i + 1}</label>
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
            <div role="alert" className="text-red-400 text-xs p-2 rounded" style={{ background: "rgba(239,68,68,0.08)" }}>
              {error}
            </div>
          )}

          {verifyResult === "ok" && (
            <div role="status" aria-live="polite" className="space-y-3">
              <div
                className="p-3 rounded-lg text-sm text-emerald-400"
                style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)" }}
              >
                ✓ Reconstruction successful — secret matches. Distribution is valid.
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
                    {verifySecret.length > 20 ? `${verifySecret.slice(0, 20)}…` : verifySecret}
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
              ✗ Reconstruction failed. Check that the share values are correct and not duplicated.
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

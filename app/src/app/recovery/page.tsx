"use client";

import React, { useState } from "react";
import {
  reconstructSecret,
  decodeShareBase64,
  ShamirError,
} from "@legacy-protocol/sdk";
import { Navbar } from "@/components/Navbar";

type RecoveryPhase = "intro" | "enter-shares" | "result";

export default function RecoveryPage() {
  const [phase,       setPhase]       = useState<RecoveryPhase>("intro");
  const [shareCount,  setShareCount]  = useState(2);
  const [shareInputs, setShareInputs] = useState<string[]>(["", ""]);
  const [secret,      setSecret]      = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  function handleShareCountChange(n: number) {
    const clamped = Math.max(1, Math.min(10, n));
    setShareCount(clamped);
    setShareInputs(Array(clamped).fill(""));
  }

  function handleShareInput(idx: number, value: string) {
    setShareInputs((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }

  function handleReconstruct() {
    setError(null);
    setSecret(null);
    try {
      const filled = shareInputs.filter((s) => s.trim().length > 0);
      if (filled.length < shareCount) {
        setError(`Fill all ${shareCount} share fields before reconstructing.`);
        return;
      }
      const decoded = filled.map((s) => decodeShareBase64(s.trim()));
      const raw     = reconstructSecret(decoded);
      // Display as hex for readability.
      const hex = Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("");
      raw.fill(0);
      setSecret(hex);
      setPhase("result");
    } catch (err) {
      if (err instanceof ShamirError) {
        setError(`Shamir error: ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : "Reconstruction failed");
      }
    }
  }

  function handleCopy() {
    if (!secret) return;
    navigator.clipboard?.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleReset() {
    setSecret(null);
    setShareInputs(Array(shareCount).fill(""));
    setPhase("intro");
    setError(null);
    setCopied(false);
  }

  const filledCount = shareInputs.filter((v) => v.trim().length > 0).length;

  return (
    <div className="min-h-dvh flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-12">
        <h1 className="font-display text-4xl text-cream mb-2">Vault Recovery</h1>
        <p className="text-stone-400 text-sm mb-8">
          Combine guardian shares to reconstruct the original vault secret.
          All computation runs in your browser — nothing is sent to any server.
        </p>

        {/* Offline guarantee banner */}
        <div
          className="p-3 rounded-lg text-xs text-stone-400 mb-6"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
        >
          🔒 <strong className="text-stone-300">Offline-safe.</strong> This page works with no internet
          connection. All Shamir arithmetic runs locally in your browser.
        </div>

        {phase === "intro" && (
          <div className="space-y-6">
            <div className="card space-y-4">
              <div>
                <label className="label block mb-2">Number of shares to combine</label>
                <div className="flex items-center gap-3">
                  <button
                    className="btn-secondary px-3 py-1"
                    onClick={() => handleShareCountChange(shareCount - 1)}
                    aria-label="Decrease share count"
                  >
                    −
                  </button>
                  <span className="text-cream font-mono text-xl w-8 text-center">{shareCount}</span>
                  <button
                    className="btn-secondary px-3 py-1"
                    onClick={() => handleShareCountChange(shareCount + 1)}
                    aria-label="Increase share count"
                  >
                    +
                  </button>
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={() => { setShareInputs(Array(shareCount).fill("")); setPhase("enter-shares"); }}
              >
                Enter {shareCount} Share{shareCount !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {phase === "enter-shares" && (
          <div className="space-y-4">
            {shareInputs.map((val, idx) => (
              <div key={idx} className="space-y-1">
                <label className="label">Share {idx + 1}</label>
                <textarea
                  className="input w-full font-mono text-xs resize-none"
                  rows={3}
                  value={val}
                  onChange={(e) => handleShareInput(idx, e.target.value)}
                  placeholder={`Paste base64 share ${idx + 1} here`}
                  spellCheck={false}
                  aria-label={`Share ${idx + 1} input`}
                />
              </div>
            ))}

            {error && (
              <div role="alert" className="text-red-400 text-sm">{error}</div>
            )}

            <div className="flex gap-3">
              <button className="btn-secondary" onClick={handleReset}>
                Back
              </button>
              <button
                className="btn-primary"
                onClick={handleReconstruct}
                disabled={filledCount < shareCount}
                aria-label="Reconstruct secret from shares"
              >
                Reconstruct ({filledCount}/{shareCount})
              </button>
            </div>
          </div>
        )}

        {phase === "result" && secret && (
          <div className="space-y-4">
            <div
              className="card space-y-3"
              style={{ borderColor: "rgba(16,185,129,0.4)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-lg">✓</span>
                <h2 className="font-display text-xl text-cream">Reconstruction successful</h2>
              </div>
              <p className="text-stone-400 text-sm">
                Your vault secret has been reconstructed. Copy it now — it will be cleared when you navigate away.
              </p>
              <div
                className="p-3 rounded-lg font-mono text-xs break-all"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                aria-label="Reconstructed secret (hex)"
              >
                {secret}
              </div>
              <div className="flex gap-3">
                <button
                  className="btn-primary text-sm"
                  onClick={handleCopy}
                  aria-label="Copy reconstructed secret to clipboard"
                >
                  {copied ? "✓ Copied" : "Copy to Clipboard"}
                </button>
                <button className="btn-secondary text-sm" onClick={handleReset}>
                  Clear &amp; Reset
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="px-6 py-4 border-t text-center text-stone-600 text-xs" style={{ borderColor: "var(--border)" }}>
        Legacy Protocol · Open source · Permissionless
      </footer>
    </div>
  );
}

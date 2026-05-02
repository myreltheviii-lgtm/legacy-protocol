// app/src/app/recovery/page.tsx
//
// Vault recovery assistant. Guides a recovery coordinator through the process
// of reconstructing a secret from M-of-N Shamir shares collected from
// guardians. Entirely offline-capable — no network requests are made during
// share combination. The reconstructed secret is displayed in memory only;
// it is cleared when the component unmounts or the user dismisses it.

"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  reconstructSecret,
  decodeShareBase64,
  ShamirError,
} from "@legacy-protocol/sdk";

type RecoveryPhase = "intro" | "enter-shares" | "result";

export default function RecoveryPage() {
  const [phase,       setPhase]       = useState<RecoveryPhase>("intro");
  const [shareCount,  setShareCount]  = useState(2);
  const [shareInputs, setShareInputs] = useState<string[]>(["", ""]);
  const [secret,      setSecret]      = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  function handleShareCountChange(n: number) {
    setShareCount(n);
    setShareInputs(Array(n).fill(""));
  }

  function handleShareInput(idx: number, value: string) {
    setShareInputs((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }

  function handleReconstruct() {
    setError(null);
    setSecret(null);

    try {
      const shares = shareInputs.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error(`Share ${i + 1} is empty.`);
        return decodeShareBase64(trimmed);
      });

      const reconstructed = reconstructSecret(shares);
      const text = new TextDecoder().decode(reconstructed);
      setSecret(text);
      setPhase("result");
    } catch (err) {
      setError(err instanceof ShamirError ? err.message : String(err));
    }
  }

  function handleCopy() {
    if (!secret) return;
    navigator.clipboard?.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleClear() {
    setSecret(null);
    setShareInputs(Array(shareCount).fill(""));
    setPhase("intro");
    setError(null);
    setCopied(false);
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <nav
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
        aria-label="Main navigation"
      >
        <Link href="/" className="font-display text-lg text-cream" aria-label="Back to home">
          Legacy Protocol
        </Link>
      </nav>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-12">
        <h1 className="font-display text-4xl text-cream mb-2">Vault Recovery</h1>
        <p className="text-stone-400 text-sm mb-8">
          Combine guardian shares to reconstruct the original vault secret.
          All computation runs in your browser — nothing is sent to any server.
        </p>

        {/* ── Intro ── */}
        {phase === "intro" && (
          <div className="space-y-6 animate-fade-in">
            <div className="card">
              <h2 className="font-display text-xl text-cream mb-3">Prerequisites</h2>
              <ul className="space-y-2 text-sm text-stone-400" aria-label="Recovery prerequisites">
                {[
                  "Collect at least M share cards from guardians (M = the threshold set at distribution time).",
                  "Each share card contains a base64-encoded share value. You will paste these below.",
                  "If you have too few shares (less than M), reconstruction is cryptographically impossible.",
                  "Only perform this on a trusted, air-gapped device where possible.",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-indigo-400 flex-shrink-0" aria-hidden="true">→</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="card">
              <label htmlFor="share-count" className="label block mb-2">
                Number of shares you have collected
              </label>
              <input
                id="share-count"
                type="number"
                className="input"
                min={1}
                max={10}
                value={shareCount}
                onChange={(e) => handleShareCountChange(parseInt(e.target.value, 10) || 1)}
                aria-label="Number of shares to enter"
              />
            </div>

            <button
              className="btn-primary"
              onClick={() => setPhase("enter-shares")}
              aria-label="Proceed to enter shares"
            >
              Enter {shareCount} share{shareCount !== 1 ? "s" : ""} →
            </button>
          </div>
        )}

        {/* ── Enter shares ── */}
        {phase === "enter-shares" && (
          <div className="space-y-5 animate-slide-up">
            <button
              className="text-stone-400 text-sm hover:text-cream flex items-center gap-1"
              onClick={() => setPhase("intro")}
              aria-label="Back to introduction"
            >
              ← Back
            </button>

            <div
              className="p-3 rounded-lg text-xs text-orange-300"
              style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.3)" }}
              role="alert"
            >
              ⚠ Paste share values exactly as they appear on the guardian cards.
              Do not modify the base64 string in any way.
            </div>

            <div className="space-y-4">
              {shareInputs.map((val, i) => (
                <div key={i}>
                  <label htmlFor={`share-input-${i}`} className="label block mb-1">
                    Share {i + 1}
                  </label>
                  <input
                    id={`share-input-${i}`}
                    type="text"
                    className="input font-mono text-xs"
                    placeholder="Paste base64 share value from guardian card…"
                    value={val}
                    onChange={(e) => handleShareInput(i, e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Guardian share ${i + 1} value`}
                  />
                </div>
              ))}
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg text-sm text-red-400"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                {error}
              </div>
            )}

            <button
              className="btn-primary"
              onClick={handleReconstruct}
              disabled={shareInputs.some((v) => !v.trim())}
              aria-label="Reconstruct secret from entered shares"
            >
              Reconstruct Secret
            </button>
          </div>
        )}

        {/* ── Result ── */}
        {phase === "result" && secret !== null && (
          <div className="space-y-5 animate-slide-up">
            <div
              className="p-4 rounded-lg"
              style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)" }}
            >
              <p className="text-emerald-400 font-medium mb-1">✓ Secret reconstructed</p>
              <p className="text-stone-400 text-sm">
                Copy or use the secret below, then click <strong>Clear</strong> immediately.
                Do not leave this page open.
              </p>
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="label">Reconstructed secret</span>
                <button
                  className="btn-secondary text-xs px-3 py-1.5"
                  onClick={handleCopy}
                  aria-label="Copy reconstructed secret to clipboard"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <pre
                className="font-mono text-sm text-cream break-all whitespace-pre-wrap"
                style={{ wordBreak: "break-all" }}
                aria-label="Reconstructed secret value"
              >
                {secret}
              </pre>
            </div>

            <button
              className="btn-danger w-full"
              onClick={handleClear}
              aria-label="Clear secret from memory and start over"
            >
              Clear &amp; Start Over
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
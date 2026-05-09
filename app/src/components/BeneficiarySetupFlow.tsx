"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  generateBeneficiaryIdentity,
  exportBeneficiaryIdentity,
} from "@legacy-protocol/cloak-integration";
import { utxoPubkeyToHex } from "@legacy-protocol/sdk";
import type { UtxoIdentity } from "@legacy-protocol/cloak-integration";

interface Props {
  /** Called with the hex-encoded UTXO public key once the beneficiary confirms backup. */
  onComplete: (beneficiaryUtxoPubkeyHex: string) => void;
}

type Step = "generate" | "backup" | "confirm";

export function BeneficiarySetupFlow({ onComplete }: Props) {
  const [step,       setStep]       = useState<Step>("generate");
  // identity is held in a ref — NOT state — so UtxoIdentity.privateKey bytes
  // never appear in the React state tree, DevTools snapshots, or memory dumps.
  // hasIdentity is the boolean state that drives conditional renders.
  const identityRef = useRef<UtxoIdentity | null>(null);
  const [hasIdentity, setHasIdentity] = useState(false);

  const [password,   setPassword]   = useState("");
  const [password2,  setPassword2]  = useState("");
  const [copied,     setCopied]     = useState(false);
  const [confirmed,  setConfirmed]  = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Zero and release the private key on unmount so the raw bytes cannot be
  // recovered from freed memory by GC after this component is removed from
  // the tree. This covers all exit paths including back-navigation.
  useEffect(() => {
    return () => {
      if (identityRef.current) {
        identityRef.current.privateKey.fill(0);
        identityRef.current = null;
      }
    };
  }, []);

  function storeIdentity(id: UtxoIdentity) {
    identityRef.current = id;
    setHasIdentity(true);
  }

  // publicKeyHex is derived from the ref (not from state) so no key material
  // is ever serialised into the React state tree.
  const publicKeyHex = hasIdentity && identityRef.current
    ? utxoPubkeyToHex(identityRef.current.publicKey)
    : null;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const id = await generateBeneficiaryIdentity();
      storeIdentity(id);
      setStep("backup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Key generation failed");
    } finally {
      setGenerating(false);
    }
  }, []);

  async function handleDownloadBackup() {
    if (!identityRef.current) return;
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== password2)  { setError("Passwords do not match"); return; }
    setError(null);

    try {
      const encrypted = await exportBeneficiaryIdentity(identityRef.current, password);
      const blob      = new Blob([encrypted], { type: "application/json" });
      const url       = URL.createObjectURL(blob);
      const a         = document.createElement("a");
      a.href          = url;
      a.download      = "legacy-beneficiary-key.json";
      a.click();
      URL.revokeObjectURL(url);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup export failed — try again");
    }
  }

  function handleCopyPublicKey() {
    if (!publicKeyHex) return;
    navigator.clipboard.writeText(publicKeyHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === "generate") {
    return (
      <div className="card space-y-5">
        <div>
          <h2 className="font-display text-xl text-cream mb-1">Generate Beneficiary Identity</h2>
          <p className="text-stone-400 text-sm">
            Your private inheritance key is generated entirely in this browser.
            It never leaves your device unencrypted.
          </p>
        </div>

        <div
          className="rounded-lg p-4 space-y-2 text-sm"
          style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}
        >
          <p className="text-emerald-400 font-medium">What this generates:</p>
          <ul className="text-stone-400 space-y-1 list-disc pl-4">
            <li>A private key — controls your ability to claim the inheritance</li>
            <li>A public key — stored on-chain (32 bytes, not a Solana address)</li>
            <li>A viewing key — lets you scan for incoming shielded transfers</li>
          </ul>
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button
          className="btn-primary w-full"
          onClick={handleGenerate}
          disabled={generating}
          aria-label="Generate private beneficiary identity key"
        >
          {generating ? "Generating…" : "Generate Private Identity"}
        </button>
      </div>
    );
  }

  if (step === "backup") {
    return (
      <div className="card space-y-5">
        <div>
          <h2 className="font-display text-xl text-cream mb-1">Back Up Your Inheritance Key</h2>
          <p className="text-stone-400 text-sm">
            Your private inheritance key has been generated. Back it up now.
          </p>
        </div>

        <div
          className="rounded-lg p-3"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          <p className="text-red-400 text-sm font-medium">
            ⚠ If you lose this key, you cannot claim your inheritance. There is no recovery.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label mb-1 block">Your Public Key (goes on-chain)</label>
            <div
              className="rounded-lg p-2 flex items-center gap-2"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
            >
              <span className="address text-xs flex-1 break-all">{publicKeyHex}</span>
              <button
                className="btn-secondary text-xs px-2 py-1 flex-shrink-0"
                onClick={handleCopyPublicKey}
                aria-label="Copy public key to clipboard"
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div>
            <label className="label mb-1 block">Backup Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              placeholder="Strong password (8+ characters)"
              className="input w-full"
              aria-label="Password for encrypted backup"
            />
          </div>
          <div>
            <label className="label mb-1 block">Confirm Password</label>
            <input
              type="password"
              value={password2}
              onChange={(e) => { setPassword2(e.target.value); setError(null); }}
              placeholder="Confirm password"
              className="input w-full"
              aria-label="Confirm backup password"
            />
          </div>
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button
          className="btn-primary w-full"
          onClick={() => void handleDownloadBackup()}
          aria-label="Download encrypted backup of beneficiary key"
        >
          Download Encrypted Backup
        </button>
      </div>
    );
  }

  // step === "confirm"
  return (
    <div className="card space-y-5">
      <h2 className="font-display text-xl text-cream">Confirm Backup</h2>
      <p className="text-stone-400 text-sm">
        Before we proceed, confirm that you have safely stored your backup file.
      </p>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded"
          aria-label="Confirm backup is stored"
        />
        <span className="text-stone-300 text-sm">
          I have securely backed up my inheritance key. I understand that losing it
          means I cannot claim my inheritance.
        </span>
      </label>

      <div
        className="rounded-lg p-3 text-xs"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
      >
        <p className="text-stone-400 mb-1">Your public key (stored on-chain):</p>
        <p className="address break-all">{publicKeyHex}</p>
      </div>

      <button
        className="btn-primary w-full"
        onClick={() => { if (publicKeyHex) onComplete(publicKeyHex); }}
        disabled={!confirmed || !publicKeyHex}
        aria-label="Confirm and proceed with vault creation"
      >
        Confirm — Use This Identity
      </button>
    </div>
  );
}

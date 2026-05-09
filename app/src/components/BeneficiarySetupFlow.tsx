"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  generateBeneficiaryIdentity,
  exportBeneficiaryIdentity,
  importBeneficiaryIdentity,
} from "@legacy-protocol/cloak-integration";
import { utxoPubkeyToHex } from "@legacy-protocol/sdk";
import { isRestrictedInAppBrowser, canShareFiles } from "@/lib/browser-env";
import type { UtxoIdentity } from "@legacy-protocol/cloak-integration";

interface Props {
  /** Called with the hex-encoded UTXO public key once the beneficiary confirms backup. */
  onComplete: (beneficiaryUtxoPubkeyHex: string) => void;
}

type Step = "generate" | "backup" | "confirm";

export function BeneficiarySetupFlow({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("generate");

  // The private key lives in a ref — NOT state — so the bytes never appear
  // in the React state tree, DevTools snapshots, or memory dumps.
  // hasIdentity is the boolean that drives conditional renders.
  const identityRef = useRef<UtxoIdentity | null>(null);
  const [hasIdentity, setHasIdentity] = useState(false);

  const [password,      setPassword]      = useState("");
  const [password2,     setPassword2]     = useState("");
  const [showPassword,  setShowPassword]  = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);

  const [copied, setCopied] = useState(false);

  // When true the backup was delivered via clipboard rather than share sheet
  // or anchor download. The confirm step then requires paste-to-verify.
  const [clipboardPath, setClipboardPath] = useState(false);
  const [copiedBackup,  setCopiedBackup]  = useState(false);

  // encryptedJson holds AES-256-GCM ciphertext — no private key material,
  // safe to keep in state.
  const [encryptedJson, setEncryptedJson] = useState<string | null>(null);

  // Paste-to-verify state used on the confirm step when clipboardPath is true.
  const [pastedJson,   setPastedJson]   = useState("");
  const [verifyPassed, setVerifyPassed] = useState(false);
  const [verifying,    setVerifying]    = useState(false);
  const [verifyError,  setVerifyError]  = useState<string | null>(null);

  const [confirmed,  setConfirmed]  = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Zero and release the private key on unmount so the raw bytes cannot be
  // recovered from freed memory after this component leaves the tree.
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

  // Derived from the ref so no key material ever enters the state tree.
  const publicKeyHex =
    hasIdentity && identityRef.current
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

  async function handleSaveBackup() {
    if (!identityRef.current) return;
    if (password.length < 8)    { setError("Password must be at least 8 characters"); return; }
    if (password !== password2) { setError("Passwords do not match"); return; }
    setError(null);
    setSaving(true);

    try {
      const encrypted = await exportBeneficiaryIdentity(identityRef.current, password);
      setEncryptedJson(encrypted);

      const file = new File(
        [encrypted],
        "legacy-beneficiary-key.json",
        { type: "application/json" },
      );

      // Phantom and other wallet-embedded browsers block both the share sheet
      // and programmatic anchor downloads. When we detect one of those
      // environments we skip straight to clipboard — the only path that works.
      if (isRestrictedInAppBrowser()) {
        await navigator.clipboard.writeText(encrypted);
        setCopiedBackup(true);
        setClipboardPath(true);
        return;
      }

      // On capable mobile browsers the Web Share API hands the file to the
      // OS share sheet so the user can save to Files, Drive, or any app.
      // This is the highest-fidelity mobile delivery — the user ends up with
      // a real file. On success we go straight to confirm.
      if (canShareFiles()) {
        try {
          await navigator.share({ files: [file], title: "Legacy Protocol Backup" });
          setStep("confirm");
          return;
        } catch (shareErr) {
          if (shareErr instanceof Error && shareErr.name === "AbortError") {
            setError("Backup not saved — please try again and choose a save destination.");
            return;
          }
          // Non-abort share failure falls through to the anchor download below.
        }
      }

      // Desktop fallback: programmatic anchor download. The user receives a
      // real file so we advance directly to confirm without clipboard detour.
      const url = URL.createObjectURL(new Blob([encrypted], { type: "application/json" }));
      const a         = document.createElement("a");
      a.href          = url;
      a.download      = "legacy-beneficiary-key.json";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStep("confirm");

    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup export failed — try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyBackupAgain() {
    if (!encryptedJson) return;
    try {
      await navigator.clipboard.writeText(encryptedJson);
      setCopiedBackup(true);
      setTimeout(() => setCopiedBackup(false), 2000);
    } catch {
      setError("Clipboard copy failed — select all text above and copy manually.");
    }
  }

  // Verifies that the pasted backup JSON decrypts correctly with the password
  // set during backup, and that the recovered public key matches the one
  // generated in this session. Both must hold before confirm is enabled.
  async function handleVerify() {
    if (!pastedJson.trim()) { setVerifyError("Paste your backup JSON to verify"); return; }
    setVerifyError(null);
    setVerifying(true);
    try {
      const restored    = await importBeneficiaryIdentity(pastedJson.trim(), password);
      const restoredHex = utxoPubkeyToHex(restored.publicKey);
      // Only the public key is needed for the comparison — zero the private
      // key immediately so it does not linger in memory.
      restored.privateKey.fill(0);
      if (restoredHex !== publicKeyHex) {
        setVerifyError(
          "Public key mismatch — make sure you pasted the correct backup and used the same password.",
        );
        return;
      }
      setVerifyPassed(true);
    } catch (err) {
      setVerifyError(
        err instanceof Error
          ? err.message
          : "Verification failed — check that you pasted the correct backup and entered the same password.",
      );
    } finally {
      setVerifying(false);
    }
  }

  function handleCopyPublicKey() {
    if (!publicKeyHex) return;
    navigator.clipboard.writeText(publicKeyHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Generate step ──────────────────────────────────────────────────────────

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

  // ── Backup step — clipboard panel ──────────────────────────────────────────
  // Shown when the backup was delivered via clipboard (restricted browser or
  // share/download unavailable). The user must confirm they have saved the
  // backup before the Continue button appears.

  if (step === "backup" && clipboardPath && encryptedJson) {
    return (
      <div className="card space-y-5">
        <div>
          <h2 className="font-display text-xl text-cream mb-1">Save Your Backup</h2>
          <p className="text-stone-400 text-sm">
            Your encrypted backup has been copied to your clipboard. Paste it into
            Notes, Google Drive, WhatsApp Saved Messages, or any secure location
            before continuing.
          </p>
        </div>

        <div
          className="rounded-lg p-3 space-y-2"
          style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}
        >
          <p className="text-emerald-400 text-xs font-medium uppercase tracking-wide">
            Your encrypted backup
          </p>
          <textarea
            readOnly
            value={encryptedJson}
            rows={6}
            className="input w-full text-xs font-mono resize-none"
            aria-label="Encrypted backup JSON — read only"
          />
          <button
            type="button"
            className="btn-secondary text-xs px-3 py-1"
            onClick={() => void handleCopyBackupAgain()}
            aria-label="Copy encrypted backup to clipboard again"
          >
            {copiedBackup ? "✓ Copied" : "Copy Again"}
          </button>
        </div>

        <div
          className="rounded-lg p-3"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          <p className="text-red-400 text-sm font-medium">
            ⚠ Do not continue until you have pasted and saved this backup somewhere safe.
            Without it you cannot claim your inheritance.
          </p>
        </div>

        <button
          className="btn-primary w-full"
          onClick={() => setStep("confirm")}
          aria-label="Proceed to verify and confirm backup"
        >
          I Have Saved My Backup — Continue
        </button>
      </div>
    );
  }

  // ── Backup step — password form ────────────────────────────────────────────

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
                type="button"
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
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="Strong password (8+ characters)"
                className="input w-full pr-16"
                aria-label="Password for encrypted backup"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 hover:text-stone-200 transition-colors"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="label mb-1 block">Confirm Password</label>
            <div className="relative">
              <input
                type={showPassword2 ? "text" : "password"}
                value={password2}
                onChange={(e) => { setPassword2(e.target.value); setError(null); }}
                placeholder="Confirm password"
                className="input w-full pr-16"
                aria-label="Confirm backup password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 hover:text-stone-200 transition-colors"
                onClick={() => setShowPassword2((v) => !v)}
                aria-label={showPassword2 ? "Hide confirm password" : "Show confirm password"}
              >
                {showPassword2 ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button
          className="btn-primary w-full"
          onClick={() => void handleSaveBackup()}
          disabled={saving}
          aria-label="Save encrypted backup of beneficiary key"
        >
          {saving ? "Saving…" : "Save Backup File"}
        </button>
      </div>
    );
  }

  // ── Confirm step ───────────────────────────────────────────────────────────
  // clipboard path → paste-to-verify required before confirm is enabled.
  // share / download path → checkbox confirmation only, no paste needed.

  return (
    <div className="card space-y-5">
      <h2 className="font-display text-xl text-cream">Confirm Backup</h2>
      <p className="text-stone-400 text-sm">
        Before we proceed, confirm that you have safely stored your backup.
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

      {clipboardPath && (
        <div className="space-y-2">
          <label className="label mb-1 block">Paste Your Backup to Verify</label>
          <p className="text-stone-400 text-xs">
            Paste the backup you copied so we can confirm it decrypts correctly
            with your password before proceeding.
          </p>
          <textarea
            value={pastedJson}
            onChange={(e) => {
              setPastedJson(e.target.value);
              setVerifyError(null);
              setVerifyPassed(false);
            }}
            placeholder='Paste your backup JSON here (starts with {"version":1,...})'
            rows={5}
            className="input w-full text-xs font-mono resize-none"
            aria-label="Paste backup JSON for verification"
          />
          {verifyError && (
            <p role="alert" className="text-red-400 text-sm">{verifyError}</p>
          )}
          {verifyPassed && (
            <p className="text-emerald-400 text-sm font-medium">
              ✓ Backup verified — your key decrypts correctly.
            </p>
          )}
          <button
            type="button"
            className="btn-secondary w-full text-sm"
            onClick={() => void handleVerify()}
            disabled={verifying || !pastedJson.trim() || verifyPassed}
            aria-label="Verify backup decrypts correctly"
          >
            {verifying ? "Verifying…" : verifyPassed ? "✓ Verified" : "Verify Backup"}
          </button>
        </div>
      )}

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
        disabled={
          !confirmed ||
          !publicKeyHex ||
          (clipboardPath && !verifyPassed)
        }
        aria-label="Confirm and proceed with vault creation"
      >
        Confirm — Use This Identity
      </button>
    </div>
  );
}

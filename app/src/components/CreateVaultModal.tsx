"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useRouter } from "next/navigation";
import {
  buildInitializeVaultIx,
  deriveVaultPda,
  deriveActivityPda,
  MIN_INACTIVITY_THRESHOLD_SLOTS,
  MAX_INACTIVITY_THRESHOLD_SLOTS,
  sendAndConfirmLegacyTx,
  hexToUtxoPubkey,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { formatSlotDays } from "@/lib/format";
import { useToast } from "@/components/ToastProvider";
import { BeneficiarySetupFlow } from "./BeneficiarySetupFlow";

interface CreateVaultModalProps {
  open:      boolean;
  onClose:   () => void;
  onCreated: (vaultAddress: string) => void;
}

const DEFAULT_THRESHOLD_DAYS = 29;
const SLOTS_PER_DAY = 86400 * 2;

function daysToSlots(days: number): bigint {
  return BigInt(Math.round(days * SLOTS_PER_DAY));
}

type FlowStep = "configure" | "beneficiary-setup" | "creating";

export function CreateVaultModal({ open, onClose, onCreated }: CreateVaultModalProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { addToast } = useToast();
  const router = useRouter();

  const [flowStep,         setFlowStep]         = useState<FlowStep>("configure");
  // thresholdInput holds the raw string value of the input field so the user
  // can freely clear it or type partial numbers without the field snapping back.
  // thresholdDays is only updated when the parsed integer is valid (not NaN).
  const [thresholdInput,   setThresholdInput]   = useState(String(DEFAULT_THRESHOLD_DAYS));
  const [thresholdDays,    setThresholdDays]     = useState(DEFAULT_THRESHOLD_DAYS);
  const [thresholdError,   setThresholdError]    = useState<string | null>(null);
  const [vaultIndex,       setVaultIndex]        = useState(0);
  const [overrideIndex,    setOverrideIndex]     = useState(false);
  const [beneficiaryHex,   setBeneficiaryHex]    = useState<string | null>(null);
  const [shielded,         setShielded]          = useState(true);

  const [plainBeneficiary, setPlainBeneficiary]  = useState("");
  const [beneficiaryError, setBeneficiaryError]  = useState<string | null>(null);

  const overlayRef    = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFlowStep("configure");
      setBeneficiaryHex(null);
      setPlainBeneficiary("");
      setThresholdInput(String(DEFAULT_THRESHOLD_DAYS));
      setThresholdDays(DEFAULT_THRESHOLD_DAYS);
      setThresholdError(null);
      return;
    }
    setTimeout(() => firstInputRef.current?.focus(), 50);

    if (!publicKey) return;
    connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: 168 },
        { memcmp: { offset: 8, bytes: publicKey.toBase58() } },
      ],
    }).then((accounts) => {
      setVaultIndex(accounts.length);
    }).catch(() => setVaultIndex(0));
  }, [open, publicKey, connection]);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function validateThreshold(days: number): boolean {
    const slots = daysToSlots(days);
    if (slots < MIN_INACTIVITY_THRESHOLD_SLOTS) {
      setThresholdError(`Minimum is ${formatSlotDays(MIN_INACTIVITY_THRESHOLD_SLOTS)}.`);
      return false;
    }
    if (slots > MAX_INACTIVITY_THRESHOLD_SLOTS) {
      setThresholdError(`Maximum is ${formatSlotDays(MAX_INACTIVITY_THRESHOLD_SLOTS)}.`);
      return false;
    }
    setThresholdError(null);
    return true;
  }

  function validateBeneficiary(val: string): boolean {
    if (!val.trim()) { setBeneficiaryError("Required."); return false; }
    try { new PublicKey(val.trim()); setBeneficiaryError(null); return true; }
    catch { setBeneficiaryError("Invalid Solana address."); return false; }
  }

  /**
   * Handle raw text change for the threshold field.
   * Only updates thresholdDays when parseInt succeeds (not NaN).
   * The raw string is always mirrored to thresholdInput so the user can
   * clear the field or type "1" without the value snapping to the default.
   */
  function handleThresholdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setThresholdInput(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n)) {
      setThresholdDays(n);
      // Clear any stale error while the user is actively editing.
      setThresholdError(null);
    }
  }

  /**
   * On blur: if the field was left empty or with a non-numeric value, restore
   * to DEFAULT_THRESHOLD_DAYS so thresholdInput and thresholdDays stay in sync.
   * Then validate the resolved value.
   */
  function handleThresholdBlur() {
    const n = parseInt(thresholdInput, 10);
    const resolved = isNaN(n) ? DEFAULT_THRESHOLD_DAYS : n;
    if (isNaN(n)) {
      setThresholdInput(String(DEFAULT_THRESHOLD_DAYS));
      setThresholdDays(DEFAULT_THRESHOLD_DAYS);
    }
    validateThreshold(resolved);
  }

  /**
   * handleContinueToBeneficiary: synchronous form submit handler.
   *
   * When the non-shielded path calls handleCreate(null), the returned Promise
   * must be explicitly .catch()ed — not left floating — because handleCreate's
   * try/catch only covers the inner async body; errors thrown before the try
   * block (e.g. from hexToUtxoPubkey) would otherwise cause an unhandled
   * rejection.
   */
  function handleContinueToBeneficiary(e: React.FormEvent) {
    e.preventDefault();
    if (!validateThreshold(thresholdDays)) return;
    if (!shielded && !validateBeneficiary(plainBeneficiary)) return;
    if (shielded) {
      setFlowStep("beneficiary-setup");
    } else {
      handleCreate(null).catch((err) => {
        addToast({
          type:     "error",
          title:    "Vault creation failed",
          message:  err instanceof Error ? err.message : "Transaction failed",
          duration: 8000,
        });
      });
    }
  }

  const handleCreate = useCallback(async (utxoPubkeyHexOverride: string | null) => {
    if (!publicKey || !signTransaction) return;

    const resolvedHex = utxoPubkeyHexOverride ?? beneficiaryHex;

    let beneficiaryUtxoPubkey: Uint8Array;
    if (resolvedHex) {
      beneficiaryUtxoPubkey = hexToUtxoPubkey(resolvedHex);
    } else if (plainBeneficiary.trim()) {
      beneficiaryUtxoPubkey = new PublicKey(plainBeneficiary.trim()).toBytes();
    } else {
      return;
    }

    const slots = daysToSlots(thresholdDays);
    const idx   = BigInt(vaultIndex);

    setFlowStep("creating");

    try {
      const [vaultPda]    = deriveVaultPda(PROGRAM_ID, publicKey, idx);
      const [activityPda] = deriveActivityPda(PROGRAM_ID, vaultPda);

      const ix = buildInitializeVaultIx({
        programId:                PROGRAM_ID,
        owner:                    publicKey,
        vaultPda,
        activityPda,
        vaultIndex:               idx,
        inactivityThresholdSlots: slots,
        beneficiaryUtxoPubkey,
      });

      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );

      const vaultAddress = vaultPda.toBase58();

      addToast({
        type:     "success",
        title:    "Vault created",
        message:  `Vault #${vaultIndex} initialised successfully.`,
        txSig:    result.signature,
        duration: 8000,
      });

      onCreated(vaultAddress);
      onClose();
      router.push(`/vault/${vaultAddress}`);
    } catch (err) {
      setFlowStep(shielded ? "beneficiary-setup" : "configure");
      addToast({
        type:     "error",
        title:    "Vault creation failed",
        message:  err instanceof Error ? err.message : "Transaction failed",
        duration: 8000,
      });
      // Re-throw so callers using .catch() (e.g. handleContinueToBeneficiary
      // on the non-shielded path) can surface the error correctly.
      throw err;
    }
  }, [
    publicKey, signTransaction, beneficiaryHex, plainBeneficiary,
    thresholdDays, vaultIndex, connection, shielded, addToast, onCreated, onClose, router,
  ]);

  if (!open) return null;

  const minDays = Math.ceil(Number(MIN_INACTIVITY_THRESHOLD_SLOTS) / SLOTS_PER_DAY);
  const maxDays = Math.floor(Number(MAX_INACTIVITY_THRESHOLD_SLOTS) / SLOTS_PER_DAY);

  // ── Beneficiary setup flow (shielded) ─────────────────────────────────────
  if (flowStep === "beneficiary-setup") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(12,10,9,0.85)", backdropFilter: "blur(4px)" }} aria-hidden="true" />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="beneficiary-setup-title"
          style={{ position: "relative", width: "100%", maxWidth: 480, maxHeight: "90dvh", overflowY: "auto", zIndex: 1 }}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <button className="text-stone-400 text-sm hover:text-cream" onClick={() => setFlowStep("configure")}>← Back</button>
            <button onClick={onClose} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: 20 }}>✕</button>
          </div>
          <BeneficiarySetupFlow
            onComplete={(hexKey) => {
              setBeneficiaryHex(hexKey);
              handleCreate(hexKey).catch((err) => {
                addToast({
                  type:     "error",
                  title:    "Vault creation failed",
                  message:  err instanceof Error ? err.message : "Transaction failed",
                  duration: 8000,
                });
              });
            }}
          />
        </div>
      </div>
    );
  }

  // ── Creating spinner ──────────────────────────────────────────────────────
  if (flowStep === "creating") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(12,10,9,0.85)", backdropFilter: "blur(4px)" }} aria-hidden="true" />
        <div className="card" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 480 }}>
          <div className="flex items-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-cream border-t-transparent rounded-full" />
            <span className="text-stone-300">Creating vault…</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Configure step ────────────────────────────────────────────────────────
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(12,10,9,0.85)", backdropFilter: "blur(4px)" }} aria-hidden="true" />

      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-vault-title"
        className="card animate-slide-up"
        style={{ position: "relative", width: "100%", maxWidth: 480, maxHeight: "90dvh", overflowY: "auto", zIndex: 1 }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 id="create-vault-title" className="font-display text-2xl text-cream">Create Vault</h2>
          <button onClick={onClose} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: 22, padding: "4px 8px" }}>✕</button>
        </div>

        <form onSubmit={handleContinueToBeneficiary} className="space-y-5" noValidate>

          {/* Shielded vs plain toggle */}
          <div>
            <label className="label block mb-2">Vault Mode</label>
            <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <button
                type="button"
                className="flex-1 py-2 text-sm"
                style={{
                  background: shielded ? "rgba(16,185,129,0.15)" : "transparent",
                  color:      shielded ? "var(--zone-green)"     : "var(--text-muted)",
                  borderRight: "1px solid var(--border)",
                }}
                onClick={() => setShielded(true)}
              >
                🔒 Shielded (Cloak)
              </button>
              <button
                type="button"
                className="flex-1 py-2 text-sm"
                style={{
                  background: !shielded ? "rgba(255,255,255,0.07)" : "transparent",
                  color:      !shielded ? "var(--text-primary)"    : "var(--text-muted)",
                }}
                onClick={() => setShielded(false)}
              >
                Standard
              </button>
            </div>
            <p className="text-stone-600 text-xs mt-1">
              {shielded
                ? "Balance and beneficiary are private. Cloak ZK proofs on every transfer."
                : "Balance and beneficiary visible on block explorers (legacy mode)."}
            </p>
          </div>

          {/* Plain beneficiary — only shown for standard vaults */}
          {!shielded && (
            <div>
              <label htmlFor="cv-beneficiary" className="label block mb-2">Beneficiary Address</label>
              <input
                ref={firstInputRef}
                id="cv-beneficiary"
                type="text"
                className={`input mono${beneficiaryError ? " border-red-500" : ""}`}
                placeholder="Solana wallet address (base58)"
                value={plainBeneficiary}
                onChange={(e) => setPlainBeneficiary(e.target.value)}
                onBlur={() => validateBeneficiary(plainBeneficiary)}
                autoComplete="off"
                spellCheck={false}
                required={!shielded}
              />
              {beneficiaryError && <p role="alert" className="text-red-400 text-xs mt-1">{beneficiaryError}</p>}
            </div>
          )}

          {/* Inactivity threshold */}
          <div>
            <label htmlFor="cv-threshold" className="label block mb-2">Inactivity Threshold (days)</label>
            <p className="text-stone-500 text-xs mb-2">Min: {minDays} days · Max: {maxDays} days.</p>
            <input
              ref={shielded ? firstInputRef : undefined}
              id="cv-threshold"
              type="number"
              step="1"
              min={minDays}
              max={maxDays}
              className={`input${thresholdError ? " border-red-500" : ""}`}
              value={thresholdInput}
              onChange={handleThresholdChange}
              onBlur={handleThresholdBlur}
              required
            />
            <p className="text-stone-600 text-xs mt-1">≈ {daysToSlots(thresholdDays).toLocaleString()} slots</p>
            {thresholdError && <p role="alert" className="text-red-400 text-xs mt-1">{thresholdError}</p>}
          </div>

          {/* Vault index */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="cv-vault-index" className="label">Vault Index</label>
              {!overrideIndex && (
                <button type="button" className="text-stone-400 text-xs hover:text-cream" onClick={() => setOverrideIndex(true)}>Change</button>
              )}
            </div>
            {overrideIndex ? (
              <input
                id="cv-vault-index"
                type="number"
                step="1"
                min="0"
                className="input"
                value={vaultIndex}
                onChange={(e) => setVaultIndex(parseInt(e.target.value, 10) || 0)}
              />
            ) : (
              <div
                id="cv-vault-index"
                className="input flex items-center"
                style={{ background: "rgba(255,255,255,0.02)", color: "var(--text-secondary)" }}
              >
                {vaultIndex}
                <span className="text-stone-600 text-xs ml-2">(auto-detected)</span>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={!publicKey}>
              {shielded ? "Continue →" : "Create Vault"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

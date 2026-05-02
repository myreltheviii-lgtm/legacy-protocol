// app/src/components/CovenantFlow.tsx
//
// Multi-step covenant creation and signing interface for guardians.
//
// Level 2 optimistic updates: after a guardian signs a covenant, the signer
// list grows immediately and the threshold-reached badge flips without waiting
// for confirmation. After creation, the new covenant row appears immediately.
// Both patches are reverted on error and reconciled on success.

"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  buildCreateCovenantIx,
  buildGuardianSignIx,
  buildExecuteCovenantIx,
  deriveGuardianPda,
  deriveCovenantPda,
  CovenantType,
  sendAndConfirmLegacyTx,
  CovenantAccount,
  BENEFICIARY_CHANGE_TIMELOCK_SLOTS,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { shortAddress, explorerTxUrl, formatSlotDays } from "@/lib/format";
import type { GuardianWithAddress } from "@/hooks/useGuardians";

interface CovenantFlowProps {
  vaultPda:        string;
  vaultOwner:      string;
  covenantCounter: bigint;
  mOfNThreshold:   number;
  guardianCount:   number;
  openCovenants:   Array<{ publicKey: string; account: CovenantAccount }>;
  guardians:       GuardianWithAddress[];
  onRefresh:       () => Promise<void>;
}

type Step = "select-type" | "enter-target" | "confirm";

export function CovenantFlow({
  vaultPda, vaultOwner, covenantCounter, mOfNThreshold,
  guardianCount, openCovenants, guardians, onRefresh,
}: CovenantFlowProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [step,        setStep]        = useState<Step>("select-type");
  const [covenantType, setCovenantType] = useState<CovenantType | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [creating,    setCreating]    = useState(false);
  const [signing,     setSigning]     = useState<string | null>(null);
  const [executing,   setExecuting]   = useState<string | null>(null);
  const [lastTx,      setLastTx]      = useState<string | null>(null);
  const [txError,     setTxError]     = useState<string | null>(null);

  // Optimistic overlay for the signing queue. Null = use live openCovenants prop.
  const [optimisticCovenants, setOptimisticCovenants] =
    useState<Array<{ publicKey: string; account: CovenantAccount }> | null>(null);

  const displayCovenants = optimisticCovenants ?? openCovenants;

  function clearOptimistic() {
    setOptimisticCovenants(null);
  }

  const isGuardian = guardians.some(
    (g) => g.account.guardian === publicKey?.toBase58(),
  );

  const myGuardianAccount = guardians.find(
    (g) => g.account.guardian === publicKey?.toBase58(),
  );

  const COVENANT_TYPE_INFO: Record<CovenantType, {
    label: string; description: string; needsTarget: boolean; targetLabel: string;
  }> = {
    [CovenantType.EmergencySweep]: {
      label:       "Emergency Sweep",
      description: "Immediately drain vault funds to beneficiary. Use when the owner's wallet is actively compromised.",
      needsTarget: false,
      targetLabel: "",
    },
    [CovenantType.BeneficiaryChange]: {
      label:       "Change Beneficiary",
      description: `Replace the current beneficiary. Requires ${mOfNThreshold}-of-${guardianCount} signatures + ${formatSlotDays(BENEFICIARY_CHANGE_TIMELOCK_SLOTS)} timelock.`,
      needsTarget: true,
      targetLabel: "New beneficiary wallet address",
    },
    [CovenantType.GuardianRemoval]: {
      label:       "Remove Guardian",
      description: "Remove a compromised guardian without owner signature. Immediate upon M-of-N.",
      needsTarget: true,
      targetLabel: "Guardian wallet address to remove",
    },
  };

  function reset() {
    setStep("select-type");
    setCovenantType(null);
    setTargetInput("");
    setTxError(null);
    setLastTx(null);
  }

  async function handleCreate() {
    if (!publicKey || !signTransaction || covenantType === null || !myGuardianAccount) return;

    const vaultPk    = new PublicKey(vaultPda);
    const guardianPk = publicKey;
    const [gaPda]    = deriveGuardianPda(PROGRAM_ID, vaultPk, guardianPk);
    const info       = COVENANT_TYPE_INFO[covenantType];
    let targetPk     = new PublicKey("11111111111111111111111111111111");

    if (info.needsTarget) {
      try {
        targetPk = new PublicKey(targetInput.trim());
      } catch {
        setTxError("Invalid target address");
        return;
      }
    }

    setCreating(true);
    setTxError(null);

    // Optimistic: prepend the new covenant immediately with the creator's
    // pubkey as the sole signer.
    const [covenantPdaKey] = deriveCovenantPda(PROGRAM_ID, vaultPk, covenantCounter);
    const optimisticCovenant: { publicKey: string; account: CovenantAccount } = {
      publicKey: covenantPdaKey.toBase58(),
      account: {
        vault:                  vaultPda,
        covenantType,
        target:                 targetPk.toBase58(),
        signers:                [guardianPk.toBase58()],
        requiredSignatures:     mOfNThreshold,
        createdSlot:            0n,
        timelockSlots:          0n,
        signaturesCompleteSlot: mOfNThreshold === 1 ? 1n : 0n,
        covenantIndex:          covenantCounter,
        isExecuted:             false,
        bump:                   0,
      } as CovenantAccount,
    };
    setOptimisticCovenants([optimisticCovenant, ...openCovenants]);

    try {
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildCreateCovenantIx({
          programId:         PROGRAM_ID,
          guardian:          guardianPk,
          vaultPda:          vaultPk,
          guardianAccountPda: gaPda,
          covenantIndex:     covenantCounter,
          covenantType,
          target:            targetPk,
        })],
      );
      setLastTx(result.signature);
      clearOptimistic();
      await onRefresh();
      reset();
    } catch (err) {
      clearOptimistic();
      setTxError(err instanceof Error ? err.message : "Create covenant failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleSign(covenantPdaStr: string) {
    if (!publicKey || !signTransaction || !myGuardianAccount) return;

    setSigning(covenantPdaStr);
    setTxError(null);

    // Optimistic: add this guardian to the covenant's signer list immediately.
    const guardianB58 = publicKey.toBase58();
    setOptimisticCovenants(
      openCovenants.map((c) => {
        if (c.publicKey !== covenantPdaStr) return c;
        const newSigners = [...c.account.signers, guardianB58];
        const thresholdMet = newSigners.length >= c.account.requiredSignatures;
        return {
          ...c,
          account: {
            ...c.account,
            signers:                newSigners,
            signaturesCompleteSlot: thresholdMet && c.account.signaturesCompleteSlot === 0n
              ? 1n
              : c.account.signaturesCompleteSlot,
          },
        };
      }),
    );

    try {
      const vaultPk    = new PublicKey(vaultPda);
      const [gaPda]    = deriveGuardianPda(PROGRAM_ID, vaultPk, publicKey);
      const covenantPk = new PublicKey(covenantPdaStr);

      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildGuardianSignIx({
          programId:         PROGRAM_ID,
          guardian:          publicKey,
          vaultPda:          vaultPk,
          guardianAccountPda: gaPda,
          covenantPda:       covenantPk,
        })],
      );
      setLastTx(result.signature);
      clearOptimistic();
      await onRefresh();
    } catch (err) {
      clearOptimistic();
      setTxError(err instanceof Error ? err.message : "Sign failed");
    } finally {
      setSigning(null);
    }
  }

  async function handleExecute(covenant: { publicKey: string; account: CovenantAccount }) {
    if (!publicKey || !signTransaction) return;

    setExecuting(covenant.publicKey);
    setTxError(null);

    // Optimistic: remove the covenant from the queue immediately.
    setOptimisticCovenants(openCovenants.filter((c) => c.publicKey !== covenant.publicKey));

    try {
      const vaultPk    = new PublicKey(vaultPda);
      const covenantPk = new PublicKey(covenant.publicKey);
      let targetGuardianPda: PublicKey | undefined;

      if (covenant.account.covenantType === CovenantType.GuardianRemoval) {
        const [tgPda] = deriveGuardianPda(
          PROGRAM_ID, vaultPk, new PublicKey(covenant.account.target),
        );
        targetGuardianPda = tgPda;
      }

      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildExecuteCovenantIx({
          programId:        PROGRAM_ID,
          caller:           publicKey,
          vaultPda:         vaultPk,
          covenantPda:      covenantPk,
          targetGuardianPda,
        })],
      );
      setLastTx(result.signature);
      clearOptimistic();
      await onRefresh();
    } catch (err) {
      clearOptimistic();
      setTxError(err instanceof Error ? err.message : "Execute failed");
    } finally {
      setExecuting(null);
    }
  }

  function covenantTypeLabel(ct: CovenantType): string {
    return COVENANT_TYPE_INFO[ct].label;
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {displayCovenants.length > 0 && (
        <section aria-label="Open covenants awaiting signatures">
          <div className="card">
            <h2 className="font-display text-xl text-cream mb-4">Signing Queue</h2>
            <div className="space-y-4">
              {displayCovenants.map((c) => {
                const info         = COVENANT_TYPE_INFO[c.account.covenantType];
                const hasSigned    = publicKey && c.account.signers.includes(publicKey.toBase58());
                const thresholdMet = c.account.signers.length >= c.account.requiredSignatures;

                return (
                  <article
                    key={c.publicKey}
                    className="rounded-lg p-4"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                    aria-label={`${info.label} covenant, ${c.account.signers.length} of ${c.account.requiredSignatures} signatures`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-cream">
                            {covenantTypeLabel(c.account.covenantType)}
                          </span>
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{
                              background: thresholdMet ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)",
                              color:      thresholdMet ? "var(--zone-green)"     : "var(--accent)",
                            }}
                          >
                            {thresholdMet
                              ? "✓ Threshold met"
                              : `${c.account.signers.length}/${c.account.requiredSignatures} signed`}
                          </span>
                        </div>
                        {c.account.target !== "11111111111111111111111111111111" && (
                          <p className="address text-xs mt-1">
                            Target: {shortAddress(c.account.target, 6)}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-2" aria-label="Signers">
                          {c.account.signers.map((s) => (
                            <span
                              key={s}
                              className="text-xs px-1.5 py-0.5 rounded mono"
                              style={{ background: "rgba(16,185,129,0.1)", color: "var(--zone-green)" }}
                              title={s}
                            >
                              {shortAddress(s)}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 flex-shrink-0">
                        {isGuardian && !hasSigned && !c.account.isExecuted && (
                          <button
                            className="btn-primary text-sm px-3 py-2"
                            onClick={() => handleSign(c.publicKey)}
                            disabled={signing === c.publicKey}
                            aria-label={`Sign ${info.label} covenant`}
                          >
                            {signing === c.publicKey ? "…" : "Sign"}
                          </button>
                        )}
                        {thresholdMet && !c.account.isExecuted &&
                          c.account.covenantType !== CovenantType.EmergencySweep && (
                          <button
                            className="btn-secondary text-sm px-3 py-2"
                            onClick={() => handleExecute(c)}
                            disabled={executing === c.publicKey}
                            aria-label={`Execute ${info.label} covenant`}
                          >
                            {executing === c.publicKey ? "…" : "Execute"}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {isGuardian && (
        <section aria-label="Create new covenant">
          <div className="card">
            <h2 className="font-display text-xl text-cream mb-4">Create Covenant</h2>

            {step === "select-type" && (
              <fieldset>
                <legend className="label mb-3">Select covenant type</legend>
                <div className="space-y-3">
                  {(Object.entries(COVENANT_TYPE_INFO) as Array<[string, typeof COVENANT_TYPE_INFO[0]]>).map(
                    ([ct, info]) => (
                      <label
                        key={ct}
                        className="flex items-start gap-3 p-3 rounded-lg cursor-pointer"
                        style={{
                          border: `1px solid ${covenantType === Number(ct) ? "var(--accent)" : "var(--border)"}`,
                          background: covenantType === Number(ct) ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.02)",
                          transition: "border-color 0.15s",
                        }}
                      >
                        <input
                          type="radio"
                          name="covenant-type"
                          value={ct}
                          checked={covenantType === Number(ct)}
                          onChange={() => setCovenantType(Number(ct) as CovenantType)}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm font-medium text-cream">{info.label}</div>
                          <div className="text-xs text-stone-400 mt-0.5">{info.description}</div>
                        </div>
                      </label>
                    ),
                  )}
                </div>
                <div className="flex gap-3 mt-5">
                  <button
                    className="btn-primary"
                    disabled={covenantType === null}
                    onClick={() => {
                      if (covenantType === null) return;
                      setStep(COVENANT_TYPE_INFO[covenantType].needsTarget ? "enter-target" : "confirm");
                    }}
                    aria-label="Continue to next step"
                  >
                    Continue →
                  </button>
                </div>
              </fieldset>
            )}

            {step === "enter-target" && covenantType !== null && (
              <div>
                <button
                  className="text-stone-400 text-sm hover:text-cream mb-4 flex items-center gap-1"
                  onClick={() => setStep("select-type")}
                  aria-label="Back to covenant type selection"
                >
                  ← Back
                </button>
                <label htmlFor="covenant-target" className="label block mb-2">
                  {COVENANT_TYPE_INFO[covenantType].targetLabel}
                </label>
                <input
                  id="covenant-target"
                  type="text"
                  className="input mono mb-4"
                  placeholder="Wallet address (base58)"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="flex gap-3">
                  <button
                    className="btn-primary"
                    disabled={!targetInput.trim()}
                    onClick={() => setStep("confirm")}
                    aria-label="Continue to confirmation"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {step === "confirm" && covenantType !== null && (
              <div>
                <button
                  className="text-stone-400 text-sm hover:text-cream mb-4 flex items-center gap-1"
                  onClick={() =>
                    setStep(COVENANT_TYPE_INFO[covenantType].needsTarget ? "enter-target" : "select-type")
                  }
                  aria-label="Back to previous step"
                >
                  ← Back
                </button>
                <div
                  className="rounded-lg p-4 mb-4 space-y-2"
                  style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
                >
                  <div className="label">Covenant Type</div>
                  <div className="text-cream text-sm">{COVENANT_TYPE_INFO[covenantType].label}</div>
                  {targetInput && (
                    <>
                      <div className="label mt-2">Target</div>
                      <div className="address text-xs">{targetInput}</div>
                    </>
                  )}
                  <div className="label mt-2">Your signature</div>
                  <div className="text-cream text-sm">You will be the first signer.</div>
                  <div className="label mt-2">Required signatures</div>
                  <div className="text-cream text-sm">{mOfNThreshold}-of-{guardianCount}</div>
                </div>
                <div className="flex gap-3">
                  <button
                    className="btn-primary"
                    onClick={handleCreate}
                    disabled={creating}
                    aria-label={`Create ${COVENANT_TYPE_INFO[covenantType].label} covenant`}
                  >
                    {creating ? "Creating…" : "Create Covenant"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={reset}
                    aria-label="Cancel covenant creation"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {txError && (
              <div role="alert" aria-live="assertive"
                className="mt-4 p-3 rounded-lg text-sm text-red-400"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
                {txError}
              </div>
            )}
            {lastTx && (
              <div role="status" aria-live="polite"
                className="mt-4 p-3 rounded-lg text-sm text-emerald-400"
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}>
                <a href={explorerTxUrl(lastTx)} target="_blank" rel="noopener noreferrer"
                  className="underline" aria-label="View transaction on Solana Explorer">
                  Transaction confirmed ↗
                </a>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}


"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  buildEmergencySweepIx,
  deriveActivityPda,
  CovenantType,
  sendAndConfirmLegacyTx,
  CovenantAccount,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { shortAddress, explorerTxUrl, formatSol } from "@/lib/format";

interface EmergencySweepWizardProps {
  vaultPda:    string;
  beneficiary: string;
  depositedLamports: bigint;
  /** The approved EmergencySweep covenant PDA and account, ready to execute. */
  readyCovenant: { publicKey: string; account: CovenantAccount } | null;
  onRefresh:   () => Promise<void>;
}

type WizardStep =
  | "intro"
  | "verify-covenant"
  | "confirm"
  | "done";

/**
 * Step-by-step wizard for executing an approved EmergencySweep covenant.
 * Designed for situations where a guardian coalition has approved an emergency
 * fund transfer and wants to submit the final transaction.
 *
 * The wizard is entirely keyboard-navigable. Each step is announced to screen
 * readers via role="status". No information is conveyed by colour alone.
 */
export function EmergencySweepWizard({
  vaultPda, beneficiary, depositedLamports, readyCovenant, onRefresh,
}: EmergencySweepWizardProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [step,      setStep]      = useState<WizardStep>("intro");
  const [sweeping,  setSweeping]  = useState(false);
  const [txSig,     setTxSig]     = useState<string | null>(null);
  const [txError,   setTxError]   = useState<string | null>(null);

  const STEPS: WizardStep[] = ["intro", "verify-covenant", "confirm"];
  const stepIndex = STEPS.indexOf(step);

  async function handleSweep() {
    if (!publicKey || !signTransaction || !readyCovenant) return;

    setSweeping(true);
    setTxError(null);

    try {
      const vaultPk      = new PublicKey(vaultPda);
      const beneficiaryPk = new PublicKey(beneficiary);
      const covenantPk   = new PublicKey(readyCovenant.publicKey);
      const [actPda]     = deriveActivityPda(PROGRAM_ID, vaultPk);

      const ix = buildEmergencySweepIx({
        programId:   PROGRAM_ID,
        caller:      publicKey,
        vaultPda:    vaultPk,
        beneficiary: beneficiaryPk,
        covenantPda: covenantPk,
        activityPda: actPda,
      });

      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );

      setTxSig(result.signature);
      setStep("done");
      await onRefresh();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Emergency sweep failed");
    } finally {
      setSweeping(false);
    }
  }

  return (
    <div
      className="card"
      style={{ borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.04)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div
          aria-hidden="true"
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "rgba(239,68,68,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}
        >
          ⚡
        </div>
        <div>
          <h2 className="font-display text-xl text-cream leading-none">Emergency Sweep</h2>
          <p className="text-stone-500 text-xs mt-0.5">Immediate fund transfer to beneficiary</p>
        </div>
      </div>

      {/* Step indicator */}
      {step !== "done" && (
        <nav aria-label="Wizard progress" className="flex items-center gap-2 mb-6">
          {["Understand", "Verify", "Execute"].map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono"
                  style={{
                    background: i <= stepIndex ? "var(--zone-red)" : "rgba(255,255,255,0.08)",
                    color:      i <= stepIndex ? "#fff"            : "var(--text-muted)",
                  }}
                  aria-current={i === stepIndex ? "step" : undefined}
                >
                  {i < stepIndex ? "✓" : i + 1}
                </span>
                <span className={`text-xs ${i === stepIndex ? "text-red-400" : "text-stone-500"}`}>
                  {label}
                </span>
              </div>
              {i < 2 && <div className="flex-1 h-px" style={{ background: "var(--border)" }} />}
            </React.Fragment>
          ))}
        </nav>
      )}

      {/* Step content */}
      <div role="status" aria-live="polite">

        {step === "intro" && (
          <div className="animate-slide-up space-y-4">
            <p className="text-stone-300 text-sm leading-relaxed">
              An emergency sweep instantly transfers all vault funds to the designated beneficiary
              without waiting for the inactivity threshold. It requires the M-of-N guardian council
              to have approved an <strong className="text-red-400">EmergencySweep</strong> covenant.
            </p>
            <ul className="space-y-2 text-sm text-stone-400" aria-label="Prerequisites">
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5 flex-shrink-0" aria-hidden="true">→</span>
                An EmergencySweep covenant must exist with M-of-N signatures
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5 flex-shrink-0" aria-hidden="true">→</span>
                No timelock applies — execution is immediate
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5 flex-shrink-0" aria-hidden="true">→</span>
                Anyone can submit the final transaction — you receive the gas refund
              </li>
            </ul>

            {!readyCovenant && (
              <div
                className="p-3 rounded-lg text-sm text-stone-400"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
                role="note"
              >
                No approved EmergencySweep covenant found for this vault. Guardians must create
                and sign a covenant before the sweep can be executed.
              </div>
            )}

            <button
              className="btn-danger"
              onClick={() => setStep("verify-covenant")}
              disabled={!readyCovenant}
              aria-label="Proceed to verify covenant details"
            >
              Continue →
            </button>
          </div>
        )}

        {step === "verify-covenant" && readyCovenant && (
          <div className="animate-slide-up space-y-4">
            <h3 className="text-sm font-medium text-cream">Covenant details</h3>
            <div className="space-y-2 text-sm">
              <Row label="Covenant PDA"   value={shortAddress(readyCovenant.publicKey, 8)} mono />
              <Row label="Signers"        value={`${readyCovenant.account.signers.length} of ${readyCovenant.account.requiredSignatures} required`} />
              <Row label="Beneficiary"    value={shortAddress(beneficiary, 8)} mono />
              <Row label="Amount"         value={formatSol(depositedLamports)} />
            </div>
            <p className="text-xs text-stone-500">
              Verify all details above carefully. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                className="btn-secondary"
                onClick={() => setStep("intro")}
                aria-label="Back to introduction"
              >
                ← Back
              </button>
              <button
                className="btn-danger"
                onClick={() => setStep("confirm")}
                aria-label="Proceed to final confirmation"
              >
                Looks correct →
              </button>
            </div>
          </div>
        )}

        {step === "confirm" && readyCovenant && (
          <div className="animate-slide-up space-y-4">
            <div
              className="p-4 rounded-lg"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              <p className="text-red-300 text-sm font-medium mb-1">Final confirmation</p>
              <p className="text-stone-300 text-sm">
                Clicking <strong>Execute Sweep</strong> will immediately transfer{" "}
                <strong>{formatSol(depositedLamports)}</strong> to{" "}
                <span className="address">{shortAddress(beneficiary)}</span>.
                The vault will be permanently closed after this transaction.
              </p>
            </div>

            {txError && (
              <div role="alert" className="text-sm text-red-400 p-3 rounded-lg"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
                {txError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                className="btn-secondary"
                onClick={() => setStep("verify-covenant")}
                disabled={sweeping}
                aria-label="Back to covenant verification"
              >
                ← Back
              </button>
              <button
                className="btn-danger"
                onClick={handleSweep}
                disabled={sweeping || !publicKey}
                aria-label="Execute emergency sweep — irreversible action"
              >
                {sweeping ? "Executing…" : "⚡ Execute Sweep"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && txSig && (
          <div className="animate-slide-up space-y-4">
            <div
              className="p-4 rounded-lg"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}
            >
              <p className="text-emerald-400 font-medium mb-1">✓ Sweep executed successfully</p>
              <p className="text-stone-400 text-sm">
                Funds have been transferred to the beneficiary.
              </p>
            </div>
            <a
              href={explorerTxUrl(txSig)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm inline-flex"
              aria-label="View sweep transaction on Solana Explorer"
            >
              View transaction ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-stone-500 flex-shrink-0">{label}</span>
      <span className={`text-cream text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
// app/src/components/VaultDashboard.tsx
//
// Owner's full vault management interface.
//
// Level 2 optimistic updates: each action immediately reflects predicted
// state in the UI (e.g., the check-in timer resets, the deposit balance
// increases) before the confirmation round-trip completes. On error the
// optimistic patch is reverted. On success onRefresh() reconciles with
// on-chain truth so the UI converges to the real state.
//
// Level 4 addition: ShamirDistributor panel for in-browser secret splitting
// and guardian share distribution. Visible to the vault owner only, behind
// a "Guardian Share Setup" expandable section so it doesn't clutter the
// main dashboard for users who don't need it.
//
// Bug fix: threshold input min attribute corrected from 2 to 3 days.
// MIN_INACTIVITY_THRESHOLD_SLOTS = 432,000 slots ÷ 2 slots/sec ÷ 86,400
// sec/day = 2.5 days. With step="1" (whole days), 3 is the smallest integer
// ≥ 2.5 days that passes on-chain validation. The previous min="2" allowed
// the user to enter a value that would be silently rejected by the program.

"use client";

import React, { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  buildCheckInIx,
  buildDepositIx,
  buildConfigureThresholdIx,
  deriveActivityPda,
  MIN_INACTIVITY_THRESHOLD_SLOTS,
  MAX_INACTIVITY_THRESHOLD_SLOTS,
  sendAndConfirmLegacyTx,
  computeVaultInactivityState,
  VaultAccount,
  ActivityAccount,
  VaultInactivityState,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID, explorerUrl } from "@/lib/sdk";
import {
  formatSol,
  formatSlotDays,
  formatSlotDuration,
  formatScore,
  shortAddress,
  zoneLabel,
  zoneTailwindText,
  explorerTxUrl,
} from "@/lib/format";
import { InactivityRing }      from "./InactivityRing";
import { GuardianManager }     from "./GuardianManager";
import { ShamirDistributor }   from "./ShamirDistributor";
import type { GuardianWithAddress } from "@/hooks/useGuardians";

interface VaultDashboardProps {
  vault:       VaultAccount;
  activity:    ActivityAccount | null;
  inactivity:  VaultInactivityState | null;
  vaultPda:    string;
  currentSlot: bigint;
  guardians:   GuardianWithAddress[];
  onRefresh:   () => Promise<void>;
}

export function VaultDashboard({
  vault, activity, inactivity, vaultPda, currentSlot, guardians, onRefresh,
}: VaultDashboardProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [depositAmount, setDepositAmount] = useState("");
  const [newThreshold,  setNewThreshold]  = useState("");

  const [checkingIn,  setCheckingIn]  = useState(false);
  const [depositing,  setDepositing]  = useState(false);
  const [configuring, setConfiguring] = useState(false);

  const [optimisticVault,      setOptimisticVault]      = useState<Partial<VaultAccount> | null>(null);
  const [optimisticInactivity, setOptimisticInactivity] = useState<VaultInactivityState | null>(null);

  const [lastTx,   setLastTx]   = useState<string | null>(null);
  const [txError,  setTxError]  = useState<string | null>(null);

  const [shamirOpen, setShamirOpen] = useState(false);

  const isOwner = publicKey?.toBase58() === vault.owner;

  const displayVault:      VaultAccount          = optimisticVault      ? { ...vault, ...optimisticVault }      : vault;
  const displayInactivity: VaultInactivityState | null = optimisticInactivity ?? inactivity;

  function clearOptimistic() {
    setOptimisticVault(null);
    setOptimisticInactivity(null);
  }

  async function handleCheckIn() {
    if (!publicKey || !signTransaction) return;
    setCheckingIn(true);
    setTxError(null);

    const optimisticSlot = currentSlot;
    const optimisticPatch: Partial<VaultAccount> = {
      lastCheckInSlot:  optimisticSlot,
      warning75Sent:    false,
      warning90Sent:    false,
    };
    setOptimisticVault(optimisticPatch);
    setOptimisticInactivity(
      computeVaultInactivityState({ ...vault, ...optimisticPatch }, optimisticSlot),
    );

    try {
      const vaultPk  = new PublicKey(vaultPda);
      const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPk);

      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildCheckInIx({ programId: PROGRAM_ID, owner: publicKey, vaultPda: vaultPk, activityPda: actPda })],
      );
      setLastTx(result.signature);
      clearOptimistic();
      await onRefresh();
    } catch (err) {
      clearOptimistic();
      setTxError(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setCheckingIn(false);
    }
  }

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey || !signTransaction || !depositAmount) return;

    const lamports = BigInt(Math.round(parseFloat(depositAmount) * 1e9));
    if (lamports <= 0n) return;

    setDepositing(true);
    setTxError(null);

    const optimisticPatch: Partial<VaultAccount> = {
      depositedLamports: vault.depositedLamports + lamports,
    };
    setOptimisticVault(optimisticPatch);

    try {
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildDepositIx({ programId: PROGRAM_ID, owner: publicKey, vaultPda: new PublicKey(vaultPda), lamports })],
      );
      setLastTx(result.signature);
      setDepositAmount("");
      clearOptimistic();
      await onRefresh();
    } catch (err) {
      clearOptimistic();
      setTxError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setDepositing(false);
    }
  }

  async function handleConfigureThreshold(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey || !signTransaction || !newThreshold) return;

    const days  = parseFloat(newThreshold);
    // ~2 slots/second × 86,400 seconds/day
    const slots = BigInt(Math.round(days * 86400 * 2));

    if (slots < MIN_INACTIVITY_THRESHOLD_SLOTS || slots > MAX_INACTIVITY_THRESHOLD_SLOTS) {
      setTxError(
        `Threshold must be between ${formatSlotDays(MIN_INACTIVITY_THRESHOLD_SLOTS)} and ${formatSlotDays(MAX_INACTIVITY_THRESHOLD_SLOTS)}`,
      );
      return;
    }

    setConfiguring(true);
    setTxError(null);

    const optimisticPatch: Partial<VaultAccount> = {
      inactivityThresholdSlots: slots,
      warning75Sent:            false,
      warning90Sent:            false,
    };
    setOptimisticVault(optimisticPatch);
    setOptimisticInactivity(
      computeVaultInactivityState({ ...vault, ...optimisticPatch }, currentSlot),
    );

    try {
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildConfigureThresholdIx({
          programId:         PROGRAM_ID,
          owner:             publicKey,
          vaultPda:          new PublicKey(vaultPda),
          newThresholdSlots: slots,
        })],
      );
      setLastTx(result.signature);
      setNewThreshold("");
      clearOptimistic();
      await onRefresh();
    } catch (err) {
      clearOptimistic();
      setTxError(err instanceof Error ? err.message : "Configure threshold failed");
    } finally {
      setConfiguring(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Status header ─────────────────────────────────────────────────── */}
      <div className="card flex flex-col md:flex-row items-center gap-8">
        {displayInactivity ? (
          <InactivityRing score={displayInactivity.score} zone={displayInactivity.zone} size={200} />
        ) : (
          <div
            style={{ width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }}
            aria-label="Loading inactivity score"
          />
        )}

        <div className="flex-1 w-full">
          <div className="label mb-1">Vault</div>
          <p className="address mb-4">{vaultPda}</p>

          <div className="grid grid-cols-2 gap-4">
            <Stat label="Balance"   value={formatSol(displayVault.depositedLamports)} />
            <Stat label="Threshold" value={formatSlotDays(displayVault.inactivityThresholdSlots)} />
            <Stat label="Guardians" value={`${displayVault.guardianCount} (${displayVault.mOfNThreshold}-of-${displayVault.guardianCount})`} />
            {displayInactivity && (
              <Stat
                label="Zone"
                value={zoneLabel(displayInactivity.zone)}
                valueClass={zoneTailwindText(displayInactivity.zone)}
              />
            )}
          </div>

          {displayInactivity && displayInactivity.milestones.triggerSlot > currentSlot && (
            <p className="text-stone-500 text-xs mt-3">
              Trigger slot:{" "}
              <span className="text-stone-400 mono">
                {displayInactivity.milestones.triggerSlot.toLocaleString()}
              </span>
              {" "}(≈{" "}
              {formatSlotDuration(displayInactivity.milestones.triggerSlot - currentSlot)}{" "}
              remaining)
            </p>
          )}
        </div>
      </div>

      {/* ── Owner actions ──────────────────────────────────────────────────── */}
      {isOwner && !displayVault.isTriggered && !displayVault.isEmergencySwept && (
        <>
          {/* Check-in */}
          <div className="card">
            <h2 className="font-display text-xl text-cream mb-1">Check In</h2>
            <p className="text-sm text-stone-400 mb-4">
              Prove you are alive. Resets the inactivity clock and clears any anomaly flag.
            </p>
            <button
              className="btn-primary"
              onClick={handleCheckIn}
              disabled={checkingIn}
              aria-label="Submit check-in transaction to reset inactivity clock"
            >
              {checkingIn ? "Submitting…" : "✓ Check In Now"}
            </button>
          </div>

          {/* Deposit */}
          <div className="card">
            <h2 className="font-display text-xl text-cream mb-1">Deposit</h2>
            <p className="text-sm text-stone-400 mb-4">
              Add SOL to the vault. These funds will be transferred to your beneficiary when the vault is triggered.
            </p>
            <form onSubmit={handleDeposit} className="flex gap-3" aria-label="Deposit SOL">
              <div className="flex-1">
                <label htmlFor="deposit-amount" className="sr-only">Amount in SOL</label>
                <input
                  id="deposit-amount"
                  type="number"
                  step="0.001"
                  min="0.001"
                  className="input"
                  placeholder="Amount in SOL"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={depositing || !depositAmount}
                aria-label="Deposit SOL into vault"
              >
                {depositing ? "Depositing…" : "Deposit"}
              </button>
            </form>
          </div>

          {/* Configure threshold */}
          <div className="card">
            <h2 className="font-display text-xl text-cream mb-1">Inactivity Threshold</h2>
            <p className="text-sm text-stone-400 mb-4">
              Current: <span className="text-cream">{formatSlotDays(displayVault.inactivityThresholdSlots)}</span>.
              {" "}Minimum {formatSlotDays(MIN_INACTIVITY_THRESHOLD_SLOTS)}, maximum {formatSlotDays(MAX_INACTIVITY_THRESHOLD_SLOTS)}.
            </p>
            <form onSubmit={handleConfigureThreshold} className="flex gap-3" aria-label="Configure inactivity threshold">
              <div className="flex-1">
                <label htmlFor="threshold-days" className="sr-only">New threshold in days</label>
                {/*
                  min="3" because MIN_INACTIVITY_THRESHOLD_SLOTS = 432,000 slots
                  ÷ 2 slots/sec ÷ 86,400 sec/day = 2.5 days. With step="1"
                  (whole days), 3 is the smallest integer that meets the
                  on-chain minimum. Entering 2 would produce 345,600 slots which
                  is below the minimum and would be rejected by the program.
                */}
                <input
                  id="threshold-days"
                  type="number"
                  step="1"
                  min="3"
                  max="912"
                  className="input"
                  placeholder="New threshold in days (min 3)"
                  value={newThreshold}
                  onChange={(e) => setNewThreshold(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn-secondary"
                disabled={configuring || !newThreshold}
                aria-label="Update inactivity threshold"
              >
                {configuring ? "Updating…" : "Update"}
              </button>
            </form>
          </div>
        </>
      )}

      {/* Triggered / swept banners */}
      {displayVault.isTriggered && (
        <div
          role="alert"
          className="card"
          style={{ borderColor: "var(--zone-red)", background: "rgba(239,68,68,0.07)" }}
        >
          <p className="text-red-400 font-medium">⚠ Vault Triggered</p>
          <p className="text-stone-400 text-sm mt-1">
            The inactivity threshold was crossed. Your beneficiary (
            <span className="address">{shortAddress(displayVault.beneficiary)}</span>
            ) may now claim the vault.
          </p>
        </div>
      )}

      {displayVault.isEmergencySwept && (
        <div
          role="alert"
          className="card"
          style={{ borderColor: "var(--zone-orange)", background: "rgba(249,115,22,0.07)" }}
        >
          <p className="text-orange-400 font-medium">⚡ Emergency Sweep Executed</p>
          <p className="text-stone-400 text-sm mt-1">
            Vault funds have been transferred to the beneficiary via emergency sweep covenant.
          </p>
        </div>
      )}

      {/* Guardian management */}
      {isOwner && (
        <GuardianManager
          vault={displayVault}
          vaultPda={vaultPda}
          guardians={guardians}
          onRefresh={onRefresh}
        />
      )}

      {/* Level 4: Shamir secret sharing for guardian key distribution */}
      {isOwner && (
        <section aria-label="Guardian share distribution">
          <button
            className="w-full text-left card flex items-center justify-between gap-4"
            style={{ cursor: "pointer" }}
            onClick={() => setShamirOpen((v) => !v)}
            aria-expanded={shamirOpen}
            aria-controls="shamir-panel"
          >
            <div>
              <h2 className="font-display text-xl text-cream mb-0.5">Guardian Share Distribution</h2>
              <p className="text-stone-400 text-sm">
                Split a recovery secret into M-of-N guardian shares using Shamir's Secret Sharing.
                All computation runs in your browser.
              </p>
            </div>
            <span
              className="text-stone-400 text-lg flex-shrink-0 transition-transform"
              style={{ transform: shamirOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              aria-hidden="true"
            >
              ↓
            </span>
          </button>

          {shamirOpen && (
            <div id="shamir-panel" className="mt-4 animate-slide-up">
              <ShamirDistributor
                vaultPda={vaultPda}
                onShared={(threshold, numShares) => {
                  console.info(`Shamir shares generated: ${threshold}-of-${numShares}`);
                }}
              />
            </div>
          )}
        </section>
      )}

      {/* Beneficiary info */}
      <div className="card">
        <div className="label mb-2">Beneficiary</div>
        <a
          href={explorerUrl(displayVault.beneficiary)}
          target="_blank"
          rel="noopener noreferrer"
          className="address hover:text-cream transition-colors"
          aria-label={`View beneficiary ${displayVault.beneficiary} on Explorer`}
        >
          {displayVault.beneficiary}
        </a>
      </div>

      {/* Activity stats */}
      {activity && (
        <div className="card">
          <h2 className="font-display text-xl text-cream mb-4">Activity Model</h2>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Total Check-ins" value={activity.checkinCount.toLocaleString()} />
            <Stat label="Last Interval"   value={formatSlotDuration(activity.lastInterval)} />
            <Stat
              label="Anomaly Flag"
              value={activity.anomalyFlagged ? "Active" : "Clear"}
              valueClass={activity.anomalyFlagged ? "text-orange-400" : "text-emerald-400"}
            />
          </div>
        </div>
      )}

      {/* Transaction feedback */}
      {(lastTx || txError) && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3 rounded-lg text-sm"
          style={{
            background: txError ? "rgba(239,68,68,0.1)"    : "rgba(16,185,129,0.1)",
            color:      txError ? "var(--zone-red)"         : "var(--zone-green)",
            border:     `1px solid ${txError ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
          }}
        >
          {txError ?? (
            <a
              href={explorerTxUrl(lastTx!)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              aria-label="View transaction on Solana Explorer"
            >
              Transaction confirmed ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label, value, valueClass = "text-cream",
}: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className={`font-medium ${valueClass}`}>{value}</div>
    </div>
  );
}

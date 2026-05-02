"use client";

import React, { use } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  buildTriggerInheritanceIx,
  buildClaimInheritanceIx,
  buildAnomalyFlagIx,
  buildCloseOrphanedCovenantIx,
  deriveActivityPda,
  deriveGuardianPda,
  CovenantType,
  sendAndConfirmLegacyTx,
} from "@legacy-protocol/sdk";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { PROGRAM_ID } from "@/lib/sdk";
import { useVault }         from "@/hooks/useVault";
import { useVaultRealtime } from "@/hooks/useVaultRealtime";
import { useGuardians }     from "@/hooks/useGuardians";
import { VaultDashboard }   from "@/components/VaultDashboard";
import { CovenantFlow }     from "@/components/CovenantFlow";
import { EmergencySweepWizard } from "@/components/EmergencySweepWizard";
import {
  shortAddress,
  formatSol,
  explorerTxUrl,
  zoneColor,
  zoneLabel,
  formatScore,
} from "@/lib/format";
import { fetchAllCovenantsForVault } from "@legacy-protocol/sdk";
import { useState, useEffect, useCallback } from "react";
import type { CovenantAccount } from "@legacy-protocol/sdk";

interface Props {
  params: Promise<{ address: string }>;
}

export default function VaultPage({ params }: Props) {
  const { address } = use(params);
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const { vault, activity, inactivity, currentSlot, loading, error, refresh } = useVault(address);
  const { guardians, refresh: refreshGuardians } = useGuardians(address);

  const [covenants,     setCovenants]     = useState<Array<{ publicKey: string; account: CovenantAccount }>>([]);
  const [claiming,      setClaiming]      = useState(false);
  const [triggering,    setTriggering]    = useState(false);
  const [flagging,      setFlagging]      = useState(false);
  const [closingOrphan, setClosingOrphan] = useState<string | null>(null);
  const [lastTx,        setLastTx]        = useState<string | null>(null);
  const [txError,       setTxError]       = useState<string | null>(null);

  const loadCovenants = useCallback(async () => {
    try {
      const result = await fetchAllCovenantsForVault(connection, PROGRAM_ID, new PublicKey(address));
      setCovenants(result.filter((c) => !c.account.isExecuted));
    } catch { /* silent — non-critical */ }
  }, [address, connection]);

  // Real-time account change subscription
  useVaultRealtime(address, async () => {
    await refresh();
    await refreshGuardians();
    await loadCovenants();
  });

  useEffect(() => {
    loadCovenants();
  }, [loadCovenants]);

  async function handleTrigger() {
    if (!publicKey || !signTransaction) return;
    setTriggering(true);
    setTxError(null);
    try {
      const ix = buildTriggerInheritanceIx({
        programId: PROGRAM_ID,
        caller:    publicKey,
        vaultPda:  new PublicKey(address),
      });
      const result = await sendAndConfirmLegacyTx(connection, { publicKey, signTransaction } as any, [ix]);
      setLastTx(result.signature);
      await refresh();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Trigger failed");
    } finally {
      setTriggering(false);
    }
  }

  async function handleClaim() {
    if (!publicKey || !signTransaction) return;
    setClaiming(true);
    setTxError(null);
    try {
      const vaultPk  = new PublicKey(address);
      const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPk);
      const ix = buildClaimInheritanceIx({
        programId:   PROGRAM_ID,
        beneficiary: publicKey,
        vaultPda:    vaultPk,
        activityPda: actPda,
      });
      const result = await sendAndConfirmLegacyTx(connection, { publicKey, signTransaction } as any, [ix]);
      setLastTx(result.signature);
      await refresh();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

  // Submits anomaly_flag on behalf of the connected guardian. Requires that
  // the connected wallet is an active guardian of this vault and that the
  // current silence is anomalous per is_anomalous() — the on-chain program
  // enforces both conditions; the button is shown as a convenience.
  async function handleAnomalyFlag() {
    if (!publicKey || !signTransaction || !vault) return;
    setFlagging(true);
    setTxError(null);
    try {
      const vaultPk = new PublicKey(address);
      const [gaPda] = deriveGuardianPda(PROGRAM_ID, vaultPk, publicKey);
      const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPk);
      const ix = buildAnomalyFlagIx({
        programId:         PROGRAM_ID,
        guardian:          publicKey,
        vaultPda:          vaultPk,
        guardianAccountPda: gaPda,
        activityPda:       actPda,
      });
      const result = await sendAndConfirmLegacyTx(connection, { publicKey, signTransaction } as any, [ix]);
      setLastTx(result.signature);
      await refresh();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Anomaly flag failed");
    } finally {
      setFlagging(false);
    }
  }

  // Recovers rent from a permanently orphaned covenant PDA. Only callable
  // after the vault has been triggered — the on-chain program enforces this.
  // The caller receives the covenant's rent reserve as a submission incentive.
  async function handleCloseOrphan(covenantPdaStr: string) {
    if (!publicKey || !signTransaction) return;
    setClosingOrphan(covenantPdaStr);
    setTxError(null);
    try {
      const ix = buildCloseOrphanedCovenantIx({
        programId:   PROGRAM_ID,
        caller:      publicKey,
        vaultPda:    new PublicKey(address),
        covenantPda: new PublicKey(covenantPdaStr),
      });
      const result = await sendAndConfirmLegacyTx(connection, { publicKey, signTransaction } as any, [ix]);
      setLastTx(result.signature);
      await loadCovenants();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Close orphan failed");
    } finally {
      setClosingOrphan(null);
    }
  }

  const isOwner       = publicKey?.toBase58() === vault?.owner;
  const isBeneficiary = publicKey?.toBase58() === vault?.beneficiary;
  const isGuardian    = guardians.some((g) => g.account.guardian === publicKey?.toBase58());

  const readySweepCovenant = covenants.find(
    (c) =>
      c.account.covenantType === CovenantType.EmergencySweep &&
      c.account.signers.length >= c.account.requiredSignatures &&
      !c.account.isExecuted,
  ) ?? null;

  const openCovenants = covenants.filter((c) => !c.account.isExecuted);

  // Orphaned covenants exist only when the vault is triggered — they can
  // never be executed and their rent can be recovered by anyone.
  const orphanedCovenants = vault?.isTriggered ? openCovenants : [];

  async function doRefresh() {
    await refresh();
    await refreshGuardians();
    await loadCovenants();
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
        aria-label="Main navigation"
      >
        <Link href="/" className="font-display text-lg text-cream tracking-tight"
          aria-label="Back to home">
          Legacy Protocol
        </Link>
        <WalletMultiButton />
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">

        {/* Loading / error states */}
        {loading && !vault && (
          <p className="text-stone-400 text-center py-20">Loading vault…</p>
        )}
        {error && (
          <div role="alert" className="card text-red-400 text-sm">{error}</div>
        )}
        {!loading && !error && !vault && (
          <div role="alert" className="card text-stone-400 text-sm text-center py-16">
            No vault found at <span className="address">{address}</span>
          </div>
        )}

        {vault && (
          <>
            {/* Role badge */}
            <div className="flex items-center gap-2 mb-6" aria-live="polite">
              <span className="label">Viewing as</span>
              {isOwner && <RoleBadge role="Owner" color="var(--accent)" />}
              {isBeneficiary && !isOwner && <RoleBadge role="Beneficiary" color="var(--zone-green)" />}
              {isGuardian && !isOwner && <RoleBadge role="Guardian" color="#818CF8" />}
              {!isOwner && !isBeneficiary && !isGuardian && publicKey && (
                <RoleBadge role="Observer" color="var(--text-muted)" />
              )}
              {!publicKey && <RoleBadge role="Not connected" color="var(--text-muted)" />}
            </div>

            {/* Owner dashboard */}
            {isOwner && (
              <div className="space-y-6">
                <VaultDashboard
                  vault={vault}
                  activity={activity}
                  inactivity={inactivity}
                  vaultPda={address}
                  currentSlot={currentSlot}
                  guardians={guardians}
                  onRefresh={doRefresh}
                />

                {/* Covenant queue — read-only visibility for owners so they can
                    monitor active governance actions without the ability to sign */}
                {covenants.length > 0 && (
                  <section aria-label="Active covenant governance activity">
                    <div className="card">
                      <h2 className="font-display text-xl text-cream mb-1">Guardian Covenants</h2>
                      <p className="text-stone-400 text-sm mb-4">
                        Active proposals from your guardian council. You can observe but not sign.
                      </p>
                      <div className="space-y-3">
                        {covenants.map((c) => {
                          const typeLabel =
                            c.account.covenantType === CovenantType.EmergencySweep    ? "Emergency Sweep"    :
                            c.account.covenantType === CovenantType.BeneficiaryChange ? "Beneficiary Change" :
                            "Guardian Removal";
                          const thresholdMet = c.account.signers.length >= c.account.requiredSignatures;

                          return (
                            <article
                              key={c.publicKey}
                              className="rounded-lg p-4"
                              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                              aria-label={`${typeLabel} covenant, ${c.account.signers.length} of ${c.account.requiredSignatures} signatures`}
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-medium text-cream">{typeLabel}</span>
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
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}

                {/* Orphaned covenant cleanup for triggered vaults */}
                {vault.isTriggered && orphanedCovenants.length > 0 && (
                  <section aria-label="Orphaned covenant rent recovery">
                    <div className="card" style={{ borderColor: "rgba(249,115,22,0.3)" }}>
                      <h2 className="font-display text-xl text-cream mb-1">Orphaned Covenants</h2>
                      <p className="text-stone-400 text-sm mb-4">
                        These covenants became permanently unexecutable when the vault was triggered.
                        Closing them returns their rent-exempt reserves to your wallet.
                      </p>
                      <div className="space-y-2">
                        {orphanedCovenants.map((c) => {
                          const typeLabel =
                            c.account.covenantType === CovenantType.EmergencySweep    ? "Emergency Sweep"    :
                            c.account.covenantType === CovenantType.BeneficiaryChange ? "Beneficiary Change" :
                            "Guardian Removal";
                          return (
                            <div
                              key={c.publicKey}
                              className="flex items-center justify-between gap-4 p-3 rounded-lg"
                              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                            >
                              <div className="min-w-0">
                                <span className="text-sm text-stone-400">{typeLabel}</span>
                                <p className="address text-xs mt-0.5">{shortAddress(c.publicKey, 6)}</p>
                              </div>
                              {publicKey && (
                                <button
                                  className="btn-secondary text-sm px-3 py-1.5 flex-shrink-0"
                                  onClick={() => handleCloseOrphan(c.publicKey)}
                                  disabled={closingOrphan === c.publicKey}
                                  aria-label={`Recover rent from orphaned ${typeLabel} covenant`}
                                >
                                  {closingOrphan === c.publicKey ? "…" : "Recover Rent"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* Beneficiary panel */}
            {isBeneficiary && !isOwner && (
              <div className="space-y-6 animate-fade-in">
                <div className="card">
                  <h1 className="font-display text-2xl text-cream mb-2">Your Inheritance Vault</h1>
                  <p className="text-stone-400 text-sm mb-5">
                    Balance: <strong className="text-cream">{formatSol(vault.depositedLamports)}</strong>
                    {" "}· Status:{" "}
                    <strong className={vault.isTriggered ? "text-emerald-400" : "text-stone-300"}>
                      {vault.isTriggered ? "Claimable" : vault.isEmergencySwept ? "Swept" : "Waiting"}
                    </strong>
                  </p>
                  {vault.isTriggered && !vault.isClaimed && !vault.isEmergencySwept && (
                    <button
                      className="btn-primary"
                      onClick={handleClaim}
                      disabled={claiming}
                      aria-label="Claim inheritance from vault"
                    >
                      {claiming ? "Claiming…" : `Claim ${formatSol(vault.depositedLamports)}`}
                    </button>
                  )}
                  {vault.isClaimed && (
                    <p className="text-emerald-400 text-sm">✓ Already claimed.</p>
                  )}
                  {!vault.isTriggered && !vault.isEmergencySwept && (
                    <p className="text-stone-500 text-sm">
                      The vault hasn't been triggered yet. The inactivity threshold must be crossed
                      before you can claim.
                    </p>
                  )}
                </div>

                {/* Trigger button for permissionless triggering */}
                {inactivity && inactivity.score >= 100n && !vault.isTriggered && (
                  <div className="card">
                    <p className="text-stone-400 text-sm mb-3">
                      The inactivity threshold has been crossed. Anyone can trigger the vault.
                    </p>
                    <button
                      className="btn-primary"
                      onClick={handleTrigger}
                      disabled={triggering}
                      aria-label="Trigger inheritance — submit trigger_inheritance transaction"
                    >
                      {triggering ? "Triggering…" : "Trigger Inheritance"}
                    </button>
                  </div>
                )}

                {/* Orphaned covenant cleanup for beneficiaries on triggered vaults */}
                {vault.isTriggered && orphanedCovenants.length > 0 && (
                  <div className="card" style={{ borderColor: "rgba(249,115,22,0.3)" }}>
                    <h2 className="font-display text-xl text-cream mb-2">Orphaned Covenants</h2>
                    <p className="text-stone-400 text-sm mb-4">
                      Close these permanently frozen covenants to recover their rent reserves.
                    </p>
                    <div className="space-y-2">
                      {orphanedCovenants.map((c) => (
                        <div
                          key={c.publicKey}
                          className="flex items-center justify-between gap-4 p-3 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                        >
                          <p className="address text-xs">{shortAddress(c.publicKey, 6)}</p>
                          <button
                            className="btn-secondary text-sm px-3 py-1.5"
                            onClick={() => handleCloseOrphan(c.publicKey)}
                            disabled={closingOrphan === c.publicKey}
                            aria-label="Recover rent from orphaned covenant"
                          >
                            {closingOrphan === c.publicKey ? "…" : "Recover Rent"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Guardian panel */}
            {isGuardian && !isOwner && (
              <div className="space-y-6 animate-fade-in">
                <div className="card">
                  <h1 className="font-display text-2xl text-cream mb-2">Guardian View</h1>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-stone-400 text-sm">
                        Owner: <span className="address">{shortAddress(vault.owner, 6)}</span>
                        {" "}· Balance: {formatSol(vault.depositedLamports)}
                      </p>
                      {inactivity && (
                        <p className="text-sm mt-1">
                          Inactivity:{" "}
                          <span style={{ color: zoneColor(inactivity.zone) }}>
                            {formatScore(inactivity.score)} — {zoneLabel(inactivity.zone)}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Anomaly flag — lets a guardian manually signal unusual owner
                    silence before the hard threshold is crossed. The on-chain
                    program enforces that the silence genuinely exceeds the
                    statistical anomaly threshold; this button surfaces the
                    action in the UI so guardians don't need a separate tool. */}
                {!vault.isTriggered && !vault.isEmergencySwept && activity && !activity.anomalyFlagged && (
                  <div className="card">
                    <h2 className="font-display text-xl text-cream mb-1">Anomaly Flag</h2>
                    <p className="text-stone-400 text-sm mb-4">
                      If the owner's silence is statistically unusual relative to their historical
                      check-in frequency, raise an on-chain anomaly flag. The program will reject
                      this if the silence is not yet anomalous — submitting is safe to try.
                    </p>
                    <button
                      className="btn-secondary"
                      onClick={handleAnomalyFlag}
                      disabled={flagging}
                      aria-label="Submit anomaly_flag transaction to signal unusual owner silence"
                    >
                      {flagging ? "Flagging…" : "🚩 Flag Anomaly"}
                    </button>
                  </div>
                )}

                {activity?.anomalyFlagged && (
                  <div
                    className="card"
                    style={{ borderColor: "rgba(249,115,22,0.4)", background: "rgba(249,115,22,0.05)" }}
                    role="status"
                  >
                    <p className="text-orange-400 font-medium">⚠ Anomaly Flag Active</p>
                    <p className="text-stone-400 text-sm mt-1">
                      An anomaly has been flagged on this vault. The flag clears automatically
                      when the owner checks in.
                    </p>
                  </div>
                )}

                {/* Emergency sweep wizard for ready sweep covenants */}
                {readySweepCovenant && (
                  <EmergencySweepWizard
                    vaultPda={address}
                    beneficiary={vault.beneficiary}
                    depositedLamports={vault.depositedLamports}
                    readyCovenant={readySweepCovenant}
                    onRefresh={doRefresh}
                  />
                )}

                <CovenantFlow
                  vaultPda={address}
                  vaultOwner={vault.owner}
                  covenantCounter={vault.covenantCounter}
                  mOfNThreshold={vault.mOfNThreshold}
                  guardianCount={vault.guardianCount}
                  openCovenants={openCovenants}
                  guardians={guardians}
                  onRefresh={doRefresh}
                />

                {/* Orphaned covenant cleanup for triggered vaults */}
                {vault.isTriggered && orphanedCovenants.length > 0 && (
                  <div className="card" style={{ borderColor: "rgba(249,115,22,0.3)" }}>
                    <h2 className="font-display text-xl text-cream mb-2">Orphaned Covenants</h2>
                    <p className="text-stone-400 text-sm mb-4">
                      These covenants can no longer be executed. Closing them recovers the rent.
                    </p>
                    <div className="space-y-2">
                      {orphanedCovenants.map((c) => (
                        <div
                          key={c.publicKey}
                          className="flex items-center justify-between gap-4 p-3 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                        >
                          <p className="address text-xs">{shortAddress(c.publicKey, 6)}</p>
                          <button
                            className="btn-secondary text-sm px-3 py-1.5"
                            onClick={() => handleCloseOrphan(c.publicKey)}
                            disabled={closingOrphan === c.publicKey}
                            aria-label="Recover rent from orphaned covenant"
                          >
                            {closingOrphan === c.publicKey ? "…" : "Recover Rent"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Observer / not connected */}
            {!isOwner && !isBeneficiary && !isGuardian && (
              <div className="space-y-6 animate-fade-in">
                {/* Permissionless trigger */}
                {inactivity && inactivity.score >= 100n && !vault.isTriggered && (
                  <div className="card">
                    <h2 className="font-display text-xl text-cream mb-2">Trigger Available</h2>
                    <p className="text-stone-400 text-sm mb-4">
                      This vault's inactivity threshold has been crossed. Anyone may trigger the inheritance.
                      The caller receives no special benefit — trigger_inheritance is permissionless.
                    </p>
                    {publicKey ? (
                      <button
                        className="btn-primary"
                        onClick={handleTrigger}
                        disabled={triggering}
                        aria-label="Submit trigger_inheritance transaction"
                      >
                        {triggering ? "Triggering…" : "Trigger Inheritance"}
                      </button>
                    ) : (
                      <WalletMultiButton />
                    )}
                  </div>
                )}
                {(!inactivity || inactivity.score < 100n) && (
                  <div className="card text-center py-12">
                    <p className="text-stone-500 text-sm">
                      Connect a wallet that is the vault owner, beneficiary, or a guardian
                      to interact with this vault.
                    </p>
                    <div className="mt-4 inline-block">
                      <WalletMultiButton />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Transaction feedback — success or error */}
            {(lastTx || txError) && (
              <div
                role="alert"
                aria-live="polite"
                className="mt-4 p-3 rounded-lg text-sm"
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
          </>
        )}
      </main>
    </div>
  );
}

function RoleBadge({ role, color }: { role: string; color: string }) {
  return (
    <span
      className="text-xs px-2.5 py-1 rounded-full font-medium"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {role}
    </span>
  );
}

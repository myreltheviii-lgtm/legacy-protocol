"use client";
export const dynamicParams = false;

// app/src/app/vault/[address]/page.tsx
//
// Primary vault detail page. Renders a role-aware UI:
//   - Owner: dashboard, VaultShieldStatus, ShieldedDepositFlow, covenant queue,
//     orphaned covenant recovery, GuardianShareDistribution
//   - Guardian: anomaly flag, covenant signing, InheritanceExecutor (when triggered)
//   - Beneficiary (non-shielded only): claim / trigger flow; shielded vaults
//     direct the beneficiary to /claim which uses BeneficiaryClaim
//   - Observer: trigger button (permissionless), blink links
//
// Security: ownerIdentity is held in a useRef rather than useState so the
// UtxoIdentity.privateKey bytes never appear in the React state tree, DevTools
// snapshots, or any memory dump of component state. A companion boolean state
// (hasOwnerIdentity) drives conditional renders without exposing the key.
// The private key is explicitly zeroed via fill(0) before the ref is cleared.
//
// Performance: doRefresh is wrapped in useCallback so its reference is
// stable across renders. The same stable reference is passed to useVaultRealtime,
// preventing subscription churn (remove + re-add on every render cycle).

import React, {
  use,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);
import {
  buildTriggerInheritanceIx,
  buildClaimInheritanceIx,
  buildAnomalyFlagIx,
  buildCloseOrphanedCovenantIx,
  deriveActivityPda,
  deriveGuardianPda,
  CovenantType,
  sendAndConfirmLegacyTx,
  fetchAllCovenantsForVault,
  ActivityZone,
  isVaultShielded,
} from "@legacy-protocol/sdk";
import { PublicKey }  from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/sdk";
import { useVault }         from "@/hooks/useVault";
import { useVaultRealtime } from "@/hooks/useVaultRealtime";
import { useGuardians }     from "@/hooks/useGuardians";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Navbar }                    from "@/components/Navbar";
import { VaultDashboard }            from "@/components/VaultDashboard";
import { CovenantFlow }              from "@/components/CovenantFlow";
import { EmergencySweepWizard }      from "@/components/EmergencySweepWizard";
import { BlinkShareButton }          from "@/components/BlinkShareButton";
import { NotificationPermissionBanner } from "@/components/NotificationPermissionBanner";
import { Skeleton }                  from "@/components/Skeleton";
import { useToast }                  from "@/components/ToastProvider";
import { VaultShieldStatus }         from "@/components/VaultShieldStatus";
import { ShieldedDepositFlow }       from "@/components/ShieldedDepositFlow";
import { GuardianShareDistribution }  from "@/components/GuardianShareDistribution";
import { InheritanceExecutor }       from "@/components/InheritanceExecutor";
import { importBeneficiaryIdentity } from "@legacy-protocol/cloak-integration";
import { isRestrictedInAppBrowser }  from "@/lib/browser-env";
import type { UtxoIdentity }         from "@legacy-protocol/cloak-integration";
import {
  shortAddress,
  formatSol,
  zoneColor,
  zoneLabel,
  formatScore,
  formatSlotDuration,
} from "@/lib/format";
import type { CovenantAccount } from "@legacy-protocol/sdk";
import Link from "next/link";

interface Props {
  params: Promise<{ address: string }>;
}

export default function VaultPage({ params }: Props) {
  const { address } = use(params);
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { addToast } = useToast();
  const { notify }  = usePushNotifications();

  const { vault, activity, inactivity, currentSlot, loading, error, refresh } =
    useVault(address);
  const { guardians, refresh: refreshGuardians } = useGuardians(address);

  const [covenants,     setCovenants]     = useState<Array<{ publicKey: string; account: CovenantAccount }>>([]);
  const [claiming,      setClaiming]      = useState(false);
  const [triggering,    setTriggering]    = useState(false);
  const [flagging,      setFlagging]      = useState(false);
  const [closingOrphan, setClosingOrphan] = useState<string | null>(null);

  // ── Owner identity — held in ref, NOT in state ─────────────────────────────
  //
  // UtxoIdentity contains a 32-byte privateKey Uint8Array. Storing it in React
  // state would expose the key bytes in DevTools, memory snapshots, and the
  // React state tree. A ref keeps the bytes out of the state tree entirely.
  // hasOwnerIdentity is the boolean state that drives conditional renders.
  //
  const ownerIdentityRef = useRef<UtxoIdentity | null>(null);
  const [hasOwnerIdentity, setHasOwnerIdentity] = useState(false);

  function setOwnerIdentity(id: UtxoIdentity | null) {
    if (id === null) {
      if (ownerIdentityRef.current) {
        ownerIdentityRef.current.privateKey.fill(0);
        ownerIdentityRef.current = null;
      }
      setHasOwnerIdentity(false);
    } else {
      ownerIdentityRef.current = id;
      setHasOwnerIdentity(true);
    }
  }

  const [showDepositFlow,      setShowDepositFlow]      = useState(false);
  const [showShareDist,        setShowShareDist]        = useState(false);
  const [showOwnerImport,      setShowOwnerImport]      = useState(false);
  const [ownerImportMode,      setOwnerImportMode]      = useState<"deposit" | "shares">("deposit");
  const [ownerImportPw,        setOwnerImportPw]        = useState("");
  const [ownerImportError,     setOwnerImportError]     = useState<string | null>(null);
  const [importingOwner,       setImportingOwner]       = useState(false);
  const [ownerImportPasteMode, setOwnerImportPasteMode] = useState(false);
  const [ownerImportPastedJson, setOwnerImportPastedJson] = useState("");
  const ownerBackupFileRef = useRef<HTMLInputElement>(null);

  const prevZoneRef = useRef<ActivityZone | null>(null);

  useEffect(() => {
    if (!inactivity) return;
    const zone = inactivity.zone;
    const prev = prevZoneRef.current;
    if (prev !== null && prev !== zone) {
      if (zone === ActivityZone.Orange) {
        notify("⚠️ Legacy Vault Alert", {
          body: "Inactivity at 90%+. Check in soon.",
          tag:  `vault-orange-${address}`,
          icon: "/icon-192.png",
        });
      }
      if (zone === ActivityZone.Red) {
        notify("🚨 Vault Threshold Crossed", {
          body:               "Inheritance trigger is now available.",
          tag:                `vault-red-${address}`,
          requireInteraction: true,
          icon:               "/icon-192.png",
        });
      }
    }
    prevZoneRef.current = zone;
  }, [inactivity?.zone, address, notify]);

  const loadCovenants = useCallback(async () => {
    try {
      const result = await fetchAllCovenantsForVault(
        connection,
        PROGRAM_ID,
        new PublicKey(address),
      );
      setCovenants(result.filter((c) => !c.account.isExecuted));
    } catch { /* non-critical */ }
  }, [address, connection]);

  // ── Stable refresh callback ────────────────────────────────────────────────
  //
  // doRefresh is memoized with useCallback so its reference is stable across
  // renders. A new reference on every render would cause useVaultRealtime to
  // tear down and re-establish the WebSocket + onAccountChange subscriptions
  // on every render cycle, producing subscription churn.
  //
  const doRefresh = useCallback(async () => {
    await refresh();
    await refreshGuardians();
    await loadCovenants();
  }, [refresh, refreshGuardians, loadCovenants]);

  useVaultRealtime(address, doRefresh);

  useEffect(() => { loadCovenants(); }, [loadCovenants]);

  // ── Instruction handlers ───────────────────────────────────────────────────

  async function handleTrigger() {
    if (!publicKey || !signTransaction) return;
    setTriggering(true);
    try {
      const ix = buildTriggerInheritanceIx({
        programId: PROGRAM_ID,
        caller:    publicKey,
        vaultPda:  new PublicKey(address),
      });
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );
      addToast({ type: "success", title: "Inheritance triggered", txSig: result.signature, duration: 8000 });
      await doRefresh();
    } catch (err) {
      addToast({ type: "error", title: "Trigger failed", message: err instanceof Error ? err.message : "Transaction failed", duration: 8000 });
    } finally {
      setTriggering(false);
    }
  }

  async function handleClaim() {
    if (!publicKey || !signTransaction) return;
    setClaiming(true);
    try {
      const vaultPk  = new PublicKey(address);
      const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPk);
      const ix = buildClaimInheritanceIx({
        programId:   PROGRAM_ID,
        beneficiary: publicKey,
        vaultPda:    vaultPk,
        activityPda: actPda,
      });
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );
      addToast({ type: "success", title: "Inheritance claimed", txSig: result.signature, duration: 8000 });
      await doRefresh();
    } catch (err) {
      addToast({ type: "error", title: "Claim failed", message: err instanceof Error ? err.message : "Transaction failed", duration: 8000 });
    } finally {
      setClaiming(false);
    }
  }

  async function handleAnomalyFlag() {
    if (!publicKey || !signTransaction || !vault) return;
    setFlagging(true);
    try {
      const vaultPk  = new PublicKey(address);
      const [gaPda]  = deriveGuardianPda(PROGRAM_ID, vaultPk, publicKey);
      const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPk);
      const ix = buildAnomalyFlagIx({
        programId:          PROGRAM_ID,
        guardian:           publicKey,
        vaultPda:           vaultPk,
        guardianAccountPda: gaPda,
        activityPda:        actPda,
      });
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );
      addToast({ type: "success", title: "Anomaly flagged", txSig: result.signature, duration: 6000 });
      await doRefresh();
    } catch (err) {
      addToast({ type: "error", title: "Anomaly flag failed", message: err instanceof Error ? err.message : "Transaction failed", duration: 8000 });
    } finally {
      setFlagging(false);
    }
  }

  async function handleCloseOrphan(covenantPdaStr: string) {
    if (!publicKey || !signTransaction) return;
    setClosingOrphan(covenantPdaStr);
    try {
      const ix = buildCloseOrphanedCovenantIx({
        programId:   PROGRAM_ID,
        caller:      publicKey,
        vaultPda:    new PublicKey(address),
        covenantPda: new PublicKey(covenantPdaStr),
      });
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );
      addToast({ type: "success", title: "Rent recovered", txSig: result.signature, duration: 6000 });
      await loadCovenants();
    } catch (err) {
      addToast({ type: "error", title: "Close orphan failed", message: err instanceof Error ? err.message : "Transaction failed", duration: 8000 });
    } finally {
      setClosingOrphan(null);
    }
  }

  function openOwnerImport(mode: "deposit" | "shares") {
    setOwnerImportMode(mode);
    setOwnerImportPw("");
    setOwnerImportError(null);
    setOwnerImportPastedJson("");
    // Default to paste mode inside restricted browsers since the file picker
    // is blocked in Phantom and similar wallet-embedded environments.
    setOwnerImportPasteMode(isRestrictedInAppBrowser());
    setShowOwnerImport(true);
  }

  // Handles import when the user selects a backup file via the file picker.
  async function handleOwnerBackupFile(file: File) {
    setOwnerImportError(null);
    if (!ownerImportPw) { setOwnerImportError("Enter your backup password first"); return; }
    setImportingOwner(true);
    try {
      const text     = await file.text();
      const identity = await importBeneficiaryIdentity(text, ownerImportPw);
      setOwnerIdentity(identity);
      setShowOwnerImport(false);
      if (ownerImportMode === "deposit") {
        setShowDepositFlow(true);
      } else {
        setShowShareDist(true);
      }
    } catch (err) {
      setOwnerImportError(err instanceof Error ? err.message : "Import failed — check password");
    } finally {
      setImportingOwner(false);
    }
  }

  // Handles import when the user pastes their backup JSON directly. Used in
  // restricted browsers where the file picker is unavailable, and available
  // as an option on all browsers for users who backed up via clipboard.
  async function handleOwnerPasteImport() {
    setOwnerImportError(null);
    if (!ownerImportPw)              { setOwnerImportError("Enter your backup password first"); return; }
    if (!ownerImportPastedJson.trim()) { setOwnerImportError("Paste your backup JSON first"); return; }
    setImportingOwner(true);
    try {
      const identity = await importBeneficiaryIdentity(ownerImportPastedJson.trim(), ownerImportPw);
      setOwnerIdentity(identity);
      setShowOwnerImport(false);
      setOwnerImportPastedJson("");
      if (ownerImportMode === "deposit") {
        setShowDepositFlow(true);
      } else {
        setShowShareDist(true);
      }
    } catch (err) {
      setOwnerImportError(err instanceof Error ? err.message : "Import failed — check password and backup JSON");
    } finally {
      setImportingOwner(false);
    }
  }

  // ── Role computation ───────────────────────────────────────────────────────

  const isOwner       = publicKey?.toBase58() === vault?.owner;
  const shielded      = vault ? isVaultShielded(vault) : false;
  const isBeneficiary = !shielded && publicKey?.toBase58() === vault?.beneficiary;
  const isGuardian    = guardians.some((g) => g.account.guardian === publicKey?.toBase58());

  const readySweepCovenant =
    covenants.find(
      (c) =>
        c.account.covenantType === CovenantType.EmergencySweep &&
        c.account.signers.length >= c.account.requiredSignatures &&
        !c.account.isExecuted,
    ) ?? null;

  const openCovenants     = covenants.filter((c) => !c.account.isExecuted);
  const orphanedCovenants = vault?.isTriggered ? openCovenants : [];

  const elapsedSinceTrigger: bigint | null =
    inactivity &&
    inactivity.score >= 100n &&
    inactivity.milestones.triggerSlot <= currentSlot
      ? currentSlot - inactivity.milestones.triggerSlot
      : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">

        {loading && !vault && (
          <div className="space-y-6" aria-label="Loading vault" aria-busy="true">
            <div className="card flex flex-col md:flex-row items-center gap-8">
              <Skeleton.Ring size={200} />
              <div className="flex-1 w-full space-y-3">
                <Skeleton.Text height={12} width="40%" />
                <Skeleton.Text height={10} width="80%" />
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <Skeleton.Text height={32} />
                  <Skeleton.Text height={32} />
                  <Skeleton.Text height={32} />
                  <Skeleton.Text height={32} />
                </div>
              </div>
            </div>
            <Skeleton.Card />
          </div>
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
            {inactivity && (
              <div className="mb-4">
                <NotificationPermissionBanner vaultAddress={address} zone={inactivity.zone} />
              </div>
            )}

            <div className="flex items-center gap-2 mb-6" aria-live="polite">
              <span className="label">Viewing as</span>
              {isOwner                              && <RoleBadge role="Owner"         color="var(--accent)" />}
              {isBeneficiary && !isOwner            && <RoleBadge role="Beneficiary"  color="var(--zone-green)" />}
              {isGuardian    && !isOwner            && <RoleBadge role="Guardian"     color="#818CF8" />}
              {!isOwner && !isBeneficiary && !isGuardian && publicKey && (
                <RoleBadge role="Observer" color="var(--text-muted)" />
              )}
              {!publicKey && <RoleBadge role="Not connected" color="var(--text-muted)" />}
            </div>

            {/* ── OWNER PANEL ──────────────────────────────────────────────── */}
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

                <VaultShieldStatus
                  vault={vault}
                  isOwner={isOwner}
                  onShieldMore={() => {
                    if (hasOwnerIdentity) {
                      setShowDepositFlow(true);
                    } else {
                      openOwnerImport("deposit");
                    }
                  }}
                />

                {showOwnerImport && (
                  <div
                    className="card space-y-4"
                    style={{ borderColor: "rgba(129,140,248,0.4)" }}
                  >
                    <div>
                      <h2 className="font-display text-xl text-cream mb-1">
                        Import Vault Key
                      </h2>
                      <p className="text-stone-400 text-sm">
                        {ownerImportMode === "deposit"
                          ? "Import your encrypted vault key backup to shield additional SOL."
                          : "Import your encrypted vault key backup to redistribute guardian shares."}
                      </p>
                    </div>

                    {/* Mode toggle — hidden in restricted browsers since file picker is blocked */}
                    {!isRestrictedInAppBrowser() && (
                      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <button
                          type="button"
                          className="flex-1 text-xs py-1.5 rounded-md transition-colors"
                          style={{
                            background: !ownerImportPasteMode ? "rgba(129,140,248,0.2)" : "transparent",
                            color:      !ownerImportPasteMode ? "#818CF8" : "var(--text-muted)",
                          }}
                          onClick={() => { setOwnerImportPasteMode(false); setOwnerImportError(null); }}
                          aria-pressed={!ownerImportPasteMode}
                        >
                          Load File
                        </button>
                        <button
                          type="button"
                          className="flex-1 text-xs py-1.5 rounded-md transition-colors"
                          style={{
                            background: ownerImportPasteMode ? "rgba(129,140,248,0.2)" : "transparent",
                            color:      ownerImportPasteMode ? "#818CF8" : "var(--text-muted)",
                          }}
                          onClick={() => { setOwnerImportPasteMode(true); setOwnerImportError(null); }}
                          aria-pressed={ownerImportPasteMode}
                        >
                          Paste JSON
                        </button>
                      </div>
                    )}

                    <div>
                      <label className="label block mb-1">Backup Password</label>
                      <input
                        type="password"
                        className="input w-full"
                        placeholder="Password used when backing up"
                        value={ownerImportPw}
                        onChange={(e) => { setOwnerImportPw(e.target.value); setOwnerImportError(null); }}
                        aria-label="Vault key backup password"
                      />
                    </div>

                    {ownerImportPasteMode && (
                      <div>
                        <label className="label block mb-1">Backup JSON</label>
                        <textarea
                          value={ownerImportPastedJson}
                          onChange={(e) => { setOwnerImportPastedJson(e.target.value); setOwnerImportError(null); }}
                          placeholder='Paste your backup JSON here (starts with {"version":1,...})'
                          rows={5}
                          className="input w-full text-xs font-mono resize-none"
                          aria-label="Paste backup JSON"
                        />
                      </div>
                    )}

                    {/* Hidden file input — only used on the Load File path */}
                    <input
                      ref={ownerBackupFileRef}
                      type="file"
                      accept=".json"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleOwnerBackupFile(f);
                      }}
                    />

                    {ownerImportError && (
                      <p role="alert" className="text-red-400 text-sm">{ownerImportError}</p>
                    )}

                    <div className="flex gap-3">
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setShowOwnerImport(false);
                          setOwnerImportPw("");
                          setOwnerImportPastedJson("");
                        }}
                      >
                        Cancel
                      </button>
                      {ownerImportPasteMode ? (
                        <button
                          className="btn-primary flex-1"
                          onClick={() => void handleOwnerPasteImport()}
                          disabled={!ownerImportPw || !ownerImportPastedJson.trim() || importingOwner}
                          aria-label="Import vault key from pasted backup JSON"
                        >
                          {importingOwner ? "Importing…" : "Import"}
                        </button>
                      ) : (
                        <button
                          className="btn-primary flex-1"
                          onClick={() => ownerBackupFileRef.current?.click()}
                          disabled={!ownerImportPw || importingOwner}
                          aria-label="Load encrypted vault key backup file"
                        >
                          {importingOwner ? "Importing…" : "Load Backup File"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {showDepositFlow && hasOwnerIdentity && ownerIdentityRef.current && (
                  <ShieldedDepositFlow
                    vaultPda={address}
                    ownerUtxoIdentity={ownerIdentityRef.current}
                    onComplete={() => {
                      setShowDepositFlow(false);
                      setOwnerIdentity(null);
                      void doRefresh();
                    }}
                  />
                )}

                {showShareDist && hasOwnerIdentity && ownerIdentityRef.current && guardians.length > 0 && (
                  <GuardianShareDistribution
                    ownerUtxoPrivateKey={ownerIdentityRef.current.privateKey}
                    guardians={guardians}
                    mOfNThreshold={vault.mOfNThreshold}
                    onComplete={() => {
                      setShowShareDist(false);
                      // GuardianShareDistribution zeroes the private key in its
                      // own cleanup. Clear the ref so we don't hold a pointer
                      // to the zeroed Uint8Array.
                      setOwnerIdentity(null);
                    }}
                  />
                )}

                {!showShareDist && !showOwnerImport && guardians.length > 0 && !vault.isTriggered && (
                  <div className="card">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="font-display text-lg text-cream">Guardian Shares</h2>
                        <p className="text-stone-500 text-sm mt-0.5">
                          Redistribute vault key shares after adding a new guardian.
                        </p>
                      </div>
                      <button
                        className="btn-secondary text-sm px-3 py-1.5 flex-shrink-0"
                        onClick={() => {
                          if (hasOwnerIdentity) {
                            setShowShareDist(true);
                          } else {
                            openOwnerImport("shares");
                          }
                        }}
                        aria-label="Redistribute Shamir key shares to guardians"
                      >
                        Redistribute Shares
                      </button>
                    </div>
                  </div>
                )}

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
                                      {thresholdMet ? "✓ Threshold met" : `${c.account.signers.length}/${c.account.requiredSignatures} signed`}
                                    </span>
                                  </div>
                                  {c.account.target !== "11111111111111111111111111111111" && (
                                    <p className="address text-xs mt-1">Target: {shortAddress(c.account.target, 6)}</p>
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

            {/* ── BENEFICIARY PANEL ─────────────────────────────────────────── */}
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
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        className="btn-primary"
                        onClick={handleClaim}
                        disabled={claiming}
                        aria-label="Claim inheritance from vault"
                      >
                        {claiming ? "Claiming…" : `Claim ${formatSol(vault.depositedLamports)}`}
                      </button>
                      <BlinkShareButton action="claim" vaultAddress={address} label="🔗 Share Claim Link" />
                    </div>
                  )}
                  {vault.isClaimed && <p className="text-emerald-400 text-sm">✓ Already claimed.</p>}
                  {!vault.isTriggered && !vault.isEmergencySwept && (
                    <p className="text-stone-500 text-sm">
                      The vault hasn&apos;t been triggered yet. The inactivity threshold must be
                      crossed before you can claim.
                    </p>
                  )}
                </div>

                {inactivity && inactivity.score >= 100n && !vault.isTriggered && (
                  <div className="card">
                    {elapsedSinceTrigger !== null && elapsedSinceTrigger > 0n && (
                      <p className="text-stone-400 text-xs mb-2">
                        Threshold crossed{" "}
                        <span className="text-orange-400">{formatSlotDuration(elapsedSinceTrigger)}</span>{" "}
                        ago
                      </p>
                    )}
                    <p className="text-stone-400 text-sm mb-3">
                      The inactivity threshold has been crossed. Anyone can trigger the vault.
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        className="btn-primary"
                        onClick={handleTrigger}
                        disabled={triggering}
                        aria-label="Trigger inheritance — submit trigger_inheritance transaction"
                      >
                        {triggering ? "Triggering…" : "Trigger Inheritance"}
                      </button>
                      <BlinkShareButton action="trigger" vaultAddress={address} label="🔗 Share Trigger Link" />
                    </div>
                  </div>
                )}

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

            {/* ── SHIELDED VAULT — BENEFICIARY NOTICE ──────────────────────── */}
            {shielded && !isOwner && !isGuardian && (
              <div className="space-y-4 animate-fade-in">
                <div
                  className="card space-y-3"
                  style={{ borderColor: "rgba(16,185,129,0.3)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-2xl" aria-hidden="true">🔒</span>
                    <h2 className="font-display text-xl text-cream">Shielded Vault</h2>
                  </div>
                  <p className="text-stone-400 text-sm">
                    This vault uses Cloak privacy. The beneficiary is identified by a private
                    UTXO key — not a Solana wallet address — so identity cannot be verified here.
                  </p>
                  {vault.isTriggered && (
                    <div
                      className="rounded-lg p-3 text-sm"
                      style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}
                    >
                      <p className="text-emerald-400 font-medium mb-1">✓ Vault triggered — inheritance ready</p>
                      <p className="text-stone-400">
                        If you are the beneficiary, import your private inheritance key at the Claim page to
                        scan the shielded pool and withdraw your inheritance.
                      </p>
                    </div>
                  )}
                  <Link
                    href={`/claim?vault=${address}`}
                    className="btn-primary inline-block text-sm text-center"
                    aria-label="Go to claim page to claim shielded inheritance"
                  >
                    Go to Claim Page →
                  </Link>
                </div>
              </div>
            )}

            {/* ── GUARDIAN PANEL ────────────────────────────────────────────── */}
            {isGuardian && !isOwner && (
              <div className="space-y-6 animate-fade-in">
                <div className="card">
                  <h1 className="font-display text-2xl text-cream mb-2">Guardian View</h1>
                  <div>
                    <p className="text-stone-400 text-sm">
                      Owner: <span className="address">{shortAddress(vault.owner, 6)}</span>
                      {shielded
                        ? " · Balance: 🔒 Private (Cloak)"
                        : ` · Balance: ${formatSol(vault.depositedLamports)}`}
                    </p>
                    {inactivity && (
                      <p className="text-sm mt-1">
                        Inactivity:{" "}
                        <span style={{ color: zoneColor(inactivity.zone) }}>
                          {formatScore(inactivity.score)} — {zoneLabel(inactivity.zone)}
                        </span>
                      </p>
                    )}
                    {shielded && (
                      <p className="text-xs text-stone-500 mt-1">
                        UTXO commitment: <span className="font-mono">{vault.utxoCommitment.slice(0, 16)}…</span>
                      </p>
                    )}
                  </div>
                </div>

                {!vault.isTriggered && !vault.isEmergencySwept && activity && !activity.anomalyFlagged && (
                  <div className="card">
                    <h2 className="font-display text-xl text-cream mb-1">Anomaly Flag</h2>
                    <p className="text-stone-400 text-sm mb-4">
                      If the owner&apos;s silence is statistically unusual relative to their historical
                      check-in frequency, raise an on-chain anomaly flag.
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
                      An anomaly has been flagged on this vault. The flag clears automatically when
                      the owner checks in.
                    </p>
                  </div>
                )}

                {vault.isTriggered && !vault.isClaimed && !vault.isEmergencySwept && shielded && (
                  <section aria-label="Shielded inheritance execution">
                    <InheritanceExecutor
                      vaultPda={address}
                      vault={vault}
                      activity={activity}
                      guardians={guardians}
                      onComplete={doRefresh}
                    />
                  </section>
                )}

                {readySweepCovenant && !shielded && (
                  <EmergencySweepWizard
                    vaultPda={address}
                    beneficiary={vault.beneficiary}
                    depositedLamports={vault.depositedLamports}
                    readyCovenant={readySweepCovenant}
                    onRefresh={doRefresh}
                  />
                )}

                {readySweepCovenant && shielded && (
                  <div
                    className="card"
                    style={{ borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.04)" }}
                  >
                    <p className="text-amber-400 font-medium">Emergency Sweep — Shielded Vault</p>
                    <p className="text-stone-400 text-sm mt-1">
                      This vault&apos;s SOL is in the Cloak shielded pool, not in the Anchor PDA.
                      Use the Inheritance Executor above to transfer assets via the shielded path.
                    </p>
                  </div>
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

            {/* ── OBSERVER / NOT CONNECTED ──────────────────────────────────── */}
            {!isOwner && !isBeneficiary && !isGuardian && !shielded && (
              <div className="space-y-6 animate-fade-in">
                {inactivity && inactivity.score >= 100n && !vault.isTriggered && (
                  <div className="card">
                    <h2 className="font-display text-xl text-cream mb-2">Trigger Available</h2>
                    {elapsedSinceTrigger !== null && elapsedSinceTrigger > 0n && (
                      <p className="text-orange-400 text-sm mb-1">
                        Threshold crossed {formatSlotDuration(elapsedSinceTrigger)} ago
                      </p>
                    )}
                    <p className="text-stone-400 text-sm mb-4">
                      This vault&apos;s inactivity threshold has been crossed. Anyone may trigger the
                      inheritance.
                    </p>
                    {publicKey ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          className="btn-primary"
                          onClick={handleTrigger}
                          disabled={triggering}
                          aria-label="Submit trigger_inheritance transaction"
                        >
                          {triggering ? "Triggering…" : "Trigger Inheritance"}
                        </button>
                        <BlinkShareButton action="trigger" vaultAddress={address} label="🔗 Share Trigger Link" />
                      </div>
                    ) : (
                      <WalletMultiButton />
                    )}
                  </div>
                )}
                {(!inactivity || inactivity.score < 100n) && (
                  <div className="card text-center py-12">
                    <p className="text-stone-500 text-sm mb-2">
                      Connect a wallet that is the vault owner, beneficiary, or a guardian to interact
                      with this vault.
                    </p>
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <BlinkShareButton action="checkIn" vaultAddress={address} label="🔗 Check-In Link" />
                      <BlinkShareButton action="trigger" vaultAddress={address} label="🔗 Trigger Link" />
                      <BlinkShareButton action="claim"   vaultAddress={address} label="🔗 Claim Link" />
                    </div>
                    <div className="mt-2 inline-block">
                      <WalletMultiButton />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <footer className="px-6 py-4 border-t text-center text-stone-600 text-xs" style={{ borderColor: "var(--border)" }}>
        Legacy Protocol · Open source · Permissionless
      </footer>
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

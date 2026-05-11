"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  buildClaimInheritanceIx,
  buildTriggerInheritanceIx,
  deriveActivityPda,
  sendAndConfirmLegacyTx,
  computeVaultInactivityState,
  VaultAccount,
  ActivityZone,
  deserialiseVault,
  isVaultShielded,
  VAULT_SIZE,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import {
  formatSol,
  formatScore,
  zoneColor,
  zoneLabel,
  shortAddress,
} from "@/lib/format";
import { Navbar }           from "@/components/Navbar";
import { InactivityRing }   from "@/components/InactivityRing";
import { Skeleton }         from "@/components/Skeleton";
import { EmptyState }       from "@/components/EmptyState";
import { useToast }         from "@/components/ToastProvider";
import { BeneficiaryClaim } from "@/components/BeneficiaryClaim";

interface BeneficiaryVault {
  publicKey:   string;
  account:     VaultAccount;
  score:       bigint;
  zone:        ActivityZone;
  currentSlot: bigint;
}

type ClaimMode = "scan" | "shielded-claim";

export default function ClaimPage() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { addToast } = useToast();

  const [mode,       setMode]       = useState<ClaimMode>("scan");
  const [vaults,     setVaults]     = useState<BeneficiaryVault[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [claiming,   setClaiming]   = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);

  const loadBeneficiaryVaults = useCallback(async () => {
    if (!publicKey) { setVaults([]); return; }

    setLoading(true);
    setError(null);

    try {
      const slot = BigInt(await connection.getSlot("confirmed"));

      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          { dataSize: VAULT_SIZE },
          {
            memcmp: {
              // beneficiary_utxo_pubkey at offset 40 — for non-shielded vaults
              // these bytes ARE the Solana pubkey; for shielded vaults they are
              // a Cloak UTXO pubkey that does NOT match standard base58 lookup.
              offset: 40,
              bytes:  publicKey.toBase58(),
            },
          },
        ],
      });

      const results: BeneficiaryVault[] = [];
      for (const { pubkey, account } of accounts) {
        const parsed = deserialiseVault(Buffer.from(account.data));
        if (!parsed) continue;
        const state = computeVaultInactivityState(parsed, slot);
        results.push({
          publicKey:   pubkey.toBase58(),
          account:     parsed,
          score:       state.score,
          zone:        state.zone,
          currentSlot: slot,
        });
      }

      // Sort: triggered first, then by inactivity score descending.
      results.sort((a, b) => {
        if (a.account.isTriggered && !b.account.isTriggered) return -1;
        if (!a.account.isTriggered && b.account.isTriggered) return 1;
        return a.score > b.score ? -1 : 1;
      });

      setVaults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load beneficiary vaults");
    } finally {
      setLoading(false);
    }
  }, [publicKey, connection]);

  useEffect(() => { loadBeneficiaryVaults(); }, [loadBeneficiaryVaults]);

  async function handleClaim(vaultPdaStr: string, vault: VaultAccount) {
    if (!publicKey || !signTransaction) return;
    setClaiming(vaultPdaStr);
    try {
      const vaultPk  = new PublicKey(vaultPdaStr);
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
      addToast({
        type:     "success",
        title:    "Inheritance claimed",
        message:  `Received ${formatSol(vault.depositedLamports)}`,
        txSig:    result.signature,
        duration: 8000,
      });
      await loadBeneficiaryVaults();
    } catch (err) {
      addToast({
        type:     "error",
        title:    "Claim failed",
        message:  err instanceof Error ? err.message : "Transaction failed",
        duration: 8000,
      });
    } finally {
      setClaiming(null);
    }
  }

  async function handleTrigger(vaultPdaStr: string) {
    if (!publicKey || !signTransaction) return;
    setTriggering(vaultPdaStr);
    try {
      const ix = buildTriggerInheritanceIx({
        programId: PROGRAM_ID,
        caller:    publicKey,
        vaultPda:  new PublicKey(vaultPdaStr),
      });
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );
      addToast({
        type:     "success",
        title:    "Inheritance triggered",
        txSig:    result.signature,
        duration: 8000,
      });
      await loadBeneficiaryVaults();
    } catch (err) {
      addToast({
        type:     "error",
        title:    "Trigger failed",
        message:  err instanceof Error ? err.message : "Transaction failed",
        duration: 8000,
      });
    } finally {
      setTriggering(null);
    }
  }

  function getStatusLabel(vault: VaultAccount): { text: string; color: string } {
    if (vault.isClaimed)        return { text: "Already Claimed",            color: "var(--text-muted)" };
    if (vault.isEmergencySwept) return { text: "Emergency Swept",            color: "var(--zone-orange)" };
    if (vault.isTriggered)      return { text: "Triggered — Ready to Claim", color: "var(--zone-green)" };
    return { text: "Waiting for trigger", color: "var(--text-secondary)" };
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-12">
        <h1 className="font-display text-4xl text-cream mb-2">Claim Inheritance</h1>
        <p className="text-stone-400 text-sm mb-6">
          Claim from a standard vault, or import your Cloak shielded identity to claim a private inheritance.
        </p>

        {/* Mode selector */}
        <div className="flex rounded-lg overflow-hidden mb-8" style={{ border: "1px solid var(--border)", maxWidth: 400 }}>
          <button
            className="flex-1 py-2 text-sm transition-colors"
            style={{
              background: mode === "scan" ? "rgba(255,255,255,0.08)" : "transparent",
              color:      mode === "scan" ? "var(--text-primary)"    : "var(--text-muted)",
              borderRight: "1px solid var(--border)",
            }}
            onClick={() => setMode("scan")}
          >
            Wallet Scan
          </button>
          <button
            className="flex-1 py-2 text-sm transition-colors"
            style={{
              background: mode === "shielded-claim" ? "rgba(16,185,129,0.12)" : "transparent",
              color:      mode === "shielded-claim" ? "var(--zone-green)"     : "var(--text-muted)",
            }}
            onClick={() => setMode("shielded-claim")}
          >
            🔒 Shielded Claim
          </button>
        </div>

        {/* Shielded claim via Cloak identity */}
        {mode === "shielded-claim" && (
          <BeneficiaryClaim />
        )}

        {/* Standard wallet scan */}
        {mode === "scan" && (
          <>
            {!publicKey && (
              <EmptyState
                icon="🔐"
                title="Connect Your Wallet"
                description="Connect the beneficiary wallet to automatically find vaults designated to you."
              />
            )}

            {publicKey && loading && (
              <div className="space-y-4" aria-label="Loading beneficiary vaults" aria-busy="true">
                <Skeleton.Card />
                <Skeleton.Card />
              </div>
            )}

            {publicKey && error && (
              <div role="alert" className="card text-red-400 text-sm">{error}</div>
            )}

            {publicKey && !loading && !error && vaults.length === 0 && (
              <EmptyState
                icon="📭"
                title="No Vaults Found"
                description="No standard vaults have designated your wallet as beneficiary. For shielded inheritance, use the Shielded Claim tab."
              />
            )}

            {publicKey && !loading && vaults.length > 0 && (
              <div className="space-y-5" role="list" aria-label="Vaults where you are beneficiary">
                {vaults.map((bv) => {
                  const status    = getStatusLabel(bv.account);
                  // Use isVaultShielded() from the SDK for consistent shielded detection.
                  // utxoCommitment on VaultAccount is a hex string — isVaultShielded checks
                  // that it is non-zero (i.e. a Cloak commitment has been recorded).
                  const shielded  = isVaultShielded(bv.account);
                  // Standard claim is only possible for non-shielded vaults.
                  const canClaim  =
                    bv.account.isTriggered &&
                    !bv.account.isClaimed &&
                    !bv.account.isEmergencySwept &&
                    !shielded;
                  const canTrigger =
                    bv.score >= 100n &&
                    !bv.account.isTriggered &&
                    !bv.account.isClaimed &&
                    !bv.account.isEmergencySwept;

                  return (
                    <div
                      key={bv.publicKey}
                      className="card animate-slide-up"
                      role="listitem"
                      style={{
                        borderColor: canClaim
                          ? "rgba(16,185,129,0.4)"
                          : bv.account.isTriggered
                          ? "rgba(16,185,129,0.2)"
                          : "var(--border)",
                      }}
                    >
                      <div className="flex items-start gap-6">
                        <div className="flex-shrink-0">
                          <InactivityRing score={bv.score} zone={bv.zone} size={100} showLabel={true} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="label">Vault #{bv.account.vaultIndex.toString()}</span>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{
                                background: `${status.color}18`,
                                color:      status.color,
                                border:     `1px solid ${status.color}33`,
                              }}
                            >
                              {status.text}
                            </span>
                            {shielded && (
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{ background: "rgba(16,185,129,0.12)", color: "var(--zone-green)", border: "1px solid rgba(16,185,129,0.3)" }}
                              >
                                🔒 Shielded
                              </span>
                            )}
                          </div>

                          <div className="space-y-1 mb-3">
                            <p className="text-xs text-stone-500">
                              Vault: <span className="address">{shortAddress(bv.publicKey, 6)}</span>
                            </p>
                            <p className="text-xs text-stone-500">
                              Owner: <span className="address">{shortAddress(bv.account.owner, 6)}</span>
                            </p>
                            {!shielded && (
                              <p className="text-xs text-stone-400">
                                Balance:{" "}
                                <span className="text-cream font-medium">{formatSol(bv.account.depositedLamports)}</span>
                              </p>
                            )}
                            {shielded && (
                              <p className="text-xs text-stone-500">
                                Balance: <span className="text-stone-400">Private (Cloak)</span>
                              </p>
                            )}
                            <p className="text-xs text-stone-500">
                              Inactivity:{" "}
                              <span style={{ color: zoneColor(bv.zone) }}>
                                {formatScore(bv.score)} — {zoneLabel(bv.zone)}
                              </span>
                            </p>
                          </div>

                          <div className="flex gap-2 flex-wrap">
                            {canClaim && (
                              <button
                                className="btn-primary text-sm"
                                onClick={() => handleClaim(bv.publicKey, bv.account)}
                                disabled={claiming === bv.publicKey}
                              >
                                {claiming === bv.publicKey ? "Claiming…" : `Claim ${formatSol(bv.account.depositedLamports)}`}
                              </button>
                            )}
                            {shielded && bv.account.isTriggered && (
                              <button
                                className="btn-primary text-sm"
                                onClick={() => setMode("shielded-claim")}
                              >
                                🔒 Claim via Cloak Identity
                              </button>
                            )}
                            {canTrigger && (
                              <button
                                className="btn-secondary text-sm"
                                onClick={() => handleTrigger(bv.publicKey)}
                                disabled={triggering === bv.publicKey}
                              >
                                {triggering === bv.publicKey ? "Triggering…" : "Trigger Inheritance"}
                              </button>
                            )}
                            <a
                              href={`/vault/${bv.publicKey}`}
                              className="btn-secondary text-sm"
                            >
                              View →
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
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

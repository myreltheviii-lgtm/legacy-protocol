"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  fetchAllVaultsForOwner,
  computeVaultInactivityState,
  VaultWithAddress,
  ActivityZone,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import {
  zoneColor,
  zoneLabel,
  formatSol,
  formatScore,
  formatSlotDays,
  shortAddress,
} from "@/lib/format";
import { Navbar }           from "@/components/Navbar";
import { InactivityRing }   from "@/components/InactivityRing";
import { CreateVaultModal } from "@/components/CreateVaultModal";
import { Skeleton }         from "@/components/Skeleton";
import { EmptyState }       from "@/components/EmptyState";

interface VaultWithScore extends VaultWithAddress {
  score:       bigint;
  zone:        ActivityZone;
  currentSlot: bigint;
}

export default function VaultsPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();

  const [vaults,     setVaults]     = useState<VaultWithScore[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadVaults = useCallback(async () => {
    if (!publicKey) { setVaults([]); return; }

    setLoading(true);
    setError(null);

    try {
      const slot    = BigInt(await connection.getSlot("confirmed"));
      const fetched = await fetchAllVaultsForOwner(connection, PROGRAM_ID, publicKey);

      const scored: VaultWithScore[] = fetched.map((v) => {
        const state = computeVaultInactivityState(v.account, slot);
        return { ...v, score: state.score, zone: state.zone, currentSlot: slot };
      });

      scored.sort((a, b) => {
        if (a.account.isTriggered && !b.account.isTriggered) return -1;
        if (!a.account.isTriggered && b.account.isTriggered) return 1;
        return a.score > b.score ? -1 : 1;
      });

      setVaults(scored);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vaults");
    } finally {
      setLoading(false);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  function handleVaultCreated(_vaultAddress: string) {
    loadVaults();
  }

  // Memoised so the reduce does not run on every render unrelated to vault data.
  const totalDeposited = useMemo(
    () => vaults.reduce((sum, v) => sum + v.account.depositedLamports, 0n),
    [vaults],
  );

  return (
    <div className="min-h-dvh flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-4xl text-cream mb-1">My Vaults</h1>
            <p className="text-stone-400 text-sm">All inheritance vaults you own, ordered by urgency.</p>
          </div>
          <div className="flex items-center gap-4">
            {vaults.length > 0 && (
              <div className="text-right">
                <div className="label mb-0.5">Total deposited</div>
                <div className="text-cream font-medium">{formatSol(totalDeposited)}</div>
              </div>
            )}
            {publicKey && (
              <button
                className="btn-primary"
                onClick={() => setCreateOpen(true)}
                aria-label="Create a new inheritance vault"
              >
                + Create Vault
              </button>
            )}
          </div>
        </div>

        {/* Not connected */}
        {!publicKey && (
          <EmptyState
            icon="🔐"
            title="Connect Your Wallet"
            description="Connect your owner wallet to view and manage your inheritance vaults."
          />
        )}

        {/* Loading skeleton */}
        {publicKey && loading && (
          <div className="space-y-4" aria-label="Loading vaults" aria-busy="true">
            <Skeleton.Card />
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
        )}

        {/* Error */}
        {publicKey && error && (
          <div role="alert" className="card text-red-400 text-sm">{error}</div>
        )}

        {/* Empty state */}
        {publicKey && !loading && !error && vaults.length === 0 && (
          <EmptyState
            icon="🏛"
            title="No Vaults Yet"
            description="Create your first inheritance vault to protect your assets and designate a beneficiary."
            action={{ label: "Create Vault", onClick: () => setCreateOpen(true) }}
          />
        )}

        {/* Vault list */}
        {publicKey && !loading && vaults.length > 0 && (
          <div role="list" aria-label="Your vault portfolio" className="space-y-4">
            {vaults.map((v) => (
              <a
                key={v.publicKey}
                href={`/vault/${v.publicKey}`}
                role="listitem"
                className="card block transition-colors hover:border-stone-500"
                style={{ textDecoration: "none" }}
                aria-label={`Vault ${shortAddress(v.publicKey)}, inactivity score ${formatScore(v.score)}, zone ${zoneLabel(v.zone)}`}
              >
                <div className="flex items-center gap-6">
                  <div className="flex-shrink-0">
                    <InactivityRing score={v.score} zone={v.zone} size={72} showLabel={false} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="label">Vault #{v.account.vaultIndex.toString()}</span>
                      {v.account.isTriggered && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(239,68,68,0.15)", color: "var(--zone-red)" }}
                          role="status"
                        >
                          ⚠ Triggered
                        </span>
                      )}
                      {v.account.isEmergencySwept && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(249,115,22,0.15)", color: "var(--zone-orange)" }}
                          role="status"
                        >
                          ⚡ Swept
                        </span>
                      )}
                    </div>
                    <p className="address text-xs mb-2">{v.publicKey}</p>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="text-stone-400">
                        <span className="text-stone-500 text-xs">Balance </span>
                        <span className="text-cream">{formatSol(v.account.depositedLamports)}</span>
                      </span>
                      <span className="text-stone-400">
                        <span className="text-stone-500 text-xs">Threshold </span>
                        <span className="text-cream">{formatSlotDays(v.account.inactivityThresholdSlots)}</span>
                      </span>
                      <span className="text-stone-400">
                        <span className="text-stone-500 text-xs">Guardians </span>
                        <span className="text-cream">
                          {v.account.guardianCount} ({v.account.mOfNThreshold}-of-{v.account.guardianCount})
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-3xl font-mono font-medium" style={{ color: zoneColor(v.zone) }}>
                      {formatScore(v.score)}
                    </div>
                    <div className="text-xs font-medium mt-0.5" style={{ color: zoneColor(v.zone) }}>
                      {zoneLabel(v.zone)}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>

      <footer className="px-6 py-4 border-t text-center text-stone-600 text-xs" style={{ borderColor: "var(--border)" }}>
        Legacy Protocol · Open source · Permissionless
      </footer>

      <CreateVaultModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleVaultCreated}
      />
    </div>
  );
}

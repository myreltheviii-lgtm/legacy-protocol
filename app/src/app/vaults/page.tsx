"use client";
// app/src/app/vaults/page.tsx
//
// Multi-vault portfolio page. Shows all VaultAccounts owned by the connected
// wallet, sorted by urgency (highest inactivity score first). Clicking any
// vault navigates to its detail page.
//
// Discovery mechanism: getProgramAccounts with a memcmp filter on the owner
// field (bytes 8–39 of VaultAccount data). This is O(n) on program accounts
// but filtered server-side, so response size is proportional only to the
// number of vaults the owner controls.


import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then(m => m.WalletMultiButton), { ssr: false });
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
import { InactivityRing } from "@/components/InactivityRing";

interface VaultWithScore extends VaultWithAddress {
  score:       bigint;
  zone:        ActivityZone;
  currentSlot: bigint;
}

export default function VaultsPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();

  const [vaults,  setVaults]  = useState<VaultWithScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setVaults([]);
      return;
    }

    setLoading(true);
    setError(null);

    async function load() {
      try {
        const slot     = BigInt(await connection.getSlot("confirmed"));
        const fetched  = await fetchAllVaultsForOwner(connection, PROGRAM_ID, publicKey!);

        const scored: VaultWithScore[] = fetched.map((v) => {
          const state = computeVaultInactivityState(v.account, slot);
          return { ...v, score: state.score, zone: state.zone, currentSlot: slot };
        });

        // Sort: triggered vaults first (need attention), then by score descending.
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
    }

    load();
  }, [publicKey, connection]);

  const totalDeposited = vaults.reduce(
    (sum, v) => sum + v.account.depositedLamports, 0n,
  );

  return (
    <div className="min-h-dvh flex flex-col">
      <nav
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-6">
          <Link href="/" className="font-display text-lg text-cream" aria-label="Back to home">
            Legacy Protocol
          </Link>
          <Link href="/guardian" className="text-stone-400 text-sm hover:text-cream transition-colors">
            Guardian
          </Link>
          <Link href="/claim" className="text-stone-400 text-sm hover:text-cream transition-colors">
            Claim
          </Link>
        </div>
        <WalletMultiButton />
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-4xl text-cream mb-1">My Vaults</h1>
            <p className="text-stone-400 text-sm">
              All inheritance vaults you own, ordered by urgency.
            </p>
          </div>
          {vaults.length > 0 && (
            <div className="text-right">
              <div className="label mb-0.5">Total deposited</div>
              <div className="text-cream font-medium">{formatSol(totalDeposited)}</div>
            </div>
          )}
        </div>

        {!publicKey && (
          <div className="card text-center py-12">
            <p className="text-stone-400 text-sm mb-4">
              Connect your owner wallet to view your vaults.
            </p>
            <WalletMultiButton />
          </div>
        )}

        {publicKey && loading && (
          <p className="text-stone-400 text-center py-20">Loading vaults…</p>
        )}

        {publicKey && error && (
          <div role="alert" className="card text-red-400 text-sm">{error}</div>
        )}

        {publicKey && !loading && !error && vaults.length === 0 && (
          <div className="card text-center py-16">
            <p className="text-stone-500 text-sm mb-2">
              No vaults found for this wallet.
            </p>
            <p className="text-stone-600 text-xs">
              Create your first vault by connecting to a vault initialisation dApp or
              calling <code className="mono">initialize_vault</code> directly.
            </p>
          </div>
        )}

        {publicKey && !loading && vaults.length > 0 && (
          <div
            role="list"
            aria-label="Your vault portfolio"
            className="space-y-4"
          >
            {vaults.map((v) => (
              <Link
                key={v.publicKey}
                href={`/vault/${v.publicKey}`}
                role="listitem"
                className="card block transition-colors hover:border-stone-500"
                style={{ textDecoration: "none" }}
                aria-label={`Vault ${shortAddress(v.publicKey)}, inactivity score ${formatScore(v.score)}, zone ${zoneLabel(v.zone)}`}
              >
                <div className="flex items-center gap-6">
                  {/* Mini inactivity ring */}
                  <div className="flex-shrink-0">
                    <InactivityRing
                      score={v.score}
                      zone={v.zone}
                      size={72}
                      showLabel={false}
                    />
                  </div>

                  {/* Vault info */}
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

                  {/* Score */}
                  <div className="text-right flex-shrink-0">
                    <div
                      className="text-3xl font-mono font-medium"
                      style={{ color: zoneColor(v.zone) }}
                    >
                      {formatScore(v.score)}
                    </div>
                    <div
                      className="text-xs font-medium mt-0.5"
                      style={{ color: zoneColor(v.zone) }}
                    >
                      {zoneLabel(v.zone)}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
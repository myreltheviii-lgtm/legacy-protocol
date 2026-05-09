"use client";

import React, { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { fetchVault, computeVaultInactivityState, VaultAccount, ActivityZone } from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { zoneColor, zoneLabel, formatSlotDays, formatScore, shortAddress } from "@/lib/format";
import { Navbar }     from "@/components/Navbar";
import { Skeleton }   from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";

interface GuardedVault {
  vaultAddress: string;
  vault:        VaultAccount;
  score:        bigint;
  zone:         ActivityZone;
}

export default function GuardianPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();

  const [vaults,  setVaults]  = useState<GuardedVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) { setVaults([]); return; }
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const guardianAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
          commitment: "confirmed",
          filters: [
            { dataSize: 90 },
            {
              memcmp: {
                offset: 40,
                bytes:  publicKey!.toBase58(),
              },
            },
            {
              memcmp: {
                offset: 72,
                bytes:  "2",
              },
            },
          ],
        });

        const currentSlot = BigInt(await connection.getSlot("confirmed"));

        // Fetch all vault accounts in parallel — avoids N+1 sequential RPC calls.
        const vaultFetches = guardianAccounts.map(async ({ account }) => {
          try {
            const vaultPubkeyBytes = account.data.slice(8, 40);
            const vaultPk = new PublicKey(vaultPubkeyBytes);
            const vault = await fetchVault(connection, PROGRAM_ID, vaultPk);
            if (!vault) return null;
            if (vault.isClaimed || vault.isEmergencySwept) return null;
            const state = computeVaultInactivityState(vault, currentSlot);
            return { vaultAddress: vaultPk.toBase58(), vault, score: state.score, zone: state.zone } as GuardedVault;
          } catch {
            return null;
          }
        });

        const settled = await Promise.allSettled(vaultFetches);
        const results: GuardedVault[] = [];
        for (const outcome of settled) {
          if (outcome.status === "fulfilled" && outcome.value !== null) {
            results.push(outcome.value);
          }
        }

        results.sort((a, b) => (a.score > b.score ? -1 : 1));
        setVaults(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load guardian vaults");
      } finally {
        setLoading(false);
      }
    }

    // void satisfies the floating-Promise rule. load() handles all errors
    // internally via try/catch/finally and never propagates a rejection.
    void load();
  }, [publicKey, connection]);

  return (
    <div className="min-h-dvh flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">
        <h1 className="font-display text-4xl text-cream mb-2">Guardian Dashboard</h1>
        <p className="text-stone-400 text-sm mb-8">
          Vaults where your wallet is registered as an active guardian, ordered by urgency.
        </p>

        {!publicKey && (
          <EmptyState
            icon="🛡"
            title="Connect Your Wallet"
            description="Connect your guardian wallet to see vaults where you are an active guardian."
          />
        )}

        {publicKey && loading && (
          <div className="space-y-4" aria-label="Loading guardian vaults" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card skeleton-pulse flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton.Text width={80}  height={10} />
                  <Skeleton.Text width={160} height={10} />
                  <Skeleton.Text width={120} height={10} />
                </div>
                <Skeleton.Text width={60} height={40} />
              </div>
            ))}
          </div>
        )}

        {publicKey && error && (
          <div role="alert" className="card text-red-400 text-sm">{error}</div>
        )}

        {publicKey && !loading && !error && vaults.length === 0 && (
          <EmptyState
            icon="🛡"
            title="No Guardian Assignments"
            description="You are not currently a guardian for any vault. Ask a vault owner to add your wallet as a guardian."
          />
        )}

        {publicKey && !loading && vaults.length > 0 && (
          <div role="list" aria-label="Guardian vault list" className="space-y-4">
            {vaults.map((gv) => (
              <a
                key={gv.vaultAddress}
                href={`/vault/${gv.vaultAddress}`}
                role="listitem"
                className="card block hover:border-stone-500 transition-colors"
                style={{ textDecoration: "none" }}
                aria-label={`View vault owned by ${shortAddress(gv.vault.owner)}, zone ${zoneLabel(gv.zone)}, score ${formatScore(gv.score)}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="label mb-1">Owner</div>
                    <p className="address text-xs mb-2">{shortAddress(gv.vault.owner, 8)}</p>
                    <div className="flex items-center gap-2">
                      <span className="zone-dot" style={{ background: zoneColor(gv.zone) }} aria-hidden="true" />
                      <span className="text-xs font-medium" style={{ color: zoneColor(gv.zone) }}>
                        {zoneLabel(gv.zone)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-3xl font-mono font-medium" style={{ color: zoneColor(gv.zone) }}>
                      {formatScore(gv.score)}
                    </div>
                    <div className="text-stone-500 text-xs mt-1">
                      {formatSlotDays(gv.vault.inactivityThresholdSlots)} threshold
                    </div>
                    {gv.vault.isTriggered && (
                      <span className="text-xs text-red-400 font-medium block mt-1">⚠ Triggered</span>
                    )}
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
    </div>
  );
}

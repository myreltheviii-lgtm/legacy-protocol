"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then(m => m.WalletMultiButton), { ssr: false });
import { PublicKey } from "@solana/web3.js";
import { fetchVault, computeVaultInactivityState, VaultAccount, ActivityZone } from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { zoneColor, zoneLabel, formatSlotDays, formatScore, shortAddress } from "@/lib/format";

/**
 * Guardian dashboard. Scans program accounts for guardian PDAs belonging to
 * the connected wallet, then fetches the corresponding vault states.
 *
 * Displays a vault card for each vault this wallet is a guardian of, showing
 * the inactivity score and zone so the guardian can triage quickly.
 *
 * Filter rationale:
 *   GuardianAccount layout: disc(8) + vault(32) + guardian(32) + is_active(1) + ...
 *   - offset 40: guardian Pubkey — filters to accounts belonging to this wallet
 *   - offset 72: is_active bool — base58("1") = "2", filters to active-only accounts
 *
 * Without the is_active filter, deactivated guardian accounts (removed
 * guardians) also pass the scan, showing stale vault entries for guardianships
 * that have been revoked.
 */

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
    if (!publicKey) {
      setVaults([]);
      return;
    }
    setLoading(true);
    setError(null);

    async function load() {
      try {
        // Fetch all GuardianAccount PDAs where guardian == publicKey AND is_active == true.
        // Two memcmp filters applied server-side so only active guardianships are returned.
        // Without the is_active filter, revoked guardian accounts (is_active = false) would
        // appear in the results and show stale vault entries for removed guardianships.
        const guardianAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
          commitment: "confirmed",
          filters: [
            { dataSize: 90 },
            {
              // guardian Pubkey field starts at byte 40 (after 8-byte disc + 32-byte vault)
              memcmp: {
                offset: 40,
                bytes:  publicKey!.toBase58(),
              },
            },
            {
              // is_active: bool at byte 72. Value 1 (true) encodes to base58 "2".
              // This is the same filter used by fetchAllGuardiansForVault in the SDK.
              memcmp: {
                offset: 72,
                bytes:  "2",
              },
            },
          ],
        });

        // For each active guardian account, derive the vault address and fetch the vault.
        const results: GuardedVault[] = [];
        const currentSlot = BigInt(await connection.getSlot("confirmed"));

        for (const { account } of guardianAccounts) {
          try {
            // vault Pubkey is at bytes 8..40 of GuardianAccount data
            const vaultPubkeyBytes = account.data.slice(8, 40);
            const vaultPk = new PublicKey(vaultPubkeyBytes);

            const vault = await fetchVault(connection, PROGRAM_ID, vaultPk);
            if (!vault) continue;

            // Skip completed vaults
            if (vault.isClaimed || vault.isEmergencySwept) continue;

            const state = computeVaultInactivityState(vault, currentSlot);

            results.push({
              vaultAddress: vaultPk.toBase58(),
              vault,
              score:        state.score,
              zone:         state.zone,
            });
          } catch { /* skip individual vault errors */ }
        }

        // Sort by inactivity score descending — most urgent first.
        results.sort((a, b) => (a.score > b.score ? -1 : 1));
        setVaults(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load guardian vaults");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [publicKey, connection]);

  return (
    <div className="min-h-dvh flex flex-col">
      <nav
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
        aria-label="Main navigation"
      >
        <Link href="/" className="font-display text-lg text-cream" aria-label="Back to home">
          Legacy Protocol
        </Link>
        <WalletMultiButton />
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">
        <h1 className="font-display text-4xl text-cream mb-2">Guardian Dashboard</h1>
        <p className="text-stone-400 text-sm mb-8">
          Vaults where your wallet is registered as an active guardian, ordered by urgency.
        </p>

        {!publicKey && (
          <div className="card text-center py-12">
            <p className="text-stone-400 text-sm mb-4">Connect your guardian wallet to see your vaults.</p>
            <WalletMultiButton />
          </div>
        )}

        {publicKey && loading && (
          <p className="text-stone-400 text-center py-20">Scanning for guardian accounts…</p>
        )}

        {publicKey && error && (
          <div role="alert" className="card text-red-400 text-sm">{error}</div>
        )}

        {publicKey && !loading && !error && vaults.length === 0 && (
          <div className="card text-center py-16">
            <p className="text-stone-500 text-sm">
              No active guardian assignments found for this wallet.
            </p>
          </div>
        )}

        {publicKey && !loading && vaults.length > 0 && (
          <div role="list" aria-label="Guardian vault list" className="space-y-4">
            {vaults.map((gv) => (
              <Link
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
                      <span
                        className="zone-dot"
                        style={{ background: zoneColor(gv.zone) }}
                        aria-hidden="true"
                      />
                      <span
                        className="text-xs font-medium"
                        style={{ color: zoneColor(gv.zone) }}
                      >
                        {zoneLabel(gv.zone)}
                      </span>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div
                      className="text-3xl font-mono font-medium"
                      style={{ color: zoneColor(gv.zone) }}
                    >
                      {formatScore(gv.score)}
                    </div>
                    <div className="text-stone-500 text-xs mt-1">
                      {formatSlotDays(gv.vault.inactivityThresholdSlots)} threshold
                    </div>
                    {gv.vault.isTriggered && (
                      <span className="text-xs text-red-400 font-medium block mt-1">
                        ⚠ Triggered
                      </span>
                    )}
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

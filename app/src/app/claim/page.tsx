"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then(m => m.WalletMultiButton), { ssr: false });
import { PublicKey } from "@solana/web3.js";
import {
  buildClaimInheritanceIx,
  deriveActivityPda,
  sendAndConfirmLegacyTx,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { formatSol, explorerTxUrl } from "@/lib/format";

/**
 * Beneficiary claim page. Asks the beneficiary for the vault PDA address,
 * verifies they are the designated beneficiary, and allows claiming triggered
 * vaults.
 *
 * Since there is no on-chain index of "vaults by beneficiary", the page asks
 * the beneficiary to paste the vault address manually — the owner or guardian
 * should have shared it via the Blink URL or directly.
 */
export default function ClaimPage() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [vaultInput, setVaultInput]   = useState("");
  const [claiming,   setClaiming]     = useState(false);
  const [lastTx,     setLastTx]       = useState<string | null>(null);
  const [claimError, setClaimError]   = useState<string | null>(null);
  const [vaultInfo,  setVaultInfo]    = useState<{ lamports: bigint; isTriggered: boolean } | null>(null);
  const [looking,    setLooking]      = useState(false);

  async function lookupVault() {
    if (!vaultInput.trim()) return;
    setLooking(true);
    setVaultInfo(null);
    setClaimError(null);

    try {
      const { fetchVault } = await import("@legacy-protocol/sdk");
      const v = await fetchVault(connection, PROGRAM_ID, new PublicKey(vaultInput.trim()));
      if (!v) {
        setClaimError("Vault not found at that address.");
        return;
      }
      if (publicKey && v.beneficiary !== publicKey.toBase58()) {
        setClaimError("Your connected wallet is not the beneficiary of this vault.");
        return;
      }
      setVaultInfo({ lamports: v.depositedLamports, isTriggered: v.isTriggered });
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Failed to look up vault");
    } finally {
      setLooking(false);
    }
  }

  async function handleClaim() {
    if (!publicKey || !signTransaction || !vaultInput.trim()) return;
    setClaiming(true);
    setClaimError(null);

    try {
      const vaultPk  = new PublicKey(vaultInput.trim());
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

      setLastTx(result.signature);
      setVaultInfo(null);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

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

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-12">
        <h1 className="font-display text-4xl text-cream mb-2">Claim Inheritance</h1>
        <p className="text-stone-400 text-sm mb-8">
          If you are the designated beneficiary of a triggered vault, claim your inheritance here.
        </p>

        {!publicKey && (
          <div className="card text-center py-10">
            <p className="text-stone-400 text-sm mb-4">Connect the beneficiary wallet to continue.</p>
            <WalletMultiButton />
          </div>
        )}

        {publicKey && (
          <div className="space-y-5">
            {/* Vault address input */}
            <div className="card">
              <label htmlFor="vault-address" className="label block mb-2">
                Vault address
              </label>
              <p className="text-stone-500 text-xs mb-3">
                Your vault owner or guardian should have shared this with you, or you can find it
                in a wallet notification.
              </p>
              <div className="flex gap-3">
                <input
                  id="vault-address"
                  type="text"
                  className="input flex-1 mono"
                  placeholder="Vault PDA address (base58)"
                  value={vaultInput}
                  onChange={(e) => setVaultInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="btn-secondary flex-shrink-0"
                  onClick={lookupVault}
                  disabled={looking || !vaultInput.trim()}
                  aria-label="Look up vault by address"
                >
                  {looking ? "…" : "Look up"}
                </button>
              </div>

              {claimError && (
                <p role="alert" className="text-red-400 text-xs mt-2">{claimError}</p>
              )}
            </div>

            {/* Vault info */}
            {vaultInfo && (
              <div
                className="card animate-slide-up"
                style={{
                  borderColor: vaultInfo.isTriggered ? "rgba(16,185,129,0.4)" : "var(--border)",
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="label">Vault status</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: vaultInfo.isTriggered ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)",
                      color:      vaultInfo.isTriggered ? "var(--zone-green)"     : "var(--text-muted)",
                    }}
                  >
                    {vaultInfo.isTriggered ? "✓ Triggered — claimable" : "Not yet triggered"}
                  </span>
                </div>

                <p className="text-stone-400 text-sm">
                  Balance: <strong className="text-cream">{formatSol(vaultInfo.lamports)}</strong>
                </p>

                {vaultInfo.isTriggered ? (
                  <button
                    className="btn-primary mt-4 w-full"
                    onClick={handleClaim}
                    disabled={claiming}
                    aria-label={`Claim ${formatSol(vaultInfo.lamports)} from vault`}
                  >
                    {claiming ? "Claiming…" : `Claim ${formatSol(vaultInfo.lamports)}`}
                  </button>
                ) : (
                  <p className="text-stone-500 text-xs mt-3">
                    The inactivity threshold has not been crossed yet. Check back later, or contact the owner.
                  </p>
                )}
              </div>
            )}

            {/* Success */}
            {lastTx && (
              <div
                role="status"
                aria-live="polite"
                className="p-4 rounded-lg"
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}
              >
                <p className="text-emerald-400 font-medium mb-1">✓ Inheritance claimed</p>
                <a
                  href={explorerTxUrl(lastTx)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-400 text-sm underline"
                  aria-label="View claim transaction on Solana Explorer"
                >
                  View transaction ↗
                </a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}


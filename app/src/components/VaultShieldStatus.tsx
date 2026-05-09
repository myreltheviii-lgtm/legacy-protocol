"use client";

import React, { useState } from "react";
import { isVaultShielded } from "@legacy-protocol/sdk";
import type { VaultAccount } from "@legacy-protocol/sdk";
import { formatSol, shortAddress } from "@/lib/format";

interface Props {
  vault:       VaultAccount;
  isOwner:     boolean;
  onShieldMore: () => void;
}

export function VaultShieldStatus({ vault, isOwner, onShieldMore }: Props) {
  const shielded = isVaultShielded(vault);
  const [copied, setCopied] = useState(false);

  const shortCommitment = shielded
    ? vault.utxoCommitment.slice(0, 8) + "…" + vault.utxoCommitment.slice(-8)
    : null;

  function copyCommitment() {
    if (!shielded) return;
    navigator.clipboard.writeText(vault.utxoCommitment);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="card space-y-4"
      style={{
        borderColor: shielded ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {shielded ? (
            <span
              className="text-xs px-2.5 py-1 rounded-full font-bold tracking-wide"
              style={{
                background: "rgba(16,185,129,0.15)",
                color:      "var(--zone-green)",
                border:     "1px solid rgba(16,185,129,0.4)",
              }}
            >
              🔒 SHIELDED
            </span>
          ) : (
            <span
              className="text-xs px-2.5 py-1 rounded-full font-bold tracking-wide"
              style={{
                background: "rgba(245,158,11,0.12)",
                color:      "var(--accent)",
                border:     "1px solid rgba(245,158,11,0.35)",
              }}
            >
              🔓 UNSHIELDED
            </span>
          )}
          <span className="text-stone-400 text-sm">Vault balance</span>
        </div>

        {isOwner && !vault.isTriggered && (
          <button
            className="btn-secondary text-xs px-3 py-1.5"
            onClick={onShieldMore}
            aria-label="Shield more SOL into the Cloak shielded pool"
          >
            Shield More SOL
          </button>
        )}
      </div>

      {shielded ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden="true">🔒</span>
            <div>
              <p className="text-stone-400 text-sm">Balance: <strong className="text-cream">Private (Cloak)</strong></p>
              {isOwner && (
                <p className="text-stone-500 text-xs mt-0.5">
                  Deposited: <span className="text-stone-300">{formatSol(vault.depositedLamports)}</span>
                  <span className="text-stone-600 ml-1">(visible only to you)</span>
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="label text-xs">UTXO Commitment</span>
              <span className="text-stone-600 text-xs">Proves vault is shielded</span>
            </div>
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
            >
              <span className="font-mono text-xs text-stone-400 flex-1 truncate">{shortCommitment}</span>
              <button
                className="text-xs text-stone-500 hover:text-cream transition-colors flex-shrink-0"
                onClick={copyCommitment}
                aria-label="Copy UTXO commitment"
              >
                {copied ? "✓" : "Copy"}
              </button>
            </div>
          </div>

          <p className="text-stone-600 text-xs">
            Merkle leaf index: <span className="text-stone-400 font-mono">{vault.utxoLeafIndex.toString()}</span>
          </p>

          <div
            className="rounded-lg px-3 py-2 text-xs"
            style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}
          >
            <span className="text-emerald-400">🔒 Privacy guarantee:</span>
            <span className="text-stone-400 ml-1">
              This vault's balance is invisible on all block explorers.
              Only the commitment hash is on-chain.
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-stone-400 text-sm">Balance</span>
            <span className="text-cream font-medium">{formatSol(vault.depositedLamports)}</span>
          </div>
          <div
            className="rounded-lg px-3 py-2 text-xs"
            style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <span className="text-amber-400">⚠ Unshielded:</span>
            <span className="text-stone-400 ml-1">
              Balance and beneficiary are visible on block explorers.
              Shield your assets to enable full privacy.
            </span>
          </div>
          {isOwner && !vault.isTriggered && (
            <button
              className="btn-primary w-full text-sm"
              onClick={onShieldMore}
              aria-label="Shield SOL into Cloak to make balance private"
            >
              🔒 Shield Assets with Cloak
            </button>
          )}
        </div>
      )}
    </div>
  );
}

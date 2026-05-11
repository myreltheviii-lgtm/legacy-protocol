"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  buildAddGuardianIx,
  buildRemoveGuardianIx,
  deriveGuardianPda,
  MAX_GUARDIANS,
  sendAndConfirmLegacyTx,
  GuardianAccount,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { shortAddress, explorerAddressUrl } from "@/lib/format";
import type { GuardianWithAddress } from "@/hooks/useGuardians";
import type { VaultAccount } from "@legacy-protocol/sdk";

interface GuardianManagerProps {
  vault:     VaultAccount;
  vaultPda:  string;
  guardians: GuardianWithAddress[];
  onRefresh: () => Promise<void>;
}

export function GuardianManager({ vault, vaultPda, guardians, onRefresh }: GuardianManagerProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [addAddress,   setAddAddress]   = useState("");
  const [addThreshold, setAddThreshold] = useState<number>(vault.mOfNThreshold || 1);
  const [adding,       setAdding]       = useState(false);
  const [removing,     setRemoving]     = useState<string | null>(null);
  const [txMsg,        setTxMsg]        = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastAddedGuardian, setLastAddedGuardian] = useState<string | null>(null);
  const [copiedInvite,      setCopiedInvite]      = useState(false);
  const [optimisticGuardians, setOptimisticGuardians] = useState<GuardianWithAddress[] | null>(null);

  const isOwner = publicKey?.toBase58() === vault.owner;
  const canAdd  = guardians.length < MAX_GUARDIANS;
  const displayGuardians = optimisticGuardians ?? guardians;

  function clearOptimistic() {
    setOptimisticGuardians(null);
  }

  function buildInviteLink(): string {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/vault/${vaultPda}?role=guardian`;
  }

  async function handleCopyInvite() {
    const link = buildInviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch { /* ignore */ }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey || !signTransaction || !addAddress.trim()) return;

    setAdding(true);
    setTxMsg(null);
    setLastAddedGuardian(null);

    const guardianPk = new PublicKey(addAddress.trim());
    const [pda] = deriveGuardianPda(PROGRAM_ID, new PublicKey(vaultPda), guardianPk);
    const placeholder: GuardianWithAddress = {
      publicKey: pda.toBase58(),
      account: {
        vault:                vaultPda,
        guardian:             guardianPk.toBase58(),
        isActive:             true,
        addedSlot:            0n,
        removalRequestedSlot: 0n,
        bump:                 0,
      } as GuardianAccount,
    };
    setOptimisticGuardians([...guardians, placeholder]);

    try {
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildAddGuardianIx({
          programId:     PROGRAM_ID,
          owner:         publicKey,
          vaultPda:      new PublicKey(vaultPda),
          guardian:      guardianPk,
          guardianAccountPda: pda,
          mOfNThreshold: addThreshold,
        })],
      );
      setTxMsg({ type: "success", text: `Guardian added. Tx: ${result.signature.slice(0, 8)}…` });
      setLastAddedGuardian(guardianPk.toBase58());
      setAddAddress("");
      clearOptimistic();
      await onRefresh();
    } catch (err) {
      clearOptimistic();
      setLastAddedGuardian(null);
      setTxMsg({ type: "error", text: err instanceof Error ? err.message : "Transaction failed" });
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(guardianAddress: string, guardianAccountPda: string) {
    if (!publicKey || !signTransaction) return;

    setRemoving(guardianAddress);
    setTxMsg(null);

    const existing = guardians.find((g) => g.account.guardian === guardianAddress);
    if (existing && existing.account.removalRequestedSlot === 0n) {
      setOptimisticGuardians(
        guardians.map((g) =>
          g.account.guardian === guardianAddress
            ? { ...g, account: { ...g.account, removalRequestedSlot: 1n } }
            : g,
        ),
      );
    }

    try {
      const result = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [buildRemoveGuardianIx({
          programId:          PROGRAM_ID,
          owner:              publicKey,
          vaultPda:           new PublicKey(vaultPda),
          guardian:           new PublicKey(guardianAddress),
          guardianAccountPda: new PublicKey(guardianAccountPda),
        })],
      );
      setTxMsg({ type: "success", text: `Removal initiated. Tx: ${result.signature.slice(0, 8)}…` });
      clearOptimistic();
      await onRefresh();
    } catch (err) {
      clearOptimistic();
      setTxMsg({ type: "error", text: err instanceof Error ? err.message : "Transaction failed" });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section aria-label="Guardian council management">
      <div className="card">
        <h2 className="font-display text-xl text-cream mb-1">Guardian Council</h2>
        <p className="text-sm text-stone-400 mb-5">
          {vault.mOfNThreshold}-of-{vault.guardianCount} signatures required for any covenant
        </p>

        {displayGuardians.length === 0 ? (
          <p className="text-stone-500 text-sm py-4 text-center">
            No guardians registered. Add guardians to enable covenant protection.
          </p>
        ) : (
          <ul className="space-y-3 mb-5" aria-label="Active guardians">
            {displayGuardians.map((g) => {
              const isPending = g.account.removalRequestedSlot > 0n;
              return (
                <li
                  key={g.publicKey}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="zone-dot"
                      style={{ background: isPending ? "var(--zone-orange)" : "var(--zone-green)" }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <a
                        href={explorerAddressUrl(g.account.guardian)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="address hover:text-cream transition-colors"
                        aria-label={`View guardian ${g.account.guardian} on Explorer`}
                      >
                        {shortAddress(g.account.guardian, 6)}
                      </a>
                      {isPending && (
                        <p className="text-xs text-orange-400 mt-0.5" role="status">
                          ⏳ Removal pending — timelock active
                        </p>
                      )}
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      className="btn-danger text-sm px-3 py-1.5"
                      onClick={() => { void handleRemove(g.account.guardian, g.publicKey); }}
                      disabled={removing === g.account.guardian}
                      aria-label={
                        isPending
                          ? `Finalise removal of guardian ${shortAddress(g.account.guardian)}`
                          : `Initiate removal of guardian ${shortAddress(g.account.guardian)}`
                      }
                    >
                      {removing === g.account.guardian ? "…" : isPending ? "Finalise" : "Remove"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isOwner && canAdd && (
          <form onSubmit={(e) => { void handleAdd(e); }} aria-label="Add new guardian">
            <h3 className="label mb-3">Add Guardian</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="guardian-address" className="sr-only">Guardian wallet address</label>
                <input
                  id="guardian-address"
                  type="text"
                  className="input mono"
                  placeholder="Guardian wallet address (base58)"
                  value={addAddress}
                  onChange={(e) => setAddAddress(e.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label htmlFor="m-of-n" className="label mb-1 block">
                    Require (M-of-{vault.guardianCount + 1})
                  </label>
                  <input
                    id="m-of-n"
                    type="number"
                    className="input"
                    min={1}
                    max={vault.guardianCount + 1}
                    value={addThreshold}
                    onChange={(e) => setAddThreshold(parseInt(e.target.value, 10))}
                  />
                </div>
                <button
                  type="submit"
                  className="btn-primary mt-5"
                  disabled={adding || !addAddress.trim()}
                  aria-label="Add guardian to vault"
                >
                  {adding ? "Adding…" : "Add Guardian"}
                </button>
              </div>
            </div>
          </form>
        )}

        {!canAdd && isOwner && (
          <p className="text-stone-500 text-sm mt-3">Maximum of {MAX_GUARDIANS} guardians reached.</p>
        )}

        {txMsg && (
          <div
            role="alert"
            aria-live="polite"
            className="mt-4 p-3 rounded-lg text-sm"
            style={{
              background: txMsg.type === "success" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
              color:      txMsg.type === "success" ? "var(--zone-green)"    : "var(--zone-red)",
              border:     `1px solid ${txMsg.type === "success" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
            }}
          >
            {txMsg.text}
          </div>
        )}
      </div>

      {/* Guardian invite link */}
      {lastAddedGuardian && (
        <div
          className="card mt-3 animate-slide-up"
          style={{ borderColor: "rgba(129,140,248,0.3)", background: "rgba(129,140,248,0.04)" }}
        >
          <h3 className="font-display text-lg text-cream mb-1">Guardian Added</h3>
          <p className="text-stone-400 text-sm mb-3">
            Share this link with{" "}
            <span className="address">{shortAddress(lastAddedGuardian, 6)}</span>{" "}
            so they can access the guardian view for this vault.
          </p>
          <p className="text-stone-500 text-xs mb-3">
            Note: Guardians are added unilaterally by the owner. The invite link opens the vault page
            where they can see their active guardian status and use guardian features.
          </p>
          <div className="flex items-center gap-3">
            <code
              className="address text-xs flex-1 p-2 rounded"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", wordBreak: "break-all" }}
            >
              {typeof window !== "undefined"
                ? `${window.location.origin}/vault/${vaultPda}?role=guardian`
                : `/vault/${vaultPda}?role=guardian`}
            </code>
            <button
              className="btn-secondary flex-shrink-0"
              onClick={() => { void handleCopyInvite(); }}
              aria-label={`Copy invite link for guardian ${shortAddress(lastAddedGuardian)}`}
            >
              {copiedInvite ? "✓ Copied!" : "Copy Invite Link"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

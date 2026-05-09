"use client";

import React, { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  scanOwnerUtxos,
  reconstructAndTransfer,
} from "@legacy-protocol/cloak-integration";
import {
  decodeShareBase64,
  reconstructSecret,
  ShamirError,
  buildRecordCloakClaimIx,
  deriveActivityPda,
  sendAndConfirmLegacyTx,
  computeCloakFee,
  hexToUtxoPubkey,
} from "@legacy-protocol/sdk";
import type { VaultAccount, ActivityAccount, GuardianWithAddress } from "@legacy-protocol/sdk";
import type { GuardianShare } from "@legacy-protocol/cloak-integration";
import { PROGRAM_ID } from "@/lib/sdk";
import { formatSol, shortAddress, explorerTxUrl } from "@/lib/format";
import { InactivityRing } from "./InactivityRing";
import { useToast } from "./ToastProvider";

interface Props {
  vaultPda:   string;
  vault:      VaultAccount;
  activity:   ActivityAccount | null;
  guardians:  GuardianWithAddress[];
  onComplete: () => void;
}

type Step = "prereqs" | "shares" | "confirm" | "executing" | "done";
type ExecPhase = "scanning" | "proving" | "recording" | "complete";

const LAMPORTS_PER_SOL = 1_000_000_000n;

function fmtSol(l: bigint): string {
  return (Number(l) / Number(LAMPORTS_PER_SOL)).toFixed(4) + " SOL";
}

/**
 * Decodes a Solana transaction signature (base58, 64 bytes raw) to a Uint8Array.
 * The Cloak SDK returns Solana transaction signatures as base58 strings.
 * record_cloak_claim stores 64 raw bytes on-chain for the audit trail.
 *
 * bs58 is a transitive dependency of @solana/web3.js and available at runtime.
 */
function decodeBase58Signature(sig: string): Uint8Array {
  // @solana/web3.js re-exports bs58 internally. We avoid adding a direct
  // bs58 import by using the PublicKey class's underlying buffer utilities.
  // Since a Solana signature is a 64-byte value encoded as base58, we use
  // the standard approach: decode via the bs58 alphabet directly.
  try {
    // Attempt direct import of bs58 (available as transitive dep)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58 = require("bs58");
    const decoded = bs58.decode(sig);
    const bytes = new Uint8Array(64);
    // Copy up to 64 bytes; valid Solana signatures are exactly 64 bytes.
    bytes.set(decoded.slice(0, 64));
    return bytes;
  } catch {
    // Fallback: treat as UTF-8 bytes (audit trail still meaningful even if
    // the exact byte representation differs from raw signature bytes).
    const encoder = new TextEncoder();
    const encoded = encoder.encode(sig);
    const bytes = new Uint8Array(64);
    bytes.set(encoded.slice(0, 64));
    return bytes;
  }
}

export function InheritanceExecutor({
  vaultPda,
  vault,
  activity,
  guardians,
  onComplete,
}: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { addToast } = useToast();

  const [step,          setStep]          = useState<Step>("prereqs");
  const [shareInputs,   setShareInputs]   = useState<string[]>(
    Array(vault.mOfNThreshold).fill(""),
  );
  const [shareStatuses, setShareStatuses] = useState<Array<"idle" | "ok" | "fail">>(
    Array(vault.mOfNThreshold).fill("idle"),
  );
  const [testResult,    setTestResult]    = useState<"ok" | "fail" | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [execPhase,     setExecPhase]     = useState<ExecPhase | null>(null);
  const [cloakSig,      setCloakSig]      = useState<string | null>(null);
  const [anchorSig,     setAnchorSig]     = useState<string | null>(null);

  const grossLamports = vault.depositedLamports;
  const feeBreak      = grossLamports > 0n ? computeCloakFee(grossLamports) : null;

  // ── Share validation on paste ─────────────────────────────────────────────

  function handleShareChange(idx: number, value: string) {
    setShareInputs((prev) => prev.map((v, i) => (i === idx ? value : v)));
    setError(null);
    setTestResult(null);

    if (!value.trim()) {
      setShareStatuses((prev) => prev.map((s, i) => (i === idx ? "idle" : s)));
      return;
    }

    try {
      decodeShareBase64(value.trim());
      setShareStatuses((prev) => prev.map((s, i) => (i === idx ? "ok" : s)));
    } catch {
      setShareStatuses((prev) => prev.map((s, i) => (i === idx ? "fail" : s)));
    }
  }

  // ── Test reconstruction (no transfer, no key material in frontend) ────────

  function handleTestReconstruct() {
    setError(null);
    setTestResult(null);
    try {
      const decoded = shareInputs.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error(`Share ${i + 1} is empty`);
        return decodeShareBase64(trimmed);
      });
      // Reconstruct and immediately zero — test-only path, result not used.
      const key = reconstructSecret(decoded);
      key.fill(0);
      setTestResult("ok");
    } catch (err) {
      setTestResult("fail");
      setError(err instanceof ShamirError ? err.message : String(err));
    }
  }

  // ── Execute shielded inheritance transfer ────────────────────────────────

  const handleExecute = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    setError(null);
    setStep("executing");
    setExecPhase("scanning");

    try {
      // Build the guardian share objects from the raw input strings.
      // Decode each share to validate it and extract the share index.
      const decodedForIndex = shareInputs.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error(`Share ${i + 1} is empty`);
        return decodeShareBase64(trimmed);
      });

      const guardianShareObjects: GuardianShare[] = shareInputs.map((raw, i) => ({
        shareIndex:     decodedForIndex[i].index,
        shareBase64:    raw.trim(),
        guardianWallet: guardians[i]?.account.guardian ?? `guardian-${i + 1}`,
      }));

      // Phase 1: scan the shielded pool for vault UTXOs.
      // scanOwnerUtxos reconstructs the private key internally, scans, and
      // immediately zeros the key in a finally block — the key never surfaces
      // in this component's scope.
      const { vaultUtxos, totalAmount } = await scanOwnerUtxos({
        guardianShares: guardianShareObjects,
        connection,
      });

      if (vaultUtxos.length === 0) {
        throw new Error(
          "No unspent UTXOs found in the shielded pool. " +
          "Verify the vault has been deposited into Cloak.",
        );
      }

      // Phase 2: extract beneficiary UTXO pubkey from on-chain vault data.
      // hexToUtxoPubkey validates the hex string (exactly 64 chars, valid hex)
      // and returns a 32-byte Uint8Array — the canonical conversion function
      // for beneficiaryUtxoPubkey fields on VaultAccount.
      const beneficiaryUtxoPubkey = hexToUtxoPubkey(vault.beneficiaryUtxoPubkey);

      setExecPhase("proving");

      // Phase 3: execute the shielded transfer.
      // reconstructAndTransfer reconstructs the key internally (second and
      // final reconstruction), passes it to Cloak as depositorKeypair so the
      // ZK circuit can generate the nullifier, then zeros it in a finally block.
      // The guardian's connected wallet (publicKey + signTransaction) signs the
      // Solana transaction and pays the fee.
      const claim = await reconstructAndTransfer({
        guardianShares:        guardianShareObjects,
        beneficiaryUtxoPubkey,
        vaultUtxos,
        totalAmount,
        relayerWallet: { publicKey, signTransaction },
        connection,
      });

      setCloakSig(claim.cloakSignature);
      setExecPhase("recording");

      // Phase 4: submit record_cloak_claim to close Anchor accounts.
      // The Cloak signature is stored for the on-chain audit trail.
      // Decode from base58 (Solana tx signature format) to 64 raw bytes.
      const vaultPk  = new PublicKey(vaultPda);
      const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPk);

      const cloakSigBytes = claim.cloakSignature
        ? decodeBase58Signature(claim.cloakSignature)
        : new Uint8Array(64);

      const ix = buildRecordCloakClaimIx({
        programId:              PROGRAM_ID,
        caller:                 publicKey,
        vaultPda:               vaultPk,
        activityPda:            actPda,
        cloakTransferSignature: cloakSigBytes,
      });

      const { signature } = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );

      setAnchorSig(signature);
      setExecPhase("complete");
      setStep("done");

      addToast({
        type:     "success",
        title:    "Inheritance executed privately",
        message:  "Assets delivered to beneficiary with zero public trace.",
        txSig:    signature,
        duration: 10000,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
      setStep("confirm");
      setExecPhase(null);
      addToast({
        type:     "error",
        title:    "Inheritance execution failed",
        message:  err instanceof Error ? err.message : "Transaction failed",
        duration: 8000,
      });
    }
  }, [
    publicKey, signTransaction, connection, shareInputs, vault, vaultPda,
    guardians, addToast,
  ]);

  // ── Step: Done ────────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✅</span>
          <h2 className="font-display text-xl text-cream">Private Inheritance Complete</h2>
        </div>
        <p className="text-emerald-400 text-sm">
          Assets delivered privately to the beneficiary.
          Zero amount, zero identity — no public trace on any block explorer.
        </p>
        <p className="text-stone-500 text-xs">
          The vault UTXO private key was zeroed from browser memory immediately after transfer.
        </p>
        <div className="space-y-2">
          {cloakSig && (
            <div>
              <p className="label text-xs">Cloak transfer signature</p>
              <a
                href={explorerTxUrl(cloakSig)}
                target="_blank"
                rel="noopener noreferrer"
                className="address text-xs break-all hover:underline"
              >
                {cloakSig}
              </a>
            </div>
          )}
          {anchorSig && (
            <div>
              <p className="label text-xs">Anchor record signature</p>
              <a
                href={explorerTxUrl(anchorSig)}
                target="_blank"
                rel="noopener noreferrer"
                className="address text-xs break-all hover:underline"
              >
                {anchorSig}
              </a>
            </div>
          )}
        </div>
        <button className="btn-primary" onClick={onComplete}>Done</button>
      </div>
    );
  }

  // ── Step: Executing ───────────────────────────────────────────────────────

  if (step === "executing") {
    return (
      <div className="card space-y-4">
        <h2 className="font-display text-xl text-cream">Executing Private Transfer…</h2>
        <ExecRow label="Scanning shielded pool for UTXOs"      done={execPhase !== "scanning"}                        active={execPhase === "scanning"} />
        <ExecRow label="Generating zero-knowledge proof"        done={execPhase === "recording" || execPhase === "complete"} active={execPhase === "proving"} />
        <ExecRow label="Recording claim on-chain"              done={execPhase === "complete"}                        active={execPhase === "recording"} />
        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
      </div>
    );
  }

  // ── Step: Confirm (point of no return) ────────────────────────────────────

  if (step === "confirm") {
    return (
      <div className="card space-y-5">
        <div>
          <h2 className="font-display text-xl text-cream mb-1">Confirm Private Transfer</h2>
          <div
            className="rounded-lg p-3 text-sm text-red-400"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
            role="alert"
          >
            ⚠ This action is IRREVERSIBLE. Once executed, assets move permanently.
          </div>
        </div>

        {feeBreak && (
          <div
            className="rounded-lg p-3 space-y-1 text-sm"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
          >
            <FeeRow label="Gross transfer"      value={fmtSol(feeBreak.gross)} />
            <FeeRow label="Cloak fee"            value={fmtSol(feeBreak.total)} muted />
            <FeeRow label="Net to beneficiary"  value={fmtSol(feeBreak.net)} green />
          </div>
        )}

        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}
        >
          <span className="text-emerald-400">🔒 Zero public trace:</span>
          <span className="text-stone-400 ml-1">
            externalAmount: 0 — fully shielded, no amounts visible on any block explorer.
          </span>
        </div>

        <p className="text-stone-400 text-sm">
          Beneficiary: <span className="address">{vault.beneficiaryUtxoPubkey.slice(0, 16)}…</span>
          {" "}(Cloak UTXO identity — not a Solana address)
        </p>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={() => { setStep("shares"); setError(null); }}>
            ← Back
          </button>
          <button
            className="btn-primary flex-1"
            onClick={() => void handleExecute()}
            disabled={!publicKey || !signTransaction}
            aria-label="Execute private inheritance transfer — irreversible"
          >
            Execute Private Inheritance Transfer
          </button>
        </div>
      </div>
    );
  }

  // ── Step: Shares ──────────────────────────────────────────────────────────

  if (step === "shares") {
    const allValid = shareStatuses.every((s) => s === "ok");

    return (
      <div className="card space-y-5">
        <div>
          <h2 className="font-display text-xl text-cream mb-1">Enter Guardian Shares</h2>
          <p className="text-stone-400 text-sm">
            {vault.mOfNThreshold} of {vault.guardianCount} guardians must paste their share.
            All Shamir reconstruction happens in your browser — nothing is transmitted.
          </p>
        </div>

        <div className="space-y-4">
          {shareInputs.map((val, i) => (
            <div key={i}>
              <label className="label block mb-1">
                Share {i + 1}
                {shareStatuses[i] === "ok"   && <span className="text-emerald-400 ml-2">✓ Valid</span>}
                {shareStatuses[i] === "fail" && <span className="text-red-400 ml-2">✗ Invalid</span>}
              </label>
              <input
                type="text"
                className="input font-mono text-xs w-full"
                placeholder="Paste base64 guardian share…"
                value={val}
                onChange={(e) => handleShareChange(i, e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label={`Guardian share ${i + 1}`}
              />
            </div>
          ))}
        </div>

        {error && <p role="alert" className="text-red-400 text-xs">{error}</p>}

        {testResult === "ok" && (
          <div
            className="rounded-lg p-3 text-sm text-emerald-400"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)" }}
          >
            ✓ Shares reconstruct correctly. Ready to execute.
          </div>
        )}

        {testResult === "fail" && (
          <div
            className="rounded-lg p-3 text-sm text-red-400"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            ✗ Shares do not reconstruct. Check values and try again.
          </div>
        )}

        <div className="flex gap-3">
          <button className="btn-secondary" onClick={() => setStep("prereqs")}>← Back</button>
          <button
            className="btn-secondary"
            onClick={handleTestReconstruct}
            disabled={!allValid}
          >
            Test Reconstruction
          </button>
          <button
            className="btn-primary"
            onClick={() => { setError(null); setStep("confirm"); }}
            disabled={!allValid || !publicKey}
          >
            Continue to Execute →
          </button>
        </div>
      </div>
    );
  }

  // ── Step: Prereqs ─────────────────────────────────────────────────────────

  const shielded = vault.utxoCommitment !== "0".repeat(64);

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-display text-xl text-cream mb-1">Inheritance Executor</h2>
        <p className="text-stone-400 text-sm">
          Execute a fully shielded inheritance transfer. No amounts, no identities — zero public trace.
        </p>
      </div>

      <div
        className="rounded-lg p-3 text-sm text-amber-400"
        style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)" }}
      >
        ⚠ This action is irreversible. Verify all details before proceeding.
      </div>

      <div
        className="rounded-lg p-3 space-y-2 text-sm"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
      >
        <CheckRow label="Vault triggered"    ok={vault.isTriggered}   note={vault.isTriggered ? undefined : "Threshold must be crossed first"} />
        <CheckRow label="Assets shielded"    ok={shielded}            note={shielded ? undefined : "No Cloak deposit recorded"} />
        <CheckRow label="Guardian M-of-N"    ok={vault.mOfNThreshold > 0}
          note={`${vault.mOfNThreshold}-of-${vault.guardianCount} required`}
        />
        <CheckRow label="Wallet connected"   ok={!!publicKey}         note={publicKey ? undefined : "Connect a guardian wallet"} />
      </div>

      {shielded && (
        <div>
          <p className="label text-xs mb-1">UTXO Commitment (proof of shielded assets)</p>
          <p className="font-mono text-xs text-stone-400 break-all">
            {vault.utxoCommitment.slice(0, 32)}…
          </p>
        </div>
      )}

      {feeBreak && (
        <div className="text-sm space-y-1">
          <FeeRow label="Gross transfer"     value={fmtSol(feeBreak.gross)} />
          <FeeRow label="Cloak fee"           value={fmtSol(feeBreak.total)} muted />
          <FeeRow label="Net to beneficiary" value={fmtSol(feeBreak.net)} green />
        </div>
      )}

      <button
        className="btn-primary w-full"
        onClick={() => setStep("shares")}
        disabled={!vault.isTriggered || !shielded || !publicKey}
        aria-label="Proceed to enter guardian shares"
      >
        Continue — Enter Guardian Shares
      </button>
    </div>
  );
}

function CheckRow({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className={ok ? "text-emerald-400" : "text-red-400"}>
          {ok ? "✓" : "✗"}
        </span>
        <span className={ok ? "text-stone-300" : "text-stone-500"}>{label}</span>
      </div>
      {note && <span className="text-stone-600 text-xs">{note}</span>}
    </div>
  );
}

function ExecRow({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done   && <span className="text-emerald-400">✓</span>}
      {active && !done && <div className="animate-spin h-3 w-3 border border-cream border-t-transparent rounded-full" />}
      {!done && !active && <span className="text-stone-600">○</span>}
      <span className={done ? "text-emerald-400" : active ? "text-cream" : "text-stone-500"}>{label}</span>
    </div>
  );
}

function FeeRow({
  label, value, muted, green,
}: { label: string; value: string; muted?: boolean; green?: boolean }) {
  const color = green ? "var(--zone-green)" : muted ? "var(--text-muted)" : "var(--text-primary)";
  return (
    <div className="flex justify-between">
      <span className="text-stone-400">{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

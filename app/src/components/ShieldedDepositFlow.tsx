"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  buildRecordCloakDepositIx,
  sendAndConfirmLegacyTx,
  computeCloakFee,
  isAboveMinDeposit,
  MIN_DEPOSIT_LAMPORTS,
} from "@legacy-protocol/sdk";
import {
  depositToShieldedVault,
} from "@legacy-protocol/cloak-integration";
import { PublicKey } from "@solana/web3.js";

const CLOAK_PROGRAM_ID = process.env.NEXT_PUBLIC_CLOAK_PROGRAM_ID
  ? new PublicKey(process.env.NEXT_PUBLIC_CLOAK_PROGRAM_ID)
  : undefined;
const CLOAK_RELAY_URL = process.env.NEXT_PUBLIC_CLOAK_RELAY_URL ?? "https://api.cloak.ag";
import { PROGRAM_ID } from "@/lib/sdk";
import { explorerTxUrl } from "@/lib/format";
import type { UtxoIdentity } from "@legacy-protocol/cloak-integration";

interface Props {
  vaultPda:           string;
  ownerUtxoIdentity:  UtxoIdentity;
  onComplete:         () => void;
}

type Step = "amount" | "shielding" | "recording" | "done";

const LAMPORTS_PER_SOL = 1_000_000_000n;

function fmtSol(l: bigint): string {
  return (Number(l) / Number(LAMPORTS_PER_SOL)).toFixed(4) + " SOL";
}

export function ShieldedDepositFlow({ vaultPda, ownerUtxoIdentity, onComplete }: Props) {
  const { publicKey, signTransaction, signMessage } = useWallet();
  const { connection } = useConnection();

  const [step,      setStep]      = useState<Step>("amount");
  const [solInput,  setSolInput]  = useState("");
  const [error,     setError]     = useState<string | null>(null);
  const [cloakSig,  setCloakSig]  = useState<string | null>(null);
  const [anchorSig, setAnchorSig] = useState<string | null>(null);
  const [proofMs,   setProofMs]   = useState<number | null>(null);

  const lamports: bigint = (() => {
    const n = parseFloat(solInput);
    if (isNaN(n) || n <= 0) return 0n;
    return BigInt(Math.floor(n * Number(LAMPORTS_PER_SOL)));
  })();

  const feeBreak = lamports > 0n ? computeCloakFee(lamports) : null;
  const meetsMin = lamports >= MIN_DEPOSIT_LAMPORTS;

  async function handleShield() {
    if (!publicKey || !signTransaction) return;
    if (!meetsMin) { setError(`Minimum deposit is ${fmtSol(BigInt(MIN_DEPOSIT_LAMPORTS))}`); return; }
    setError(null);
    setStep("shielding");

    try {
      const proofStart = Date.now();

      // Pass the connected wallet adapter — it signs the Cloak Solana
      // transaction and pays the transaction fee. No raw secret key is
      // used or required for the Solana transaction layer.
      const result = await depositToShieldedVault({
        ownerUtxo:      ownerUtxoIdentity,
        ownerWallet:    { publicKey, signTransaction, signMessage },
        amountLamports: lamports,
        connection,
        programId:      CLOAK_PROGRAM_ID,
        relayUrl:       CLOAK_RELAY_URL,
      });

      setProofMs(Date.now() - proofStart);
      setCloakSig(result.cloakSignature);
      setStep("recording");

      const vaultPk = new PublicKey(vaultPda);
      const ix = buildRecordCloakDepositIx({
        programId:        PROGRAM_ID,
        owner:            publicKey,
        vaultPda:         vaultPk,
        utxoCommitment:   result.utxoCommitment,
        utxoLeafIndex:    result.utxoLeafIndex,
        shieldedLamports: lamports,
      });

      const { signature } = await sendAndConfirmLegacyTx(
        connection,
        { publicKey, signTransaction } as any,
        [ix],
      );

      setAnchorSig(signature);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Shield transaction failed");
      setStep("amount");
    }
  }

  if (step === "done") {
    return (
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔒</span>
          <h2 className="font-display text-xl text-cream">Assets Shielded Successfully</h2>
        </div>
        <p className="text-emerald-400 text-sm font-medium">
          ✓ Your assets are now invisible on all block explorers
        </p>
        {proofMs !== null && (
          <p className="text-stone-400 text-xs">Proof generated in {proofMs}ms</p>
        )}
        <div className="space-y-2">
          {cloakSig && (
            <div>
              <p className="label">Cloak transaction</p>
              {/* explorerTxUrl() appends ?cluster=devnet when NEXT_PUBLIC_SOLANA_CLUSTER=devnet,
                  ensuring the link resolves on the correct network in all environments. */}
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
              <p className="label">Vault record transaction</p>
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

  if (step === "shielding" || step === "recording") {
    return (
      <div className="card space-y-4">
        <h2 className="font-display text-xl text-cream">Shielding Assets…</h2>
        <div className="flex flex-col gap-2">
          <StatusRow
            label="Generating zero-knowledge proof"
            done={step === "recording"}
            active={step === "shielding"}
          />
          {proofMs !== null && step === "recording" && (
            <p className="text-stone-400 text-xs pl-6">Proof generated in {proofMs}ms</p>
          )}
          <StatusRow
            label="Recording shielded deposit on-chain"
            done={false}
            active={step === "recording"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-5">
      <h2 className="font-display text-xl text-cream">Shield SOL</h2>
      <p className="text-stone-400 text-sm">
        Assets deposited here will not appear on any block explorer.
        Your balance becomes private — only you can see it.
      </p>

      <div>
        <label className="label mb-1 block">Amount (SOL)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={solInput}
          onChange={(e) => { setSolInput(e.target.value); setError(null); }}
          placeholder="0.00"
          className="input w-full"
          aria-label="SOL amount to shield"
        />
      </div>

      {feeBreak && (
        <div
          className="rounded-lg p-3 space-y-1 text-sm"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
        >
          <FeeRow label="Depositing"   value={fmtSol(lamports)}        color="var(--text-primary)" />
          <FeeRow label="Protocol fee" value={fmtSol(feeBreak.total)}  color="var(--text-muted)" />
          <FeeRow label="Net shielded" value={fmtSol(feeBreak.net)}    color="var(--zone-green)" />
        </div>
      )}

      {!meetsMin && lamports > 0n && (
        <p className="text-amber-400 text-xs">
          Minimum deposit is {fmtSol(BigInt(MIN_DEPOSIT_LAMPORTS))} (0.01 SOL)
        </p>
      )}

      <div
        className="rounded-lg px-3 py-2 text-xs"
        style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}
      >
        <span className="text-emerald-400">🔒 Privacy notice:</span>
        <span className="text-stone-400 ml-1">
          This amount will NOT appear on any block explorer after shielding.
          Your balance is completely private.
        </span>
      </div>

      {error && (
        <p role="alert" className="text-red-400 text-sm">{error}</p>
      )}

      <button
        className="btn-primary w-full"
        onClick={() => { void handleShield(); }}
        disabled={!meetsMin || !publicKey || !signTransaction || !signMessage}
        aria-label="Shield SOL into Cloak shielded pool"
      >
        Shield SOL
      </button>
    </div>
  );
}

function StatusRow({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done  && <span className="text-emerald-400">✓</span>}
      {active && !done && <Spinner />}
      {!done && !active && <span className="text-stone-600">○</span>}
      <span className={done ? "text-emerald-400" : active ? "text-cream" : "text-stone-500"}>
        {label}
      </span>
    </div>
  );
}

function FeeRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3 text-cream" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

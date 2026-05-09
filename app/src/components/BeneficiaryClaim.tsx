"use client";

// BeneficiaryClaim.tsx
//
// Shielded inheritance claim flow for beneficiaries.
// The beneficiary imports their Cloak UTXO identity (either from an
// encrypted backup file or by pasting the raw base64 private key),
// scans the Cloak shielded pool with the derived viewing key,
// withdraws found UTXOs to a destination wallet, and optionally
// generates a cryptographic compliance proof of receipt.
//
// Security fix: identity is held in a useRef rather than useState so the
// UtxoIdentity.privateKey bytes never appear in the React state tree,
// DevTools snapshots, or any memory dump of component state.
// A companion boolean state (hasIdentity) drives conditional renders
// without exposing the key. The private key is explicitly zeroed via
// fill(0) before the ref is cleared in every code path including unmount.

import React, { useState, useRef, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  importBeneficiaryIdentity,
  claimInheritanceToWallet,
  generateComplianceProof,
} from "@legacy-protocol/cloak-integration";
import type { UtxoIdentity } from "@legacy-protocol/cloak-integration";
import type { ComplianceProof } from "@legacy-protocol/cloak-integration";
// scanTransactions reads the shielded pool using the viewing key.
// getNkFromUtxoPrivateKey derives the read-only viewing key from the 32-byte spending key.
// CLOAK_PROGRAM_ID is the deployed Cloak program address.
import {
  scanTransactions,
  getNkFromUtxoPrivateKey,
  CLOAK_PROGRAM_ID,
} from "@legacy-protocol/sdk";
import { formatSol, explorerTxUrl } from "@/lib/format";

interface Props {
  /** Pre-fill: if provided, skip Step 1 and go straight to scanning. */
  vaultPda?: string;
}

type Step = "import" | "scanning" | "withdraw" | "withdrawing" | "proof" | "done";

const LAMPORTS_PER_SOL = 1_000_000_000n;

function fmtSol(l: bigint): string {
  return (Number(l) / Number(LAMPORTS_PER_SOL)).toFixed(4) + " SOL";
}

export function BeneficiaryClaim({ vaultPda }: Props) {
  // signMessage is required by ClaimWalletAdapter — fullWithdraw() uses
  // signMessage (not signTransaction) per the @cloak.dev/sdk wallet-adapter
  // documentation for the browser withdrawal path.
  const { publicKey, signMessage } = useWallet();
  const { connection } = useConnection();

  const [step,          setStep]          = useState<Step>("import");
  // identity is held in a ref — NOT state — so UtxoIdentity.privateKey bytes
  // never appear in the React state tree, DevTools, or memory snapshots.
  // hasIdentity is the boolean state that drives conditional renders.
  const identityRef = useRef<UtxoIdentity | null>(null);
  const [hasIdentity, setHasIdentity] = useState(false);

  const [password,      setPassword]      = useState("");
  const [manualKey,     setManualKey]     = useState("");
  const [inputMode,     setInputMode]     = useState<"backup" | "manual">("backup");
  const [error,         setError]         = useState<string | null>(null);
  const [scanning,      setScanning]      = useState(false);
  const [utxos,         setUtxos]         = useState<any[]>([]);
  const [receivedTotal, setReceivedTotal] = useState<bigint>(0n);
  const [destWallet,    setDestWallet]    = useState("");
  const [withdrawSig,   setWithdrawSig]   = useState<string | null>(null);
  const [proof,         setProof]         = useState<ComplianceProof | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Zero and clear the identity ref on unmount so the private key bytes
  // cannot be recovered from freed memory by GC after this component
  // is removed from the tree.
  useEffect(() => {
    return () => {
      if (identityRef.current) {
        identityRef.current.privateKey.fill(0);
        identityRef.current = null;
      }
    };
  }, []);

  function storeIdentity(id: UtxoIdentity) {
    identityRef.current = id;
    setHasIdentity(true);
  }

  function clearIdentity() {
    if (identityRef.current) {
      identityRef.current.privateKey.fill(0);
      identityRef.current = null;
    }
    setHasIdentity(false);
  }

  // ── Step 1: Import identity ───────────────────────────────────────────────

  async function handleImportFromBackup(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const id   = await importBeneficiaryIdentity(text, password);
      storeIdentity(id);
      await doScan(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  // handleImportManual is async so that doScan() is properly awaited.
  // Leaving doScan() unawaited would create a floating Promise — errors from
  // the scan phase would be silently swallowed instead of surfaced to the UI.
  async function handleImportManual() {
    setError(null);
    if (!manualKey.trim()) { setError("Enter your private key"); return; }
    try {
      const bytes = new Uint8Array(
        Buffer.from(manualKey.trim(), "base64"),
      );
      if (bytes.length !== 32) {
        setError("Private key must be 32 bytes (base64-encoded)");
        return;
      }
      const bytesToBigint = (arr: Uint8Array): bigint => arr.reduce((r, b) => (r << 8n) | BigInt(b), 0n);
      const bigintToBytes32 = (v: bigint): Uint8Array => { const b = new Uint8Array(32); let val = v; for (let i = 31; i >= 0; i--) { b[i] = Number(val & 0xffn); val >>= 8n; } return b; };
      const viewingKeyNk = bigintToBytes32(getNkFromUtxoPrivateKey(bytesToBigint(bytes)) as unknown as bigint);
      const id: UtxoIdentity = {
        privateKey:   bytes,
        publicKey:    new Uint8Array(32), // not needed for scanning or withdrawal
        viewingKeyNk,
      };
      storeIdentity(id);
      await doScan(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid key");
    }
  }

  // ── Step 2: Scan for UTXOs ────────────────────────────────────────────────

  async function doScan(id: UtxoIdentity) {
    setScanning(true);
    setStep("scanning");
    setError(null);
    try {
      const viewingKeyNk = id.viewingKeyNk;
      // CLOAK_PROGRAM_ID targets the correct deployed Cloak program.
      // Imported from @legacy-protocol/sdk which re-exports from @cloak.dev/sdk.
      const scan = await scanTransactions({
        connection,
        programId:    CLOAK_PROGRAM_ID,
        viewingKeyNk,
        limit:        250,
      });

      const unspent = ((scan as any).utxos ?? []).filter(
        (u: any) => !u.spent && BigInt(u.amount ?? 0n) > 0n,
      );

      setUtxos(unspent);
      const total = unspent.reduce(
        (sum: bigint, u: any) => sum + BigInt(u.amount ?? 0n),
        0n,
      );
      setReceivedTotal(total);
      // Default destination to the currently connected wallet (if any).
      setDestWallet(publicKey?.toBase58() ?? "");
      setStep("withdraw");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setStep("import");
    } finally {
      setScanning(false);
    }
  }

  // ── Step 3: Withdraw to wallet ────────────────────────────────────────────

  async function handleWithdraw() {
    if (!identityRef.current) return;
    if (!destWallet.trim()) { setError("Enter destination wallet"); return; }
    if (!publicKey || !signMessage) {
      setError("Connect your wallet to sign the withdrawal authorisation");
      return;
    }
    setError(null);
    setStep("withdrawing");
    try {
      // Pass a copy of identity.privateKey — claimInheritanceToWallet zeros
      // the Uint8Array it receives in its finally block as a security measure.
      // Passing the original reference would zero identityRef.current.privateKey here,
      // making the subsequent generateComplianceProof call fail (it derives
      // the viewing key from the same private key to scan for received UTXOs).
      // A slice() copy ensures the original survives intact for the proof step.
      //
      // recipientWallet is passed explicitly so the withdrawal is directed to
      // the user-supplied destination — which may differ from publicKey when
      // the beneficiary wants to send to a cold-storage address.
      //
      // ClaimWalletAdapter requires signMessage (not signTransaction) — the
      // fullWithdraw() Cloak SDK function uses signMessage for browser-wallet
      // withdrawal authorisation per the documented wallet-adapter path.
      const result = await claimInheritanceToWallet({
        beneficiaryUtxoPrivateKey: identityRef.current.privateKey.slice(),
        beneficiaryWallet:         { publicKey, signMessage },
        recipientWallet:           destWallet.trim(),
        connection,
      });
      setWithdrawSig(result.signature);
      setStep("proof");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
      setStep("withdraw");
    }
  }

  // ── Step 4: Generate compliance proof ────────────────────────────────────

  async function handleGenerateProof() {
    if (!identityRef.current) {
      setError("Identity key is no longer available. Restart the claim flow.");
      return;
    }
    setError(null);
    try {
      // Pass the private key directly — generateComplianceProof zeros it
      // in its own finally block per the cloak-integration contract.
      const p = await generateComplianceProof({
        beneficiaryUtxoPrivateKey: identityRef.current.privateKey,
        connection,
      });
      setProof(p);

      const date     = new Date().toISOString().slice(0, 10);
      const filename = `inheritance-proof-${date}.json`;
      const blob     = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement("a");
      a.href         = url;
      a.download     = filename;
      a.click();
      URL.revokeObjectURL(url);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proof generation failed");
    } finally {
      // After proof generation, generateComplianceProof has zeroed the private
      // key bytes in its own finally block. Always clear the ref here — in
      // every code path including error — so the UtxoIdentity object is
      // released and hasIdentity is correctly reset to false.
      clearIdentity();
    }
  }

  function handleSkipProof() {
    // Zero and clear the private key — no proof path means no further need.
    clearIdentity();
    setStep("done");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✅</span>
          <h2 className="font-display text-xl text-cream">Inheritance Complete</h2>
        </div>
        <p className="text-emerald-400 text-sm">
          ✓ Assets withdrawn to your wallet.
        </p>
        <p className="text-stone-400 text-sm">
          {proof
            ? "Your compliance proof has been downloaded. It proves you received the inheritance without revealing the amounts to anyone who does not hold your viewing key."
            : "Transfer is complete. You can generate a compliance proof at any time while you still have your beneficiary private key."}
        </p>
        {withdrawSig && (
          <div>
            <p className="label text-xs">Withdrawal signature</p>
            <a
              href={explorerTxUrl(withdrawSig)}
              target="_blank"
              rel="noopener noreferrer"
              className="address text-xs break-all hover:underline"
            >
              {withdrawSig}
            </a>
          </div>
        )}

        <div
          className="rounded-lg p-3 text-xs text-stone-400"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
        >
          <p className="text-emerald-400 font-medium mb-1">What this proof contains:</p>
          <p>
            A cryptographically verifiable record that you received this inheritance — showing when
            and from which shielded pool — without revealing amounts to anyone but authorized viewers.
          </p>
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        {hasIdentity && !proof && (
          <button className="btn-primary w-full" onClick={() => void handleGenerateProof()}>
            Generate Proof of Inheritance
          </button>
        )}
      </div>
    );
  }

  if (step === "withdrawing") {
    return (
      <div className="card space-y-4">
        <h2 className="font-display text-xl text-cream">Withdrawing…</h2>
        <div className="flex items-center gap-2">
          <div className="animate-spin h-4 w-4 border-2 border-cream border-t-transparent rounded-full" />
          <span className="text-stone-400 text-sm">Generating zero-knowledge proof for withdrawal…</span>
        </div>
      </div>
    );
  }

  if (step === "scanning") {
    return (
      <div className="card space-y-4">
        <h2 className="font-display text-xl text-cream">Scanning for Inheritance…</h2>
        <div className="flex items-center gap-2">
          <div className="animate-spin h-4 w-4 border-2 border-cream border-t-transparent rounded-full" />
          <span className="text-stone-400 text-sm">Scanning Cloak shielded pool with your viewing key…</span>
        </div>
        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
      </div>
    );
  }

  if (step === "proof") {
    return (
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✓</span>
          <h2 className="font-display text-xl text-cream">Withdrawal Complete</h2>
        </div>
        <p className="text-emerald-400 text-sm">
          Assets have been sent to your destination wallet.
        </p>
        {withdrawSig && (
          <div>
            <p className="label text-xs">Transaction signature</p>
            <a
              href={explorerTxUrl(withdrawSig)}
              target="_blank"
              rel="noopener noreferrer"
              className="address text-xs break-all hover:underline"
            >
              {withdrawSig}
            </a>
          </div>
        )}

        <div
          className="rounded-lg p-3 text-xs text-stone-400"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
        >
          <p className="text-emerald-400 font-medium mb-1">Optional: Compliance Proof</p>
          <p>
            Generate a cryptographically verifiable record of this inheritance transfer.
            Useful for legal or tax purposes. Only viewable by holders of your viewing key.
          </p>
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button className="btn-primary w-full" onClick={() => void handleGenerateProof()}>
          Generate Proof of Inheritance
        </button>
        <button className="btn-secondary w-full" onClick={handleSkipProof}>
          Skip Proof
        </button>
      </div>
    );
  }

  if (step === "withdraw") {
    return (
      <div className="card space-y-5">
        <div>
          <h2 className="font-display text-xl text-cream mb-1">Inheritance Found</h2>
          {utxos.length > 0 ? (
            <p className="text-stone-400 text-sm">
              Found <strong className="text-cream">{fmtSol(receivedTotal)}</strong> in {utxos.length}{" "}
              shielded UTXO{utxos.length !== 1 ? "s" : ""}.
              {vaultPda && (
                <>
                  {" "}Inheritance from vault{" "}
                  <span className="address text-xs">
                    {vaultPda.slice(0, 6)}…{vaultPda.slice(-4)}
                  </span>.
                </>
              )}
            </p>
          ) : (
            <p className="text-amber-400 text-sm">
              No unspent UTXOs found. The guardian transfer may not have completed yet.
            </p>
          )}
        </div>

        {utxos.length > 0 && (
          <>
            <div>
              <label className="label block mb-1">Destination Wallet</label>
              <input
                type="text"
                className="input font-mono text-sm w-full"
                placeholder="Solana wallet address"
                value={destWallet}
                onChange={(e) => { setDestWallet(e.target.value); setError(null); }}
                aria-label="Destination wallet address for withdrawal"
              />
              <p className="text-stone-600 text-xs mt-1">
                Defaults to connected wallet. Can be any valid Solana address.
              </p>
            </div>

            {!publicKey && (
              <p className="text-amber-400 text-xs">
                Connect your wallet to sign the withdrawal authorisation.
              </p>
            )}

            {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

            <button
              className="btn-primary w-full"
              onClick={() => void handleWithdraw()}
              disabled={!destWallet.trim() || !publicKey || !signMessage}
              aria-label="Withdraw inherited assets to wallet"
            >
              Withdraw {fmtSol(receivedTotal)} to Wallet
            </button>
          </>
        )}

        <button className="btn-secondary text-sm" onClick={() => setStep("import")}>
          ← Back
        </button>
      </div>
    );
  }

  // step === "import"
  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-display text-xl text-cream mb-1">Claim Shielded Inheritance</h2>
        <p className="text-stone-400 text-sm">
          Import your beneficiary identity to scan for and claim your inheritance
          from the Cloak shielded pool.
        </p>
      </div>

      <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <button
          className="flex-1 py-2 text-sm transition-colors"
          style={{
            background:  inputMode === "backup" ? "rgba(255,255,255,0.08)" : "transparent",
            color:       inputMode === "backup" ? "var(--text-primary)" : "var(--text-muted)",
            borderRight: "1px solid var(--border)",
          }}
          onClick={() => setInputMode("backup")}
        >
          Encrypted Backup
        </button>
        <button
          className="flex-1 py-2 text-sm transition-colors"
          style={{
            background: inputMode === "manual" ? "rgba(255,255,255,0.08)" : "transparent",
            color:      inputMode === "manual" ? "var(--text-primary)" : "var(--text-muted)",
          }}
          onClick={() => setInputMode("manual")}
        >
          Manual Key Entry
        </button>
      </div>

      {inputMode === "backup" && (
        <div className="space-y-3">
          <div>
            <label className="label block mb-1">Backup Password</label>
            <input
              type="password"
              className="input w-full"
              placeholder="Password used when backing up"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              aria-label="Backup decryption password"
            />
          </div>
          <div>
            <label className="label block mb-1">Backup File (.json)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  // handleImportFromBackup handles all errors internally —
                  // void prevents the floating Promise lint warning.
                  void handleImportFromBackup(f);
                }
              }}
            />
            <button
              className="btn-primary w-full"
              onClick={() => fileRef.current?.click()}
              disabled={!password}
              aria-label="Load encrypted backup file"
            >
              Load Encrypted Backup
            </button>
          </div>
        </div>
      )}

      {inputMode === "manual" && (
        <div className="space-y-3">
          <div>
            <label className="label block mb-1">Private Key (base64)</label>
            <textarea
              className="input w-full font-mono text-xs"
              rows={3}
              placeholder="Paste your 32-byte private key as base64…"
              value={manualKey}
              onChange={(e) => { setManualKey(e.target.value); setError(null); }}
              autoComplete="off"
              spellCheck={false}
              aria-label="Private key base64 input"
            />
          </div>
          <button
            className="btn-primary w-full"
            onClick={() => void handleImportManual()}
            disabled={!manualKey.trim()}
          >
            Use This Key
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}

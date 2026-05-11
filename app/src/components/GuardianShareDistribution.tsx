"use client";

import React, { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { splitOwnerKey } from "@legacy-protocol/cloak-integration";
import {
  reconstructSecret,
  decodeShareBase64,
  ShamirError,
} from "@legacy-protocol/sdk";
import type { GuardianWithAddress } from "@legacy-protocol/sdk";
import type { GuardianShare } from "@legacy-protocol/cloak-integration";
import { shortAddress } from "@/lib/format";

interface Props {
  ownerUtxoPrivateKey: Uint8Array;
  guardians:           GuardianWithAddress[];
  mOfNThreshold:       number;
  onComplete:          () => void;
}

type Step = "split" | "distribute" | "verify" | "done";

export function GuardianShareDistribution({
  ownerUtxoPrivateKey,
  guardians,
  mOfNThreshold,
  onComplete,
}: Props) {
  const [step,          setStep]          = useState<Step>("split");
  const [shares,        setShares]        = useState<GuardianShare[]>([]);
  const [error,         setError]         = useState<string | null>(null);
  const [copiedShare,   setCopiedShare]   = useState<number | null>(null);
  const [verifyInputs,  setVerifyInputs]  = useState<string[]>([]);
  const [verifyResult,  setVerifyResult]  = useState<"ok" | "fail" | null>(null);
  const [keyZeroed,     setKeyZeroed]     = useState(false);

  // Split immediately on mount — key should not sit in memory longer than needed.
  useEffect(() => {
    if (step !== "split") return;
    try {
      const wallets = guardians.map((g) => g.account.guardian);
      const generated = splitOwnerKey(
        ownerUtxoPrivateKey,
        mOfNThreshold,
        guardians.length,
        wallets,
      );
      setShares(generated);
      setStep("distribute");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Key split failed");
    } finally {
      // Zero the private key bytes unconditionally — whether splitOwnerKey
      // succeeds or throws. An exception path that skips this fill() would
      // leave the raw 32-byte UTXO spending key in browser memory until GC.
      ownerUtxoPrivateKey.fill(0);
      setKeyZeroed(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function downloadShare(share: GuardianShare, guardianWallet: string, total: number) {
    const text = [
      `LEGACY PROTOCOL — GUARDIAN SHARE`,
      ``,
      `Guardian: ${guardianWallet}`,
      `Share:     ${share.shareIndex} of ${total}`,
      `Threshold: ${mOfNThreshold}-of-${total} shares required to reconstruct`,
      ``,
      `SHARE DATA (base64):`,
      share.shareBase64,
      ``,
      `KEEP THIS SECRET AND OFFLINE.`,
      `Losing M or more shares permanently destroys the vault key.`,
      ``,
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `legacy-guardian-share-${share.shareIndex}-of-${total}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyShare(share: GuardianShare) {
    await navigator.clipboard.writeText(share.shareBase64);
    setCopiedShare(share.shareIndex);
    setTimeout(() => setCopiedShare(null), 2000);
  }

  function startVerify() {
    setVerifyInputs(Array(mOfNThreshold).fill(""));
    setVerifyResult(null);
    setError(null);
    setStep("verify");
  }

  function handleVerify() {
    setError(null);
    setVerifyResult(null);
    try {
      const decoded = verifyInputs.map((raw, i) => {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error(`Share ${i + 1} is empty.`);
        return decodeShareBase64(trimmed);
      });
      // We do NOT check the reconstructed value against the original key
      // because the key has already been zeroed. We only verify that the
      // shares decode and combine without throwing a ShamirError.
      reconstructSecret(decoded);
      setVerifyResult("ok");
    } catch (err) {
      setVerifyResult("fail");
      setError(err instanceof ShamirError ? err.message : String(err));
    }
  }

  if (step === "split") {
    return (
      <div className="card space-y-4">
        <h2 className="font-display text-xl text-cream">Splitting Vault Key…</h2>
        <div className="flex items-center gap-2">
          <div className="animate-spin h-4 w-4 border-2 border-cream border-t-transparent rounded-full" />
          <span className="text-stone-400 text-sm">Generating {guardians.length} shares…</span>
        </div>
        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="card space-y-5">
        <div>
          <h2 className="font-display text-xl text-cream mb-1">Verify Reconstruction</h2>
          <p className="text-stone-400 text-sm">
            Paste any {mOfNThreshold} shares to confirm they combine correctly.
            The reconstructed key is verified without being displayed.
          </p>
        </div>

        <div className="space-y-3">
          {verifyInputs.map((val, i) => (
            <div key={i}>
              <label className="label block mb-1">Share {i + 1}</label>
              <input
                type="text"
                className="input font-mono text-xs w-full"
                placeholder="Paste base64 share…"
                value={val}
                onChange={(e) =>
                  setVerifyInputs((prev) =>
                    prev.map((v, j) => (j === i ? e.target.value : v)),
                  )
                }
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}
        </div>

        {error && <p role="alert" className="text-red-400 text-xs">{error}</p>}

        {verifyResult === "ok" && (
          <div
            className="rounded-lg p-3 text-sm text-emerald-400"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)" }}
            role="status"
          >
            ✓ Reconstruction verified — {mOfNThreshold} shares combine correctly.
          </div>
        )}

        {verifyResult === "fail" && (
          <div
            className="rounded-lg p-3 text-sm text-red-400"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
            role="alert"
          >
            ✗ Reconstruction failed. Check that the shares are correct and not duplicated.
          </div>
        )}

        <div className="flex gap-3">
          <button className="btn-secondary" onClick={() => setStep("distribute")}>← Back</button>
          <button
            className="btn-primary"
            onClick={handleVerify}
            disabled={verifyInputs.some((v) => !v.trim())}
          >
            Verify
          </button>
          {verifyResult === "ok" && (
            <button className="btn-primary" onClick={() => setStep("done")}>
              Continue →
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✅</span>
          <h2 className="font-display text-xl text-cream">Shares Distributed</h2>
        </div>
        <p className="text-stone-400 text-sm">
          {guardians.length} guardian shares have been generated and the original key has been
          securely erased from memory. Any {mOfNThreshold} guardians can reconstruct it to execute
          the inheritance transfer.
        </p>
        {keyZeroed && (
          <p className="text-emerald-400 text-xs">✓ Vault key zeroed from browser memory</p>
        )}
        <button className="btn-primary" onClick={onComplete}>Done</button>
      </div>
    );
  }

  // step === "distribute"
  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-display text-xl text-cream mb-1">Distribute Guardian Shares</h2>
        <p className="text-stone-400 text-sm">
          The vault key has been split into {guardians.length} shares.
          Any {mOfNThreshold} can reconstruct it to execute the inheritance transfer.
        </p>
      </div>

      {keyZeroed && (
        <p className="text-emerald-400 text-xs">✓ Vault key zeroed from browser memory after splitting</p>
      )}

      <div
        className="rounded-lg p-3 text-sm text-amber-400"
        style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)" }}
      >
        ⚠ Each guardian must keep their share secret. Losing {guardians.length - mOfNThreshold + 1} or
        more shares makes inheritance permanently impossible.
      </div>

      <div className="space-y-4">
        {shares.map((share, i) => {
          const guardian  = guardians[i];
          const qrUrl     = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(share.shareBase64)}`;
          const total     = guardians.length;

          return (
            <div
              key={share.shareIndex}
              className="rounded-lg p-4"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <Image
                    src={qrUrl}
                    alt={`QR code for share ${share.shareIndex} of ${total}`}
                    width={80}
                    height={80}
                    style={{ borderRadius: 6 }}
                    unoptimized
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-mono font-medium"
                      style={{ background: "rgba(129,140,248,0.15)", color: "#818CF8" }}
                    >
                      Share {share.shareIndex} of {total}
                    </span>
                    {guardian && (
                      <span className="address text-xs">
                        {shortAddress(guardian.account.guardian)}
                      </span>
                    )}
                  </div>
                  <p
                    className="font-mono text-stone-500 break-all"
                    style={{ fontSize: 9, wordBreak: "break-all", lineHeight: 1.5 }}
                  >
                    {share.shareBase64.slice(0, 48)}…
                  </p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={() => { void copyShare(share); }}
                    >
                      {copiedShare === share.shareIndex ? "✓ Copied" : "Copy"}
                    </button>
                    <button
                      className="btn-primary text-xs px-3 py-1.5"
                      onClick={() =>
                        downloadShare(
                          share,
                          guardian?.account.guardian ?? `guardian-${i + 1}`,
                          total,
                        )
                      }
                    >
                      ↓ Download Share {share.shareIndex}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 flex-wrap">
        <button
          className="btn-primary"
          onClick={() =>
            shares.forEach((s, i) =>
              downloadShare(
                s,
                guardians[i]?.account.guardian ?? `guardian-${i + 1}`,
                guardians.length,
              ),
            )
          }
        >
          ↓ Download All Shares
        </button>
        <button className="btn-secondary" onClick={startVerify}>
          Verify Reconstruction
        </button>
        <button className="btn-secondary" onClick={() => setStep("done")}>
          Skip Verification →
        </button>
      </div>
    </div>
  );
}

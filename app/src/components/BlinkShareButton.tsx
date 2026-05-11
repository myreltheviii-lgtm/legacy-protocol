"use client";

import React, { useState } from "react";
import { buildVaultBlinkUrls } from "@legacy-protocol/sdk";
import { useToast } from "@/components/ToastProvider";

interface BlinkShareButtonProps {
  action:       "checkIn" | "trigger" | "claim";
  vaultAddress: string;
  label?:       string;
}

export function BlinkShareButton({ action, vaultAddress, label }: BlinkShareButtonProps) {
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);

  function getAppBaseUrl(): string {
    if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }

  function getBlinkUrl(): string {
    const base = getAppBaseUrl();
    if (!base) return "";
    const urls = buildVaultBlinkUrls(base, vaultAddress);
    if (action === "checkIn") return urls.checkIn;
    if (action === "trigger") return urls.trigger;
    return urls.claim;
  }

  const actionLabel =
    action === "checkIn" ? "Check-In" :
    action === "trigger" ? "Trigger"  :
    "Claim";

  async function handleCopy() {
    const url = getBlinkUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      addToast({
        type:     "success",
        title:    "Blink URL copied",
        message:  `${actionLabel} link copied to clipboard`,
        duration: 3000,
      });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      addToast({
        type:     "error",
        title:    "Copy failed",
        message:  "Could not access clipboard",
        duration: 5000,
      });
    }
  }

  return (
    <button
      onClick={handleCopy}
      aria-label={`Copy ${action} Blink URL for sharing`}
      title={`Share ${actionLabel} Blink URL`}
      className="btn-secondary"
      style={{ fontSize: 12, padding: "6px 12px" }}
    >
      {copied ? "✓ Copied" : (label ?? "🔗 Share")}
    </button>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { ActivityZone } from "@legacy-protocol/sdk";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface NotificationPermissionBannerProps {
  vaultAddress: string;
  zone:         ActivityZone;
}

export function NotificationPermissionBanner({ vaultAddress, zone }: NotificationPermissionBannerProps) {
  const { permission, requestPermission } = usePushNotifications();
  const [dismissed,  setDismissed]  = useState(false);
  const [requesting, setRequesting] = useState(false);

  const storageKey = `notification-dismissed-${vaultAddress}`;

  useEffect(() => {
    try {
      if (typeof sessionStorage !== "undefined") {
        setDismissed(sessionStorage.getItem(storageKey) === "true");
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  const shouldShow =
    !dismissed &&
    permission !== "granted" &&
    permission !== "denied" &&
    (zone === ActivityZone.Yellow || zone === ActivityZone.Orange || zone === ActivityZone.Red);

  if (!shouldShow) return null;

  function handleDismiss() {
    setDismissed(true);
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(storageKey, "true");
      }
    } catch { /* ignore */ }
  }

  async function handleEnable() {
    setRequesting(true);
    try {
      await requestPermission();
    } catch { /* ignore — permission request failure is non-critical */ }
    setRequesting(false);
    handleDismiss();
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg text-sm animate-slide-up"
      style={{
        background: "rgba(234,179,8,0.08)",
        border:     "1px solid rgba(234,179,8,0.3)",
      }}
    >
      <p className="text-stone-300 text-xs flex-1">
        🔔 Enable notifications to be alerted when this vault needs attention.
      </p>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          className="btn-secondary text-xs px-3 py-1.5"
          onClick={() => { void handleEnable(); }}
          disabled={requesting}
          aria-label="Enable browser push notifications for this vault"
        >
          {requesting ? "…" : "Enable"}
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss notification prompt"
          style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: "4px 8px" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

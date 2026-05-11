"use client";

import React, { useState, useEffect } from "react";
import { usePWAInstall } from "@/hooks/usePWAInstall";

const DISMISSED_KEY = "pwa-install-dismissed";

export function PWAInstallBanner() {
  const { canInstall, install } = usePWAInstall();
  const [dismissed,  setDismissed]  = useState(true);
  const [isMobile,   setIsMobile]   = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        setDismissed(localStorage.getItem(DISMISSED_KEY) === "true");
      } else {
        setDismissed(false);
      }
    } catch {
      setDismissed(false);
    }

    setIsMobile(
      window.innerWidth < 768 ||
      /Mobile|Android|iPhone|iPad/.test(navigator.userAgent),
    );
  }, []);

  const shouldShow = canInstall && !dismissed && isMobile;

  if (!shouldShow) return null;

  function handleDismiss() {
    setDismissed(true);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(DISMISSED_KEY, "true");
      }
    } catch { /* ignore */ }
  }

  async function handleInstall() {
    setInstalling(true);
    try {
      await install();
    } catch { /* ignore — install() failure is non-critical */ }
    setInstalling(false);
  }

  return (
    <div
      role="banner"
      aria-label="Install Legacy Protocol as an app"
      style={{
        position:        "fixed",
        bottom:          0,
        left:            0,
        right:           0,
        zIndex:          9998,
        background:      "var(--bg-elevated)",
        borderTop:       "1px solid var(--border)",
        padding:         "12px 20px",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "space-between",
        gap:             12,
      }}
      className="animate-slide-up"
    >
      <p className="text-stone-300 text-sm flex-1">
        📱 Install Legacy Protocol as an app
      </p>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          className="btn-primary text-sm"
          onClick={() => { void handleInstall(); }}
          disabled={installing}
          aria-label="Install Legacy Protocol as a PWA"
        >
          {installing ? "…" : "Install"}
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
          style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: "4px 8px" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

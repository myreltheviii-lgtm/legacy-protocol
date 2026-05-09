"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from "react";
import { explorerTxUrl } from "@/lib/format";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id:       string;
  type:     ToastType;
  title:    string;
  message?: string;
  txSig?:   string;
  duration: number;
}

type ToastAction =
  | { type: "ADD";    toast: Toast }
  | { type: "REMOVE"; id: string };

interface ToastContextValue {
  addToast:    (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case "ADD":    return [...state.slice(-3), action.toast];
    case "REMOVE": return state.filter((t) => t.id !== action.id);
    default:       return state;
  }
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  useEffect(() => {
    const id = setTimeout(onRemove, toast.duration);
    return () => clearTimeout(id);
  }, [toast.duration, onRemove]);

  const borderColor =
    toast.type === "success" ? "rgba(16,185,129,0.4)"  :
    toast.type === "error"   ? "rgba(239,68,68,0.4)"   :
    toast.type === "warning" ? "rgba(249,115,22,0.4)"  :
    "rgba(245,158,11,0.4)";

  const iconColor =
    toast.type === "success" ? "var(--zone-green)"  :
    toast.type === "error"   ? "var(--zone-red)"    :
    toast.type === "warning" ? "var(--zone-orange)" :
    "var(--accent)";

  const icon =
    toast.type === "success" ? "✓" :
    toast.type === "error"   ? "✕" :
    toast.type === "warning" ? "⚠" :
    "ℹ";

  const isError = toast.type === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className="animate-slide-up"
      style={{
        background:   "var(--bg-elevated)",
        border:       `1px solid ${borderColor}`,
        borderRadius: 10,
        padding:      "14px 16px",
        minWidth:     280,
        maxWidth:     380,
        boxShadow:    "0 8px 32px rgba(0,0,0,0.4)",
        position:     "relative",
      }}
    >
      <div className="flex items-start gap-3">
        <span style={{ color: iconColor, fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-cream text-sm font-medium leading-tight">{toast.title}</p>
          {toast.message && (
            <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">{toast.message}</p>
          )}
          {toast.txSig && (
            <a
              href={explorerTxUrl(toast.txSig)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs mt-1 block"
              style={{ color: "var(--accent)" }}
              aria-label="View transaction on Solana Explorer"
            >
              View on Explorer →
            </a>
          )}
        </div>
        <button
          onClick={onRemove}
          aria-label="Dismiss notification"
          style={{
            color:      "var(--text-muted)",
            background: "none",
            border:     "none",
            cursor:     "pointer",
            fontSize:   16,
            lineHeight: 1,
            padding:    2,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const counterRef = useRef(0);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast-${++counterRef.current}-${Date.now()}`;
    dispatch({ type: "ADD", toast: { ...toast, id } });
  }, []);

  const removeToast = useCallback((id: string) => {
    dispatch({ type: "REMOVE", id });
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div
        aria-label="Notifications"
        style={{
          position:      "fixed",
          bottom:        24,
          right:         24,
          zIndex:        9999,
          display:       "flex",
          flexDirection: "column",
          gap:           10,
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => (
          <div key={toast.id} style={{ pointerEvents: "all" }}>
            <ToastItem toast={toast} onRemove={() => removeToast(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { addToast: () => {}, removeToast: () => {} };
  }
  return ctx;
}

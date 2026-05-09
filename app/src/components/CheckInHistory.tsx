"use client";

import React from "react";
import { ActivityAccount, VaultAccount } from "@legacy-protocol/sdk";
import { formatSlotDuration, formatSlot } from "@/lib/format";

interface CheckInHistoryProps {
  activity: ActivityAccount | null;
  vault:    VaultAccount;
}

export function CheckInHistory({ activity, vault: _vault }: CheckInHistoryProps) {
  if (!activity) {
    return (
      <div className="card">
        <h2 className="font-display text-xl text-cream mb-2">Check-in Statistics</h2>
        <p className="text-stone-500 text-sm">No activity data available.</p>
      </div>
    );
  }

  const hasCheckins = activity.checkinCount > 0n;
  const avgInterval = hasCheckins
    ? activity.sumOfIntervals / activity.checkinCount
    : 0n;

  let consistencyColor = "var(--zone-green)";
  let consistencyLabel = "Consistent";
  let consistencyWidth = 100;

  if (hasCheckins && avgInterval > 0n && activity.lastInterval > 0n) {
    const ratio = Number(activity.lastInterval) / Number(avgInterval);
    if (ratio > 2) {
      consistencyColor = "var(--zone-red)";
      consistencyLabel = "Very unusual";
      consistencyWidth = Math.min(100, Math.round((ratio / 3) * 100));
    } else if (ratio > 1.5) {
      consistencyColor = "var(--zone-yellow)";
      consistencyLabel = "Slightly unusual";
      consistencyWidth = Math.min(100, Math.round((ratio / 2) * 100));
    } else {
      consistencyColor = "var(--zone-green)";
      consistencyLabel = "Consistent";
      consistencyWidth = Math.min(100, Math.round(ratio * 100));
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl text-cream">Check-in Statistics</h2>
        <span className="label">Aggregated on-chain data</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
        <StatBox label="Total Check-ins" value={activity.checkinCount.toLocaleString()} />
        <StatBox label="Avg Interval"    value={hasCheckins ? formatSlotDuration(avgInterval) : "—"} />
        <StatBox label="Last Interval"   value={activity.lastInterval > 0n ? formatSlotDuration(activity.lastInterval) : "—"} />
      </div>

      {hasCheckins && avgInterval > 0n && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="label">Interval Consistency</span>
            <span className="text-xs font-medium" style={{ color: consistencyColor }}>
              {consistencyLabel}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div
              style={{
                height:     "100%",
                width:      `${consistencyWidth}%`,
                background: consistencyColor,
                borderRadius: 3,
                transition: "width 0.6s ease, background 0.4s ease",
              }}
            />
          </div>
          <p className="text-stone-600 text-xs mt-1">
            Last interval vs average — green ≤1.5×, yellow ≤2×, red &gt;2×
          </p>
        </div>
      )}

      {activity.anomalyFlagged ? (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.3)" }}
          role="status"
        >
          <span style={{ color: "var(--zone-orange)" }}>⚠</span>
          <div>
            <span className="text-orange-400 font-medium">Anomaly flagged</span>
            {activity.anomalyFlaggedSlot > 0n && (
              <span className="text-stone-400 text-xs ml-2">
                at slot {formatSlot(activity.anomalyFlaggedSlot)}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}
          role="status"
        >
          <span style={{ color: "var(--zone-green)" }}>✓</span>
          <span className="text-emerald-400">No anomaly flagged</span>
        </div>
      )}

      <p className="text-stone-600 text-xs mt-3">
        Statistics are computed from on-chain aggregate data. Individual check-in timestamps are not stored on-chain.
      </p>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="text-cream font-medium text-sm">{value}</div>
    </div>
  );
}

"use client";

import React from "react";

interface SkeletonTextProps {
  width?:    string | number;
  height?:   number;
  className?: string;
}

function SkeletonText({ width = "100%", height = 16, className = "" }: SkeletonTextProps) {
  return (
    <div
      className={`skeleton-pulse rounded ${className}`}
      style={{
        width,
        height,
        background: "rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card skeleton-pulse ${className}`} aria-hidden="true">
      <div className="flex items-center gap-6">
        <div
          style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "rgba(255,255,255,0.06)", flexShrink: 0,
          }}
        />
        <div className="flex-1 space-y-2">
          <div style={{ width: "30%", height: 12, background: "rgba(255,255,255,0.06)", borderRadius: 4 }} />
          <div style={{ width: "70%", height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 4 }} />
          <div style={{ width: "50%", height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 4 }} />
        </div>
        <div style={{ width: 56, height: 40, background: "rgba(255,255,255,0.06)", borderRadius: 6 }} />
      </div>
    </div>
  );
}

function SkeletonRing({ size = 240 }: { size?: number }) {
  return (
    <div
      className="skeleton-pulse"
      style={{
        width: size, height: size,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

export const Skeleton = Object.assign(
  function SkeletonBase({ width = "100%", height = 16, className = "" }: SkeletonTextProps) {
    return <SkeletonText width={width} height={height} className={className} />;
  },
  {
    Text: SkeletonText,
    Card: SkeletonCard,
    Ring: SkeletonRing,
  },
);

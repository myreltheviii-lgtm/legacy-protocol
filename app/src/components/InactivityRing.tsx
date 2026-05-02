"use client";

import React, { useEffect, useRef } from "react";
import { ActivityZone } from "@legacy-protocol/sdk";
import { zoneLabel, formatScore, scoreToFraction, zoneColor } from "@/lib/format";

interface InactivityRingProps {
  score:    bigint;
  zone:     ActivityZone;
  /** Ring diameter in pixels. Default: 240. */
  size?:    number;
  /** Show percentage label in centre. Default: true. */
  showLabel?: boolean;
}

/**
 * A circular SVG progress ring that represents the vault's inactivity score.
 * Colour transitions smoothly from green (low) to red (critical) based on
 * the ActivityZone. The ring uses a single stroked circle with stroke-dashoffset
 * to represent progress.
 *
 * WCAG 2.1 AA: the zone is conveyed by both colour AND a text label inside
 * the ring. No information is communicated by colour alone.
 *
 * Angle convention: the arc starts at 12 o'clock (−90° in SVG standard) and
 * travels clockwise. `polarToCartesian` maps a logical `angleDeg` to SVG
 * coordinates using `rad = (angleDeg − 90) * PI / 180`, which places
 * angleDeg=0 at 12 o'clock. To place a point at fraction `f` along the arc:
 *   angleDeg = f * 360
 * NOT `f * 360 − 90` — that subtraction is already baked into polarToCartesian
 * and applying it again rotates every point 90° too far counter-clockwise,
 * putting the 75% tick at 6 o'clock instead of 9 o'clock.
 */
export function InactivityRing({
  score,
  zone,
  size = 240,
  showLabel = true,
}: InactivityRingProps) {
  const prevFractionRef = useRef(scoreToFraction(score));
  const circleRef       = useRef<SVGCircleElement>(null);

  const strokeWidth = size * 0.06;
  const radius      = (size - strokeWidth * 2) / 2;
  const cx          = size / 2;
  const cy          = size / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction    = scoreToFraction(score);
  const dashOffset  = circumference * (1 - fraction);
  const color       = zoneColor(zone);

  // Animate dashOffset transition on score change.
  useEffect(() => {
    const circle = circleRef.current;
    if (!circle) return;

    const from = circumference * (1 - prevFractionRef.current);
    const to   = dashOffset;

    circle.style.strokeDashoffset = `${from}`;
    // requestAnimationFrame ensures the browser applies the initial value before
    // we set the target, making the CSS transition actually play.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        circle.style.strokeDashoffset = `${to}`;
      });
    });

    prevFractionRef.current = fraction;
  }, [score, dashOffset, fraction, circumference]);

  const zoneFontSize    = size * 0.065;
  const percentFontSize = size * 0.22;

  return (
    <div
      role="img"
      aria-label={`Inactivity score: ${formatScore(score)}, zone: ${zoneLabel(zone)}`}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: "visible" }}
      >
        {/* Glow filter for the active arc */}
        <defs>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={strokeWidth * 0.6} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track circle — static background ring */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />

        {/* 75% tick mark — should appear at 9 o'clock (fraction=0.75 → angleDeg=270) */}
        <TickMark
          cx={cx} cy={cy} radius={radius}
          strokeWidth={strokeWidth}
          fraction={0.75}
          color="rgba(255,255,255,0.25)"
        />

        {/* 90% tick mark — should appear at roughly 8 o'clock (fraction=0.9 → angleDeg=324) */}
        <TickMark
          cx={cx} cy={cy} radius={radius}
          strokeWidth={strokeWidth}
          fraction={0.9}
          color="rgba(255,255,255,0.25)"
        />

        {/* Progress arc */}
        <circle
          ref={circleRef}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transform:      "rotate(-90deg)",
            transformOrigin: "center",
            transition:     "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease",
            filter:         fraction > 0 ? "url(#ring-glow)" : undefined,
          }}
        />

        {/* Tip dot at the leading edge of the arc */}
        {fraction > 0.01 && (
          <TipDot
            cx={cx} cy={cy} radius={radius}
            fraction={fraction}
            color={color}
            size={strokeWidth * 0.9}
          />
        )}

        {/* Centre labels */}
        {showLabel && (
          <>
            <text
              x={cx}
              y={cy - size * 0.04}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={color}
              fontSize={percentFontSize}
              fontFamily="var(--font-mono)"
              fontWeight="500"
              style={{ transition: "fill 0.4s ease" }}
            >
              {formatScore(score)}
            </text>
            <text
              x={cx}
              y={cy + percentFontSize * 0.72}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--text-muted)"
              fontSize={zoneFontSize}
              fontFamily="var(--font-body)"
              letterSpacing="0.06em"
            >
              {zoneLabel(zone).toUpperCase()}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Converts a logical angle (in degrees, 0 = 12 o'clock, increasing clockwise)
 * to SVG Cartesian coordinates.
 *
 * The formula `rad = (angleDeg − 90) * PI / 180` transforms the intuitive
 * clock-face angle into SVG's standard mathematical angle (0 = 3 o'clock,
 * counter-clockwise positive). Callers pass `angleDeg = fraction * 360` to
 * place a point at fraction `fraction` along the clockwise arc from 12 o'clock.
 */
function polarToCartesian(
  cx: number, cy: number, r: number, angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function TickMark({
  cx, cy, radius, strokeWidth, fraction, color,
}: {
  cx: number; cy: number; radius: number; strokeWidth: number;
  fraction: number; color: string;
}) {
  // angleDeg = fraction * 360 places the tick at the correct clock-face
  // position. At fraction=0.75: angleDeg=270 → 9 o'clock (left side).
  // At fraction=0.90: angleDeg=324 → roughly 8 o'clock.
  const angleDeg = fraction * 360;
  const outer = polarToCartesian(cx, cy, radius + strokeWidth * 0.5, angleDeg);
  const inner = polarToCartesian(cx, cy, radius - strokeWidth * 0.5, angleDeg);

  return (
    <line
      x1={outer.x} y1={outer.y}
      x2={inner.x} y2={inner.y}
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  );
}

function TipDot({
  cx, cy, radius, fraction, color, size,
}: {
  cx: number; cy: number; radius: number;
  fraction: number; color: string; size: number;
}) {
  // angleDeg = fraction * 360 places the dot at the leading edge of the arc.
  // At fraction=1.0: angleDeg=360 → 12 o'clock (the arc's origin), completing
  // the full circle. At fraction=0.5: angleDeg=180 → 6 o'clock.
  const angleDeg = fraction * 360;
  const { x, y } = polarToCartesian(cx, cy, radius, angleDeg);

  return (
    <circle
      cx={x} cy={y}
      r={size / 2}
      fill={color}
      style={{ transition: "fill 0.4s ease" }}
    />
  );
}


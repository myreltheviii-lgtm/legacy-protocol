"use client";

import React, { useEffect, useRef } from "react";
import { ActivityZone, estimateSecondsToTrigger } from "@legacy-protocol/sdk";
import { zoneLabel, formatScore, scoreToFraction, zoneColor, formatSecondsRemaining } from "@/lib/format";

interface InactivityRingProps {
  score:        bigint;
  zone:         ActivityZone;
  size?:        number;
  showLabel?:   boolean;
  currentSlot?: bigint;
  triggerSlot?: bigint;
}

export function InactivityRing({
  score,
  zone,
  size = 240,
  showLabel = true,
  currentSlot,
  triggerSlot,
}: InactivityRingProps) {
  const prevFractionRef = useRef(scoreToFraction(score));
  const circleRef       = useRef<SVGCircleElement>(null);

  const strokeWidth   = size * 0.06;
  const radius        = (size - strokeWidth * 2) / 2;
  const cx            = size / 2;
  const cy            = size / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction      = scoreToFraction(score);
  const dashOffset    = circumference * (1 - fraction);
  const color         = zoneColor(zone);

  const isPulsing =
    zone === ActivityZone.Orange || zone === ActivityZone.Red;

  useEffect(() => {
    const circle = circleRef.current;
    if (!circle) return;

    const from = circumference * (1 - prevFractionRef.current);
    const to   = dashOffset;

    circle.style.strokeDashoffset = `${from}`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        circle.style.strokeDashoffset = `${to}`;
      });
    });

    prevFractionRef.current = fraction;
  }, [score, dashOffset, fraction, circumference]);

  const zoneFontSize    = size * 0.065;
  const percentFontSize = size * 0.22;

  const showRemaining =
    showLabel &&
    score < 100n &&
    currentSlot !== undefined &&
    triggerSlot !== undefined;

  const remainingText = showRemaining
    ? formatSecondsRemaining(estimateSecondsToTrigger(currentSlot!, triggerSlot!))
    : null;

  return (
    <div
      role="img"
      aria-label={`Inactivity score: ${formatScore(score)}, zone: ${zoneLabel(zone)}`}
      style={{ width: size, height: size, flexShrink: 0 }}
      className={isPulsing ? "animate-ring-pulse" : undefined}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={strokeWidth * 0.6} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />

        {/* 75% tick */}
        {score < 100n && (
          <TickMark cx={cx} cy={cy} radius={radius} strokeWidth={strokeWidth} fraction={0.75} color="#78716C" />
        )}

        {/* 90% tick */}
        {score < 100n && (
          <TickMark cx={cx} cy={cy} radius={radius} strokeWidth={strokeWidth} fraction={0.9} color="#78716C" />
        )}

        {/* Progress arc */}
        <circle
          ref={circleRef}
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transform:       "rotate(-90deg)",
            transformOrigin: "center",
            transition:      "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease",
            filter:          fraction > 0 ? "url(#ring-glow)" : undefined,
          }}
        />

        {/* Tip dot */}
        {fraction > 0.01 && (
          <TipDot cx={cx} cy={cy} radius={radius} fraction={fraction} color={color} size={strokeWidth * 0.9} />
        )}

        {/* Labels */}
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
            {remainingText && (
              <text
                x={cx}
                y={cy + percentFontSize * 0.72 + zoneFontSize * 1.7}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--text-muted)"
                fontSize={zoneFontSize * 0.85}
                fontFamily="var(--font-body)"
              >
                {remainingText}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function TickMark({ cx, cy, radius, strokeWidth, fraction, color }: {
  cx: number; cy: number; radius: number; strokeWidth: number; fraction: number; color: string;
}) {
  const angleDeg = fraction * 360;
  const outer = polarToCartesian(cx, cy, radius + strokeWidth * 0.5, angleDeg);
  const inner = polarToCartesian(cx, cy, radius - strokeWidth * 0.5, angleDeg);
  return (
    <line x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
  );
}

function TipDot({ cx, cy, radius, fraction, color, size }: {
  cx: number; cy: number; radius: number; fraction: number; color: string; size: number;
}) {
  const angleDeg = fraction * 360;
  const { x, y } = polarToCartesian(cx, cy, radius, angleDeg);
  return (
    <circle cx={x} cy={y} r={size / 2} fill={color} style={{ transition: "fill 0.4s ease" }} />
  );
}

// guardian-app/src/theme/index.ts
//
// Centralised design tokens for the Guardian app dark theme.
// Every screen and component imports from here — no magic hex values elsewhere.

export const Colors = {
  background:   "#1a1512",
  surface:      "#231f1a",
  surfaceRaised:"#2c2621",
  border:       "#3d3530",
  textPrimary:  "#d4c5a9",
  textMuted:    "#6b7280",
  textDim:      "#4b5563",

  // Risk level colours
  LOW:          "#10b981",
  MEDIUM:       "#f59e0b",
  HIGH:         "#f97316",
  CRITICAL:     "#ef4444",

  // Zone colours mirroring the watcher zone classification
  GREEN:        "#10b981",
  YELLOW:       "#f59e0b",
  ORANGE:       "#f97316",
  RED:          "#ef4444",

  white:        "#ffffff",
  black:        "#000000",
  accent:       "#a78c6d",
} as const;

export const Typography = {
  heading1:  { fontSize: 24, fontWeight: "700" as const, color: Colors.textPrimary },
  heading2:  { fontSize: 20, fontWeight: "700" as const, color: Colors.textPrimary },
  heading3:  { fontSize: 16, fontWeight: "600" as const, color: Colors.textPrimary },
  body:      { fontSize: 14, fontWeight: "400" as const, color: Colors.textPrimary },
  bodySmall: { fontSize: 12, fontWeight: "400" as const, color: Colors.textMuted },
  mono:      { fontSize: 12, fontFamily: "monospace",    color: Colors.textMuted },
  label:     { fontSize: 11, fontWeight: "600" as const, color: Colors.textMuted, letterSpacing: 0.8, textTransform: "uppercase" as const },
} as const;

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export const Radius = {
  sm:   6,
  md:  12,
  lg:  18,
  full: 9999,
} as const;

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Zone      = "GREEN" | "YELLOW" | "ORANGE" | "RED";

export function riskColor(level: RiskLevel): string {
  return Colors[level];
}

export function zoneColor(zone: Zone): string {
  return Colors[zone];
}

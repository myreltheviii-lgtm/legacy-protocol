// guardian-app/src/components/VaultCard.tsx
//
// Renders a single vault row in the GuardianDashboard list.
// Shows zone indicator, silence duration, anomaly/trigger flags, and guardian counts.

import React               from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Colors, Typography, Spacing, Radius, zoneColor } from "../theme";
import { RiskBadge }       from "./RiskBadge";
import type { VaultSummary } from "../hooks/useVaultData";

interface Props {
  vault:   VaultSummary;
  onPress: (vault: VaultSummary) => void;
}

export function VaultCard({ vault, onPress }: Props) {
  const zc = zoneColor(vault.zone);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(vault)}
      activeOpacity={0.75}
    >
      {/* Zone indicator bar */}
      <View style={[styles.zonebar, { backgroundColor: zc }]} />

      <View style={styles.body}>
        {/* Header row */}
        <View style={styles.row}>
          <Text style={styles.address} numberOfLines={1}>
            {vault.vaultAddress.slice(0, 8)}…{vault.vaultAddress.slice(-6)}
          </Text>
          <RiskBadge level={vault.zone} size="sm" />
        </View>

        {/* Silence info */}
        <View style={styles.row}>
          <Text style={styles.meta}>
            Silent {vault.silenceDays.toFixed(1)}d
            {vault.historicalAvgDays > 0
              ? `  ·  avg ${vault.historicalAvgDays.toFixed(1)}d`
              : ""}
          </Text>
          {vault.isShielded && (
            <Text style={styles.shield}>🔒 Shielded</Text>
          )}
        </View>

        {/* Flags row — justifyContent: "space-between" on the row eliminates
            the need for marginLeft: "auto" on the guardians text, which is not
            supported as a valid value in React Native StyleSheet flex layouts. */}
        <View style={styles.flags}>
          <View style={styles.flagsLeft}>
            {vault.anomalyFlagged && (
              <View style={[styles.flag, { borderColor: Colors.CRITICAL }]}>
                <Text style={[styles.flagText, { color: Colors.CRITICAL }]}>ANOMALY</Text>
              </View>
            )}
            {vault.triggerSignalled && (
              <View style={[styles.flag, { borderColor: Colors.RED }]}>
                <Text style={[styles.flagText, { color: Colors.RED }]}>TRIGGER</Text>
              </View>
            )}
          </View>
          <Text style={styles.guardians}>
            {vault.guardianCount} guardian{vault.guardianCount !== 1 ? "s" : ""}
            {"  "}·{"  "}
            {vault.mOfNThreshold}-of-{vault.guardianCount} required
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection:   "row",
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    marginBottom:    Spacing.sm,
    overflow:        "hidden",
  },
  zonebar: {
    width: 4,
  },
  body: {
    flex:    1,
    padding: Spacing.md,
    gap:     Spacing.xs,
  },
  row: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
  },
  address: {
    ...Typography.mono,
    fontSize: 13,
    color:    Colors.textPrimary,
    flex:     1,
    marginRight: Spacing.sm,
  },
  meta: {
    ...Typography.bodySmall,
  },
  shield: {
    ...Typography.bodySmall,
    color: Colors.accent,
  },
  flags: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
  },
  flagsLeft: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           Spacing.xs,
    flexWrap:      "wrap",
    flex:          1,
  },
  flag: {
    borderWidth:       1,
    borderRadius:      Radius.sm,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  flagText: {
    fontSize:    9,
    fontWeight:  "700",
    letterSpacing: 0.6,
  },
  guardians: {
    ...Typography.bodySmall,
    textAlign: "right",
  },
});

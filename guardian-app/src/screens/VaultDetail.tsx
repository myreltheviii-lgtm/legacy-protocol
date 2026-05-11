// guardian-app/src/screens/VaultDetail.tsx
//
// Full vault state screen. Shows all fields, all flags, zone indicator, and
// provides navigation to the QVAC risk brief and covenant signing flow.

import React        from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RiskBadge }   from "../components/RiskBadge";
import {
  Colors, Typography, Spacing, Radius, zoneColor,
} from "../theme";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "VaultDetail">;

const SLOTS_PER_DAY = 172_800;

export function VaultDetail({ navigation, route }: Props) {
  const { vault } = route.params;
  const zc = zoneColor(vault.zone);

  const thresholdDays = (Number(vault.inactivityThresholdSlots) / SLOTS_PER_DAY).toFixed(1);
  const lastCheckInDate = new Date(
    Date.now() - vault.silenceDays * 24 * 60 * 60 * 1000,
  ).toLocaleDateString();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header with back nav */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Vaults</Text>
        </TouchableOpacity>
        <RiskBadge level={vault.zone} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Zone bar */}
        <View style={[styles.zoneBanner, { backgroundColor: zc + "22", borderColor: zc }]}>
          <View style={[styles.zoneDot, { backgroundColor: zc }]} />
          <Text style={[styles.zoneText, { color: zc }]}>
            {vault.zone} ZONE  ·  {vault.silenceDays.toFixed(1)} days silent
          </Text>
        </View>

        {/* Address block */}
        <View style={styles.section}>
          <Text style={styles.label}>VAULT ADDRESS</Text>
          <Text style={styles.mono}>{vault.vaultAddress}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>OWNER ADDRESS</Text>
          <Text style={styles.mono}>{vault.ownerAddress}</Text>
        </View>

        {/* Inactivity stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>INACTIVITY</Text>
          <View style={styles.row}>
            <Stat label="Silence"     value={`${vault.silenceDays.toFixed(1)} days`} />
            <Stat label="Avg interval" value={vault.historicalAvgDays > 0 ? `${vault.historicalAvgDays.toFixed(1)} days` : "—"} />
            <Stat label="Threshold"   value={`${thresholdDays} days`} />
          </View>
          <View style={styles.row}>
            <Stat label="Last check-in" value={lastCheckInDate} />
            <Stat label="Check-ins"     value={vault.checkinCount} />
            <Stat label="Shielded"      value={vault.isShielded ? "Yes" : "No"} />
          </View>
        </View>

        {/* Guardian config */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>GUARDIAN CONFIG</Text>
          <View style={styles.row}>
            <Stat label="Guardians"  value={String(vault.guardianCount)} />
            <Stat label="Threshold"  value={`${vault.mOfNThreshold}-of-${vault.guardianCount}`} />
          </View>
        </View>

        {/* Flags */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>STATUS FLAGS</Text>
          <FlagRow label="75% warning sent"   active={vault.warning75Sent}    color={Colors.YELLOW} />
          <FlagRow label="90% warning sent"   active={vault.warning90Sent}    color={Colors.ORANGE} />
          <FlagRow label="Anomaly flagged"     active={vault.anomalyFlagged}   color={Colors.CRITICAL} />
          <FlagRow label="Trigger signalled"   active={vault.triggerSignalled} color={Colors.RED} />
        </View>

        {/* CTA buttons */}
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => navigation.navigate("RiskBrief", { vault })}
        >
          <Text style={styles.btnPrimaryText}>View QVAC Risk Brief</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => navigation.navigate("SignCovenant", { vault })}
        >
          <Text style={styles.btnSecondaryText}>Sign Covenant</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...Typography.label, fontSize: 9 }}>{label}</Text>
      <Text style={Typography.body}>{value}</Text>
    </View>
  );
}

function FlagRow({ label, active, color }: { label: string; active: boolean; color: string }) {
  // justifyContent: "space-between" on the row pushes the status text to the
  // right without relying on marginLeft: "auto" which is not supported in
  // React Native StyleSheet flex layouts.
  return (
    <View style={flagRowStyles.row}>
      <View style={[flagRowStyles.dot, { backgroundColor: active ? color : Colors.border }]} />
      <Text style={[Typography.body, { color: active ? color : Colors.textMuted, flex: 1 }]}>
        {label}
      </Text>
      <Text style={[Typography.bodySmall, { color: active ? color : Colors.textDim }]}>
        {active ? "ACTIVE" : "clear"}
      </Text>
    </View>
  );
}

const flagRowStyles = StyleSheet.create({
  row: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    gap:            Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  dot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
});

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    padding: Spacing.xs,
  },
  backText: {
    ...Typography.body,
    color: Colors.accent,
  },
  scroll: {
    padding: Spacing.lg,
    gap:     Spacing.md,
  },
  zoneBanner: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            Spacing.sm,
    borderWidth:    1,
    borderRadius:   Radius.md,
    padding:        Spacing.md,
  },
  zoneDot: {
    width:        10,
    height:       10,
    borderRadius: 5,
  },
  zoneText: {
    ...Typography.heading3,
  },
  section: {
    gap: Spacing.xs,
  },
  label: {
    ...Typography.label,
  },
  mono: {
    ...Typography.mono,
    fontSize: 11,
    color:    Colors.textPrimary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  cardTitle: {
    ...Typography.label,
    marginBottom: Spacing.xs,
  },
  row: {
    flexDirection: "row",
    gap:           Spacing.md,
  },
  btnPrimary: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.md,
    padding:         Spacing.md,
    alignItems:      "center",
    marginTop:       Spacing.sm,
  },
  btnPrimaryText: {
    ...Typography.heading3,
    color: Colors.background,
  },
  btnSecondary: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    alignItems:      "center",
  },
  btnSecondaryText: {
    ...Typography.heading3,
  },
});

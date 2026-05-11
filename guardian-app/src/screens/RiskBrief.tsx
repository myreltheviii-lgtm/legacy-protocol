// guardian-app/src/screens/RiskBrief.tsx
//
// The QVAC risk brief screen — the centrepiece of the guardian decision flow.
// Calls generateRiskBrief() with behavioral metadata only, displays the LLM
// result with striking visual treatment, and optionally routes to SignCovenant.
//
// Cloak cryptographic material never appears here — the context passed to QVAC
// contains only days-based behavioral descriptors and aggregate counts.
//
// Security fix: ownerAlias uses a purely behavioral descriptor derived from
// zone and silence duration — no vault address, public key, or any other
// cryptographic material ever enters the LLM prompt context.
// vault.vaultAddress is a Solana PDA (a public key) — even a slice of it
// violates the QVAC prompt security invariant.
//
// Fix: load() is called with void to satisfy the floating-Promise rule.
// The async function handles all errors internally and never rejects.

import React, { useState, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps }      from "@react-navigation/native-stack";
import { generateRiskBrief }               from "../lib/qvac_guardian";
import type { GuardianRiskBrief, GuardianVaultContext } from "../lib/qvac_guardian";
import { RiskBadge }                       from "../components/RiskBadge";
import { Colors, Typography, Spacing, Radius, riskColor } from "../theme";
import type { RootStackParamList }         from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "RiskBrief">;

export function RiskBrief({ navigation, route }: Props) {
  const { vault } = route.params;

  const [brief,   setBrief]   = useState<GuardianRiskBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Build GuardianVaultContext from behavioral metadata only.
        // No Cloak keys, no UTXO commitments, no cryptographic material.
        //
        // ownerAlias MUST NOT contain any Solana address, public key, hash,
        // or other cryptographic value — even a slice of vault.vaultAddress
        // (which is a PDA and therefore a public key) would violate the QVAC
        // prompt security invariant. Use a purely behavioral descriptor instead.
        const context: GuardianVaultContext = {
          ownerAlias:            `${vault.zone} zone vault (${vault.silenceDays.toFixed(0)}d silent)`,
          silenceDays:           vault.silenceDays,
          historicalAvgDays:     vault.historicalAvgDays,
          guardiansRequired:     vault.mOfNThreshold,
          guardiansSignedSoFar:  0, // guardian app does not track live signature counts
          vaultShielded:         vault.isShielded,
          anomalyFlagged:        vault.anomalyFlagged,
          covenantExpiresInDays: 0, // not tracked in watcher — shown as unknown
          similarTriggeredCount: 0, // not surfaced at this layer
        };

        const result = await generateRiskBrief(context);
        if (!cancelled) {
          setBrief(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // void satisfies the floating-Promise rule. load() handles all errors
    // internally via try/catch and never propagates a rejection.
    void load();
    return () => { cancelled = true; };
  }, [vault]);

  const rc = brief ? riskColor(brief.riskLevel) : Colors.textMuted;
  const isCritical = brief?.riskLevel === "CRITICAL";

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Detail</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Risk Brief</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Loading state */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Analysing vault behavior…</Text>
          <Text style={styles.privacyNote}>
            🔒 Analysis runs locally. No data leaves your device.
          </Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Analysis unavailable</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : brief ? (
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* Risk level hero block */}
          <View style={[styles.heroBanner, { borderColor: rc, backgroundColor: rc + "18" }]}>
            <RiskBadge level={brief.riskLevel} />
            <View style={[styles.riskOrb, { backgroundColor: rc + "33", borderColor: rc }]}>
              <Text style={[styles.riskOrbText, { color: rc }]}>{brief.riskLevel}</Text>
            </View>
          </View>

          {/* Summary */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>SITUATION SUMMARY</Text>
            <Text style={styles.summaryText}>{brief.summary}</Text>
          </View>

          {/* Recommendation */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>RECOMMENDATION</Text>
            <Text style={styles.recommendText}>{brief.recommendation}</Text>
          </View>

          {/* Irreversible warning — always prominent */}
          <View style={[styles.warningCard, { borderColor: Colors.CRITICAL }]}>
            <Text style={styles.warningIcon}>⚠</Text>
            <Text style={styles.warningTitle}>IRREVERSIBLE ACTION</Text>
            <Text style={styles.warningBody}>{brief.irreversibleWarning}</Text>
          </View>

          {/* Vault context summary — behavioral only */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>VAULT CONTEXT</Text>
            <ContextRow label="Silence"    value={`${vault.silenceDays.toFixed(1)} days`} />
            <ContextRow label="Avg interval" value={vault.historicalAvgDays > 0 ? `${vault.historicalAvgDays.toFixed(1)} days` : "Unknown"} />
            <ContextRow label="Anomaly flag" value={vault.anomalyFlagged ? "Active" : "Clear"} color={vault.anomalyFlagged ? Colors.CRITICAL : Colors.GREEN} />
            <ContextRow label="Shielded"   value={vault.isShielded ? "Yes" : "No"} />
          </View>

          {/* Proceed button — blocked on CRITICAL */}
          {isCritical ? (
            <View style={styles.blockedBtn}>
              <Text style={styles.blockedText}>
                Signing blocked at CRITICAL risk level. Seek independent verification.
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.signBtn}
              onPress={() => navigation.navigate("SignCovenant", { vault })}
            >
              <Text style={styles.signBtnText}>Proceed to Sign Covenant</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function ContextRow({
  label, value, color,
}: { label: string; value: string; color?: string }) {
  return (
    <View style={ctxStyles.row}>
      <Text style={ctxStyles.label}>{label}</Text>
      <Text style={[ctxStyles.value, color ? { color } : undefined]}>{value}</Text>
    </View>
  );
}

const ctxStyles = StyleSheet.create({
  row: {
    flexDirection:  "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  label: {
    ...Typography.bodySmall,
  },
  value: {
    ...Typography.body,
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
    width:   60,
  },
  backText: {
    ...Typography.body,
    color: Colors.accent,
  },
  headerTitle: {
    ...Typography.heading3,
  },
  loadingContainer: {
    flex:            1,
    alignItems:      "center",
    justifyContent:  "center",
    gap:             Spacing.md,
    padding:         Spacing.xl,
  },
  loadingText: {
    ...Typography.body,
  },
  privacyNote: {
    ...Typography.bodySmall,
    textAlign: "center",
    maxWidth:  260,
  },
  errorContainer: {
    flex:       1,
    alignItems: "center",
    justifyContent: "center",
    padding:    Spacing.xl,
    gap:        Spacing.md,
  },
  errorTitle: {
    ...Typography.heading2,
    color: Colors.CRITICAL,
  },
  errorText: {
    ...Typography.bodySmall,
    textAlign: "center",
  },
  retryBtn: {
    padding:         Spacing.md,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    marginTop:       Spacing.sm,
  },
  retryText: {
    ...Typography.body,
    color: Colors.accent,
  },
  scroll: {
    padding: Spacing.lg,
    gap:     Spacing.md,
  },
  heroBanner: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    borderWidth:    1,
    borderRadius:   Radius.lg,
    padding:        Spacing.lg,
  },
  riskOrb: {
    width:         80,
    height:        80,
    borderRadius:  40,
    borderWidth:   2,
    alignItems:    "center",
    justifyContent:"center",
  },
  riskOrbText: {
    fontSize:   13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  cardLabel: {
    ...Typography.label,
    marginBottom: Spacing.xs,
  },
  summaryText: {
    ...Typography.body,
    lineHeight: 22,
  },
  recommendText: {
    ...Typography.body,
    lineHeight: 22,
    color:      Colors.accent,
  },
  warningCard: {
    backgroundColor: Colors.CRITICAL + "11",
    borderRadius:    Radius.md,
    borderWidth:     2,
    padding:         Spacing.md,
    gap:             Spacing.xs,
    alignItems:      "center",
  },
  warningIcon: {
    fontSize: 28,
  },
  warningTitle: {
    ...Typography.label,
    color:     Colors.CRITICAL,
    fontSize:  12,
  },
  warningBody: {
    ...Typography.body,
    color:     Colors.CRITICAL,
    textAlign: "center",
    lineHeight: 20,
  },
  blockedBtn: {
    backgroundColor: Colors.CRITICAL + "18",
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.CRITICAL,
    padding:         Spacing.md,
    alignItems:      "center",
  },
  blockedText: {
    ...Typography.body,
    color:     Colors.CRITICAL,
    textAlign: "center",
  },
  signBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.md,
    padding:         Spacing.md,
    alignItems:      "center",
    marginTop:       Spacing.sm,
  },
  signBtnText: {
    ...Typography.heading3,
    color: Colors.background,
  },
});

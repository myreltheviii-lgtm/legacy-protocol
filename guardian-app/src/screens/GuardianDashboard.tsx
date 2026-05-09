// guardian-app/src/screens/GuardianDashboard.tsx
//
// Main dashboard screen showing all vaults the guardian monitors.
// Fetches real vault data from the watcher, sorts by urgency, and renders
// each vault as a tappable card that navigates to VaultDetail.

import React                from "react";
import {
  View, Text, FlatList, RefreshControl,
  StyleSheet, SafeAreaView, StatusBar,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useVaultData }     from "../hooks/useVaultData";
import { VaultCard }        from "../components/VaultCard";
import { LoadingOverlay }   from "../components/LoadingOverlay";
import { Colors, Typography, Spacing } from "../theme";
import type { RootStackParamList }     from "../navigation/AppNavigator";
import type { VaultSummary }           from "../hooks/useVaultData";

type Props = NativeStackScreenProps<RootStackParamList, "GuardianDashboard">;

export function GuardianDashboard({ navigation }: Props) {
  const { vaults, loading, error, lastFetch, refetch } = useVaultData();

  const handleVaultPress = (vault: VaultSummary) => {
    navigation.navigate("VaultDetail", { vault });
  };

  if (loading && vaults.length === 0) {
    return <LoadingOverlay message="Loading vaults…" />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Guardian</Text>
        <Text style={styles.subtitle}>
          {vaults.length} vault{vaults.length !== 1 ? "s" : ""} monitored
          {lastFetch ? `  ·  ${lastFetch.toLocaleTimeString()}` : ""}
        </Text>
      </View>

      {/* Error banner */}
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠ {error}</Text>
        </View>
      ) : null}

      {/* Vault list */}
      {vaults.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No vaults found.</Text>
          <Text style={styles.emptySubtext}>
            Ensure the watcher is running and your guardian key is registered.
          </Text>
        </View>
      ) : (
        <FlatList
          data={vaults}
          keyExtractor={(v) => v.vaultAddress}
          renderItem={({ item }) => (
            <VaultCard vault={item} onPress={handleVaultPress} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refetch}
              tintColor={Colors.accent}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.lg,
    paddingBottom:     Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    ...Typography.heading1,
  },
  subtitle: {
    ...Typography.bodySmall,
    marginTop: Spacing.xs,
  },
  errorBanner: {
    margin:          Spacing.md,
    padding:         Spacing.md,
    backgroundColor: Colors.CRITICAL + "22",
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     Colors.CRITICAL,
  },
  errorText: {
    ...Typography.bodySmall,
    color: Colors.CRITICAL,
  },
  list: {
    padding: Spacing.md,
  },
  empty: {
    flex:            1,
    alignItems:      "center",
    justifyContent:  "center",
    padding:         Spacing.xl,
  },
  emptyText: {
    ...Typography.heading3,
    marginBottom: Spacing.sm,
  },
  emptySubtext: {
    ...Typography.bodySmall,
    textAlign: "center",
  },
});

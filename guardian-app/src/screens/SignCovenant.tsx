// guardian-app/src/screens/SignCovenant.tsx
//
// Covenant signing screen. The guardian enters their Shamir share (base64),
// optionally tests secret reconstruction against a known threshold, and then
// executes the Cloak shielded transfer to complete the inheritance handover.
//
// Execution flow:
//   Phase 1 — entry:    Guardian pastes their Shamir share(s) and their
//                        Solana wallet private key (base58, 64 bytes).
//   Phase 2 — scanning: scanOwnerUtxos() reconstructs the owner key internally,
//                        scans the shielded pool, zeroes the key, and returns
//                        the vault UTXOs and total amount.
//   Phase 3 — confirm:  Guardian reviews the amount and confirms execution.
//   Phase 4 — executing: reconstructAndTransfer() does the final Cloak transfer.
//   Phase 5 — done/error.
//
// Security invariants:
//   Private key bytes are zeroed immediately after use in every code path.
//   No private key appears in logs, state, or UI.
//   The guardian's Solana keypair is constructed and zeroed inside the worklet —
//   it never exists as a Keypair object in the RN JS heap.
//   walletKeyRef holds the base58 private key string in a mutable ref —
//   NOT in React state — so it does not live in the component state tree,
//   is not captured in React snapshots or DevTools state, and is cleared
//   immediately after use in every code path including failures.
//
// Metro safety: zero Cloak imports in this file.
// All Cloak calls go through cloak-bridge.ts → Bare worklet.

import React, { useState, useRef }            from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, StatusBar, Alert,
} from "react-native";
import type { NativeStackScreenProps }   from "@react-navigation/native-stack";
import { LoadingOverlay }                from "../components/LoadingOverlay";
import { Colors, Typography, Spacing, Radius } from "../theme";
import type { RootStackParamList }       from "../navigation/AppNavigator";
import { connectionUrl }                 from "../lib/sdk";
import {
  scanOwnerUtxos,
  reconstructAndTransfer,
  testReconstruction,
} from "../lib/cloak-bridge";
import type { GuardianShare }            from "../lib/cloak-bridge";

type Props = NativeStackScreenProps<RootStackParamList, "SignCovenant">;

type Phase =
  | "entry"
  | "scanning"
  | "confirm"
  | "executing"
  | "done"
  | "error";

export function SignCovenant({ navigation, route }: Props) {
  const { vault } = route.params;

  const [phase,            setPhase]        = useState<Phase>("entry");
  const [shareInput,       setShareInput]   = useState("");
  const [additionalShares, setAdditional]   = useState<string[]>([""]);
  const [statusMessage,    setStatus]       = useState("");
  const [errorMessage,     setErrorMessage] = useState("");
  const [scanResult,       setScanResult]   = useState<{
    vaultUtxos:  unknown[];
    totalAmount: bigint;
  } | null>(null);

  // The guardian wallet private key (base58) is held in a mutable ref —
  // NOT in React state — so it never appears in the component state tree,
  // React DevTools snapshots, or memory dumps of the state tree.
  // It is sent to the worklet and cleared in the finally block of
  // executeTransfer() covering every code path.
  // walletKeyClearCounter forces the uncontrolled TextInput to remount
  // and visually clear after each use without holding the key in state.
  const walletKeyRef = useRef("");
  const [walletKeyClearCounter, setWalletKeyClearCounter] = useState(0);

  const handleAddShareField = () => {
    setAdditional(prev => [...prev, ""]);
  };

  const handleShareChange = (index: number, value: string) => {
    setAdditional(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  function buildGuardianShares(): GuardianShare[] {
    const allStrings = [
      shareInput.trim(),
      ...additionalShares.map(s => s.trim()).filter(Boolean),
    ].filter(Boolean);

    return allStrings.map((shareBase64, i) => ({
      shareIndex:     i + 1,
      shareBase64,
      guardianWallet: "",
    }));
  }

  const handleTestReconstruction = async () => {
    if (!shareInput.trim()) {
      Alert.alert("Missing share", "Enter your Shamir share first.");
      return;
    }

    const allShareStrings = [
      shareInput.trim(),
      ...additionalShares.map(s => s.trim()).filter(Boolean),
    ];

    if (allShareStrings.length < vault.mOfNThreshold) {
      setStatus(
        `Need at least ${vault.mOfNThreshold} shares to reconstruct. ` +
        `You have ${allShareStrings.length}.`
      );
      return;
    }

    try {
      // Reconstruction happens inside the worklet.
      // The reconstructed key is zeroed there — never exists in RN heap.
      await testReconstruction({ shareStrings: allShareStrings });
      setStatus(
        `Reconstruction succeeded with ${allShareStrings.length} shares. Shares are consistent.`
      );
    } catch (err) {
      Alert.alert(
        "Reconstruction failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleScan = async () => {
    if (!shareInput.trim()) {
      Alert.alert("Missing share", "Enter your Shamir share before scanning.");
      return;
    }
    if (!walletKeyRef.current.trim()) {
      Alert.alert(
        "Missing wallet key",
        "Paste your guardian wallet private key (base58) to pay for the Cloak transfer.",
      );
      return;
    }

    const shares = buildGuardianShares();
    if (shares.length < vault.mOfNThreshold) {
      Alert.alert(
        "Not enough shares",
        `Need at least ${vault.mOfNThreshold} shares. You have ${shares.length}.`,
      );
      return;
    }

    setPhase("scanning");
    setStatus("Scanning shielded pool for vault UTXOs…");

    try {
      const result = await scanOwnerUtxos({
        guardianShares: shares,
        connectionUrl,
      });
      setScanResult(result);
      setStatus("");
      setPhase("confirm");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const handleExecute = () => {
    if (!scanResult) return;

    Alert.alert(
      "Confirm inheritance execution",
      "This action is irreversible. Once submitted, the shielded transfer cannot be undone. Proceed?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Execute",
          style: "destructive",
          onPress: () => { void executeTransfer(); },
        },
      ],
    );
  };

  const executeTransfer = async () => {
    if (!scanResult) return;

    setPhase("executing");
    setStatus("Executing Cloak shielded transfer…");

    try {
      // The private key is passed to the worklet over loopback.
      // The worklet constructs the Keypair, signs, and zeroes it internally.
      // The key never exists as a Keypair object in the RN JS heap.
      await reconstructAndTransfer({
        guardianShares:           buildGuardianShares(),
        beneficiaryUtxoPubkeyHex: vault.beneficiary,
        vaultUtxos:               scanResult.vaultUtxos,
        totalAmount:              scanResult.totalAmount,
        relayerPrivateKeyBase58:  walletKeyRef.current.trim(),
        connectionUrl,
      });

      setStatus("Cloak shielded transfer submitted successfully.");
      setPhase("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      // Clear the private key ref regardless of outcome.
      // Force-remount the TextInput so it visually clears.
      walletKeyRef.current = "";
      setWalletKeyClearCounter(c => c + 1);
    }
  };

  if (phase === "scanning" || phase === "executing") {
    return <LoadingOverlay message={statusMessage} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Risk Brief</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sign Covenant</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTabs="handled">

        {/* Vault context */}
        <View style={styles.contextCard}>
          <Text style={styles.label}>VAULT</Text>
          <Text style={styles.mono} numberOfLines={1}>
            {vault.vaultAddress.slice(0, 12)}…{vault.vaultAddress.slice(-8)}
          </Text>
          <Text style={styles.meta}>
            Requires {vault.mOfNThreshold}-of-{vault.guardianCount} guardian signatures
          </Text>
        </View>

        {/* Irreversible warning */}
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>
            ⚠ Executing inheritance is irreversible. The Cloak shielded transfer cannot be undone once submitted.
          </Text>
        </View>

        {/* Scan result — shown in confirm phase */}
        {phase === "confirm" && scanResult && (
          <View style={styles.scanResultCard}>
            <Text style={styles.scanResultTitle}>UTXO SCAN COMPLETE</Text>
            <Text style={styles.scanResultBody}>
              Found {scanResult.vaultUtxos.length} UTXO
              {scanResult.vaultUtxos.length !== 1 ? "s" : ""} totalling{" "}
              {(Number(scanResult.totalAmount) / 1e9).toFixed(4)} SOL.
            </Text>
            <Text style={styles.scanResultNote}>
              Cloak fee will be deducted. Confirm to execute the shielded transfer to the beneficiary.
            </Text>
          </View>
        )}

        {/* Entry phase inputs */}
        {(phase === "entry" || phase === "confirm") && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>YOUR SHAMIR SHARE</Text>
              <TextInput
                style={styles.input}
                value={shareInput}
                onChangeText={setShareInput}
                placeholder="Paste your base64 share here"
                placeholderTextColor={Colors.textDim}
                multiline
                numberOfLines={3}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={false}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>ADDITIONAL SHARES (for threshold)</Text>
              {additionalShares.map((share, i) => (
                <TextInput
                  key={i}
                  style={[styles.input, { marginTop: i > 0 ? Spacing.xs : 0 }]}
                  value={share}
                  onChangeText={v => handleShareChange(i, v)}
                  placeholder={`Share ${i + 2}`}
                  placeholderTextColor={Colors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              ))}
              <TouchableOpacity style={styles.addShareBtn} onPress={handleAddShareField}>
                <Text style={styles.addShareText}>+ Add share</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>GUARDIAN WALLET KEY (base58)</Text>
              <Text style={styles.sectionHint}>
                Your Solana wallet private key — used only to sign the Cloak transaction. Not stored in state.
              </Text>
              <TextInput
                key={walletKeyClearCounter}
                style={styles.input}
                onChangeText={v => { walletKeyRef.current = v; }}
                placeholder="Paste your base58 private key"
                placeholderTextColor={Colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={true}
              />
            </View>
          </>
        )}

        {/* Status message */}
        {statusMessage ? (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        ) : null}

        {/* Done state */}
        {phase === "done" ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>✓ Inheritance transfer executed successfully.</Text>
            <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.popToTop()}>
              <Text style={styles.doneBtnText}>Return to Dashboard</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Error state */}
        {phase === "error" ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Execution failed</Text>
            <Text style={styles.errorBody}>{errorMessage}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => { setPhase("entry"); setErrorMessage(""); setScanResult(null); }}
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Action buttons */}
        {phase === "entry" && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={() => { void handleTestReconstruction(); }}
            >
              <Text style={styles.testBtnText}>Test Reconstruction</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.executeBtn}
              onPress={() => { void handleScan(); }}
            >
              <Text style={styles.executeBtnText}>Scan & Confirm</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === "confirm" && scanResult && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={() => { setScanResult(null); setPhase("entry"); }}
            >
              <Text style={styles.testBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.executeBtn} onPress={handleExecute}>
              <Text style={styles.executeBtnText}>Execute Inheritance</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: Colors.background },
  header:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:         { width: 80, padding: Spacing.xs },
  backText:        { ...Typography.body, color: Colors.accent },
  headerTitle:     { ...Typography.heading3 },
  scroll:          { padding: Spacing.lg, gap: Spacing.md },
  contextCard:     { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.xs },
  label:           { ...Typography.label },
  mono:            { ...Typography.mono, fontSize: 11, color: Colors.textPrimary },
  meta:            { ...Typography.bodySmall },
  warningCard:     { backgroundColor: Colors.CRITICAL + "11", borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.CRITICAL, padding: Spacing.md },
  warningText:     { ...Typography.body, color: Colors.CRITICAL, lineHeight: 20 },
  scanResultCard:  { backgroundColor: Colors.GREEN + "11", borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.GREEN, padding: Spacing.md, gap: Spacing.xs },
  scanResultTitle: { ...Typography.label, color: Colors.GREEN },
  scanResultBody:  { ...Typography.body, color: Colors.textPrimary },
  scanResultNote:  { ...Typography.bodySmall, color: Colors.textMuted },
  section:         { gap: Spacing.xs },
  sectionLabel:    { ...Typography.label },
  sectionHint:     { ...Typography.bodySmall, color: Colors.textMuted },
  input:           { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.textPrimary, fontFamily: "monospace", fontSize: 12, padding: Spacing.md, textAlignVertical: "top" },
  addShareBtn:     { alignSelf: "flex-start", marginTop: Spacing.xs, padding: Spacing.xs },
  addShareText:    { ...Typography.body, color: Colors.accent },
  statusBox:       { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md },
  statusText:      { ...Typography.body, color: Colors.textMuted },
  successBox:      { backgroundColor: Colors.GREEN + "18", borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.GREEN, padding: Spacing.md, gap: Spacing.md, alignItems: "center" },
  successText:     { ...Typography.body, color: Colors.GREEN },
  doneBtn:         { backgroundColor: Colors.GREEN, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  doneBtnText:     { ...Typography.heading3, color: Colors.background },
  errorBox:        { backgroundColor: Colors.CRITICAL + "18", borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.CRITICAL, padding: Spacing.md, gap: Spacing.sm },
  errorTitle:      { ...Typography.heading3, color: Colors.CRITICAL },
  errorBody:       { ...Typography.bodySmall, color: Colors.CRITICAL },
  retryBtn:        { alignSelf: "flex-start", padding: Spacing.sm, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.CRITICAL },
  retryText:       { ...Typography.body, color: Colors.CRITICAL },
  actions:         { gap: Spacing.sm, marginTop: Spacing.sm },
  testBtn:         { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, alignItems: "center" },
  testBtnText:     { ...Typography.heading3 },
  executeBtn:      { backgroundColor: Colors.accent, borderRadius: Radius.md, padding: Spacing.md, alignItems: "center" },
  executeBtnText:  { ...Typography.heading3, color: Colors.background },
});

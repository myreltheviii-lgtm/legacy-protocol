// guardian-app/src/components/LoadingOverlay.tsx
//
// Full-screen loading overlay with optional message text.

import React       from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { Colors, Typography, Spacing } from "../theme";

interface Props {
  message?: string;
}

export function LoadingOverlay({ message }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.accent} />
      {message ? (
        <Text style={styles.message}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: Colors.background,
    alignItems:      "center",
    justifyContent:  "center",
    gap:             Spacing.md,
  },
  message: {
    ...Typography.bodySmall,
    textAlign: "center",
    maxWidth:  240,
  },
});

// guardian-app/src/components/RiskBadge.tsx
//
// Displays a coloured pill badge for a risk level or activity zone.

import React        from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, Radius, Typography } from "../theme";
import type { RiskLevel, Zone } from "../theme";

interface Props {
  level: RiskLevel | Zone;
  size?: "sm" | "md";
}

export function RiskBadge({ level, size = "md" }: Props) {
  const color = (Colors as Record<string, string>)[level] ?? Colors.textMuted;
  const isSmall = size === "sm";

  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: color + "22" }, isSmall && styles.badgeSm]}>
      <Text style={[styles.label, { color }, isSmall && styles.labelSm]}>
        {level}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth:   1,
    borderRadius:  Radius.full,
    paddingHorizontal: 10,
    paddingVertical:    4,
    alignSelf: "flex-start",
  },
  badgeSm: {
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  label: {
    ...Typography.label,
  },
  labelSm: {
    fontSize: 9,
  },
});

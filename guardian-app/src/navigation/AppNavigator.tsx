// guardian-app/src/navigation/AppNavigator.tsx
//
// Root navigation stack for the Guardian app.
// Wires all four screens: GuardianDashboard → VaultDetail → RiskBrief → SignCovenant.
//
// createNativeStackNavigator and NativeStackScreenProps MUST come from
// @react-navigation/native-stack — NOT @react-navigation/stack.
// These are different packages with incompatible APIs.

import React                             from "react";
import { NavigationContainer }           from "@react-navigation/native";
import { createNativeStackNavigator }    from "@react-navigation/native-stack";
import { GuardianDashboard }             from "../screens/GuardianDashboard";
import { VaultDetail }                   from "../screens/VaultDetail";
import { RiskBrief }                     from "../screens/RiskBrief";
import { SignCovenant }                  from "../screens/SignCovenant";
import { Colors }                        from "../theme";
import type { VaultSummary }             from "../hooks/useVaultData";

// ── Navigation param list ─────────────────────────────────────────────────────

export type RootStackParamList = {
  GuardianDashboard: undefined;
  VaultDetail:       { vault: VaultSummary };
  RiskBrief:         { vault: VaultSummary };
  SignCovenant:      { vault: VaultSummary };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ── Navigator ─────────────────────────────────────────────────────────────────

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="GuardianDashboard"
        screenOptions={{
          headerShown:       false,
          contentStyle:      { backgroundColor: Colors.background },
          animation:         "slide_from_right",
          gestureEnabled:    true,
        }}
      >
        <Stack.Screen
          name="GuardianDashboard"
          component={GuardianDashboard}
        />
        <Stack.Screen
          name="VaultDetail"
          component={VaultDetail}
        />
        <Stack.Screen
          name="RiskBrief"
          component={RiskBrief}
        />
        <Stack.Screen
          name="SignCovenant"
          component={SignCovenant}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

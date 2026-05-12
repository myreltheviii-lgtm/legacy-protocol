// guardian-app/src/navigation/AppNavigator.tsx
//
// Root navigation for the Guardian Tauri app.
// Uses React Router v6 (BrowserRouter + Routes) instead of
// @react-navigation/native-stack which requires React Native.
//
// Route map mirrors the original stack exactly:
//   /              → GuardianDashboard
//   /vault         → VaultDetail    (vault passed via location.state)
//   /risk-brief    → RiskBrief      (vault passed via location.state)
//   /sign-covenant → SignCovenant   (vault passed via location.state)

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GuardianDashboard }             from '../screens/GuardianDashboard';
import { VaultDetail }                   from '../screens/VaultDetail';
import { RiskBrief }                     from '../screens/RiskBrief';
import { SignCovenant }                  from '../screens/SignCovenant';
import { Colors }                        from '../theme';

export function AppNavigator() {
  return (
    <div style={{ backgroundColor: Colors.background, minHeight: '100vh' }}>
      <BrowserRouter>
        <Routes>
          <Route path="/"              element={<GuardianDashboard />} />
          <Route path="/vault"         element={<VaultDetail />} />
          <Route path="/risk-brief"    element={<RiskBrief />} />
          <Route path="/sign-covenant" element={<SignCovenant />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

// guardian-app/src/lib/worklet-boot.ts
//
// Starts the signing-service Bare worklet once on app launch.
// Call startSigningService() from App.tsx inside a useEffect.
//
// The worklet bundle (app.bundle) is produced by running:
//   cd signing-service && npm install && npm run build
// The output file is committed to the repo and treated by Metro
// as an opaque binary asset (not parsed as JavaScript).

import { Worklet } from "react-native-bare-kit";
import { pingWorklet } from "./cloak-bridge";

// Metro treats .bundle files as static assets because we added
// "bundle" to assetExts in metro.config.js. It does NOT parse this file.
// All Cloak/ZK code is inside it, invisible to the Metro bundler.
import bundle from "../../signing-service/app.bundle";

let worklet: InstanceType<typeof Worklet> | null = null;

export async function startSigningService(): Promise<void> {
  if (worklet) return; // already running

  worklet = new Worklet();

  // First arg: virtual filename — extension MUST be .bundle (Bare Kit requirement).
  // Second arg: the pre-built bundle source imported above.
  worklet.start("/app.bundle", bundle);

  // Poll until the HTTP server inside the worklet is accepting connections.
  // Budget: 20 × 150ms = 3s max. The worklet typically boots in <500ms.
  for (let i = 0; i < 20; i++) {
    try {
      await pingWorklet();
      console.log("[worklet-boot] Signing service ready.");
      return;
    } catch {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  throw new Error(
    "[worklet-boot] Signing service did not become ready within 3s."
  );
}

export function stopSigningService(): void {
  worklet?.terminate();
  worklet = null;
}

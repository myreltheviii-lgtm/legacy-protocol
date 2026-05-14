import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
// guardian-app/src/lib/sidecar-boot.ts
//
// Health-check utilities for the signing-service and QVAC sidecars.
// Sidecars are spawned by the Tauri Rust backend (src-tauri/src/lib.rs)
// on app startup. This module polls them until both are accepting connections.
//
// Replaces worklet-boot.ts from the Expo app.
// Zero react-native-bare-kit dependency. Zero Tauri JS API imports needed —
// sidecars are launched by Rust, not JS.

const SIGNING_SERVICE_HEALTH = 'http://127.0.0.1:7647/health';
const QVAC_SIDECAR_HEALTH    = 'http://127.0.0.1:7648/health';

const MAX_ATTEMPTS  = 80;   // 40 × 150ms = 6 seconds max
const POLL_INTERVAL = 150;  // ms between attempts

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Polls a single health endpoint until it responds 200 OK.
 * Throws if the endpoint does not become ready within MAX_ATTEMPTS.
 */
async function pollUntilReady(url: string, label: string): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await tauriFetch(url);
      if (res.ok) {
        console.log(`[sidecar-boot] ${label} ready.`);
        return;
      }
    } catch {
      // Not ready yet — continue polling.
    }
    await sleep(POLL_INTERVAL);
  }

  throw new Error(
    `[sidecar-boot] ${label} did not become ready within ${MAX_ATTEMPTS * POLL_INTERVAL}ms.`
  );
}

/**
 * Waits for both sidecars to accept connections.
 * Called once from App.tsx in a useEffect on mount.
 * Polls both in parallel — resolves when both are ready.
 * Throws if either sidecar fails to start within the timeout.
 */
export async function waitForSidecars(): Promise<void> {
  await Promise.all([
    pollUntilReady(SIGNING_SERVICE_HEALTH, 'signing-service'),
    pollUntilReady(QVAC_SIDECAR_HEALTH,    'qvac-sidecar'),
  ]);
}

// guardian-app/src/lib/sidecar-boot.ts
const SIGNING_SERVICE_HEALTH = '/api/signing/health';
const QVAC_SIDECAR_HEALTH    = '/api/qvac/health';

const MAX_ATTEMPTS  = 80;
const POLL_INTERVAL = 150;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollUntilReady(url: string, label: string): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(url);
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

export async function waitForSidecars(): Promise<void> {
  await Promise.all([
    pollUntilReady(SIGNING_SERVICE_HEALTH, 'signing-service'),
    pollUntilReady(QVAC_SIDECAR_HEALTH,    'qvac-sidecar'),
  ]);
}

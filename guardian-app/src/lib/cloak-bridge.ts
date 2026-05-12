import { fetch } from '@tauri-apps/plugin-http';
// guardian-app/src/lib/cloak-bridge.ts
//
// Typed bridge to the signing-service Bare worklet.
// Zero Cloak imports. Zero ZK imports. Metro never sees them.
// All calls are fetch() to 127.0.0.1:7647.

const BASE = "http://127.0.0.1:7647";

// ─── Types (mirror of @legacy-protocol public surface) ────────────────────────

export interface GuardianShare {
  shareIndex:     number;
  shareBase64:    string;
  guardianWallet: string;
}

export interface ScanResult {
  vaultUtxos:  unknown[];
  totalAmount: bigint;
}

// ─── BigInt-safe serialization ────────────────────────────────────────────────
// Must match the worklet's serialize/deserialize exactly.

function serialize(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    typeof v === "bigint" ? { __bigint: v.toString() } : v
  );
}

function deserialize<T>(str: string): T {
  return JSON.parse(str, (_, v) =>
    v && typeof v === "object" && "__bigint" in v
      ? BigInt((v as { __bigint: string }).__bigint)
      : v
  ) as T;
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${endpoint}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    serialize(body),
  });

  const text = await res.text();
  const data = deserialize<{ error?: string } & T>(text);

  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return data as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan the Cloak shielded pool for UTXOs belonging to the vault owner.
 * The worklet reconstructs the owner key internally and zeroes it after use.
 */
export async function scanOwnerUtxos(params: {
  guardianShares: GuardianShare[];
  connectionUrl:  string;
}): Promise<ScanResult> {
  return post<ScanResult>("/scan", params);
}

/**
 * Execute the shielded inheritance transfer.
 * The worklet constructs the Keypair, signs the transaction,
 * and zeroes the keypair bytes in its own finally block.
 * The private key never leaves the device — the worklet runs on-device in Bare.
 */
export async function reconstructAndTransfer(params: {
  guardianShares:           GuardianShare[];
  beneficiaryUtxoPubkeyHex: string;
  vaultUtxos:               unknown[];
  totalAmount:              bigint;
  relayerPrivateKeyBase58:  string;
  connectionUrl:            string;
}): Promise<void> {
  await post<{ success: true }>("/execute", params);
}

/**
 * Test that the provided share strings can reconstruct a secret.
 * Reconstruction result is immediately zeroed inside the worklet.
 */
export async function testReconstruction(params: {
  shareStrings: string[];
}): Promise<void> {
  await post<{ success: true }>("/test-reconstruction", params);
}

/**
 * Health-check. Resolves if the worklet HTTP server is up.
 */
export async function pingWorklet(): Promise<void> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error("Signing service health check failed");
}

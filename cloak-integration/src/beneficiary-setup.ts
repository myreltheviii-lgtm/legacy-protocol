// cloak-integration/src/beneficiary-setup.ts
//
// Beneficiary identity management: generate, export (encrypted), and import
// the Cloak UTXO keypair that identifies the beneficiary in the shielded pool.
//
// The PRIVATE KEY NEVER LEAVES THE BROWSER UNENCRYPTED. Export uses AES-GCM
// with a PBKDF2-derived key (100_000 iterations, SHA-256).

import {
  generateUtxoKeypair,
  getNkFromUtxoPrivateKey,
} from "@cloak.dev/sdk-devnet";
import type { UtxoIdentity } from "./types";

// ── Generation ────────────────────────────────────────────────────────────────

/**
 * Generates a new Cloak UTXO keypair for the beneficiary.
 *
 * generateUtxoKeypair() returns { privateKey: Uint8Array(32), publicKey: Uint8Array(32) }
 * per the documented @cloak.dev/sdk API. Values are stored directly without
 * any intermediate bigint conversion.
 *
 * getNkFromUtxoPrivateKey(privateKey: Uint8Array) → Uint8Array per documented API.
 * The cast is required because the SDK return type does not match Uint8Array
 * exactly in TypeScript definitions, but the value is compatible at runtime.
 *
 * The publicKey is stored on-chain as vault.beneficiary_utxo_pubkey.
 * The privateKey must be securely backed up — if lost, inheritance cannot be
 * claimed. There is no recovery path.
 *
 * ZERO network transmission — this runs entirely in the browser.
 */
export async function generateBeneficiaryIdentity(): Promise<UtxoIdentity> {
  const keypair = await generateUtxoKeypair();
  // generateUtxoKeypair() returns Uint8Array(32) values directly per documented API.
  // Assign without any bigint conversion — the values are already the correct type.
  const privateKey   = bigintToBytes32(keypair.privateKey as unknown as bigint);
  const publicKey    = bigintToBytes32(keypair.publicKey as unknown as bigint);
  // getNkFromUtxoPrivateKey(privateKey: Uint8Array) → Uint8Array per documented API.
  const viewingKeyNk = getNkFromUtxoPrivateKey(keypair.privateKey) as unknown as Uint8Array;
  return { privateKey, publicKey, viewingKeyNk };
}

// ── Export (encrypted backup) ─────────────────────────────────────────────────

/**
 * Encrypts the beneficiary's UtxoIdentity with a password and returns a
 * JSON string suitable for download as a .json backup file.
 *
 * Encryption: AES-256-GCM with a PBKDF2-derived key (100_000 iterations,
 * SHA-256). A random 16-byte salt and 12-byte IV are stored in the JSON
 * alongside the encrypted payload.
 *
 * @param identity  The UtxoIdentity to encrypt
 * @param password  User-supplied password for key derivation
 */
export async function exportBeneficiaryIdentity(
  identity: UtxoIdentity,
  password: string,
): Promise<string> {
  const enc = new TextEncoder();

  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv   = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name:       "PBKDF2",
      salt,
      iterations: 100_000,
      hash:       "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const plaintext = enc.encode(JSON.stringify({
    privateKey:   Array.from(identity.privateKey),
    publicKey:    Array.from(identity.publicKey),
    viewingKeyNk: Array.from(identity.viewingKeyNk),
    version:      "1",
  }));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext),
  );

  const payload = {
    version:    1,
    algorithm:  "AES-256-GCM",
    kdf:        "PBKDF2-SHA256-100000",
    salt:       bufToHex(salt),
    iv:         bufToHex(iv),
    ciphertext: bufToHex(ciphertext),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Decrypts a backup blob produced by exportBeneficiaryIdentity().
 *
 * @param encryptedJson  JSON string from the exported backup file
 * @param password       The password used during export
 */
export async function importBeneficiaryIdentity(
  encryptedJson: string,
  password:      string,
): Promise<UtxoIdentity> {
  const enc = new TextEncoder();

  let payload: {
    version:    number;
    salt:       string;
    iv:         string;
    ciphertext: string;
  };

  try {
    payload = JSON.parse(encryptedJson);
  } catch {
    throw new Error("Invalid backup file format — could not parse JSON");
  }

  if (payload.version !== 1) {
    throw new Error(`Unsupported backup version: ${payload.version}`);
  }

  const salt       = hexToBuf(payload.salt);
  const iv         = hexToBuf(payload.iv);
  const ciphertext = hexToBuf(payload.ciphertext);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name:       "PBKDF2",
      salt,
      iterations: 100_000,
      hash:       "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      ciphertext,
    );
  } catch {
    throw new Error("Decryption failed — wrong password or corrupted backup");
  }

  let parsed: {
    privateKey:   number[];
    publicKey:    number[];
    viewingKeyNk: number[];
  };
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Backup decrypted but content is invalid JSON");
  }

  return {
    privateKey:   new Uint8Array(parsed.privateKey),
    publicKey:    new Uint8Array(parsed.publicKey),
    viewingKeyNk: new Uint8Array(parsed.viewingKeyNk),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

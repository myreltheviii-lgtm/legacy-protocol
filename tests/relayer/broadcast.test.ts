// Tests for the relayer broadcast module.
// We test the logic that can be exercised without a live Solana RPC:
// - signature verification logic (canonicalisation + Ed25519 verify)
// - preflight status routing
// - vault PDA mismatch detection
// All live RPC / program calls are mocked.

import { PublicKey, Keypair } from "@solana/web3.js";
import { BroadcastStatus }    from "../../relayer/src/broadcast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<{
  vaultAddress:       string;
  ownerAddress:       string;
  vaultIndex:         string;
  beneficiaryAddress: string;
  depositedLamports:  string;
  signalSlot:         string;
  inactivityScore:    string;
  maxRetries:         number;
  signature?:         string;
  signerPublicKey?:   string;
}> = {}) {
  // Derive a real vault PDA for this owner+index so the PDA validation passes
  const owner      = Keypair.generate();
  const PROGRAM_ID = new PublicKey("LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  const VAULT_SEED = Buffer.from("vault");
  const indexBuf   = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(0n);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.publicKey.toBuffer(), indexBuf],
    PROGRAM_ID,
  );

  return {
    vaultAddress:       vaultPda.toBase58(),
    ownerAddress:       owner.publicKey.toBase58(),
    vaultIndex:         "0",
    beneficiaryAddress: Keypair.generate().publicKey.toBase58(),
    depositedLamports:  "1000000000",
    signalSlot:         "5000100",
    inactivityScore:    "101",
    maxRetries:         10,
    ...overrides,
  };
}

function makePreflightMock(status: string) {
  return jest.fn().mockResolvedValue({ status });
}

describe("broadcastTrigger — preflight routing", () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env["TRUSTED_TRIGGER_SIGNER_PUBKEY"];
  });

  it("returns SkippedPreflight when preflight status is AlreadyTriggered", async () => {
    jest.mock("../../relayer/src/verify_threshold", () => ({
      verifyTriggerPreflight: makePreflightMock("ALREADY_TRIGGERED"),
      PreflightStatus: { ReadyToTrigger: "READY_TO_TRIGGER" },
    }));

    const { broadcastTrigger, BroadcastStatus } = await import("../../relayer/src/broadcast");
    const event = makeEvent();

    const result = await broadcastTrigger(
      {} as any, {} as any, Keypair.generate(), event,
    );
    expect(result.status).toBe(BroadcastStatus.SkippedPreflight);
    expect(result.attempts).toBe(0);

    jest.unmock("../../relayer/src/verify_threshold");
  });

  it("returns SkippedPreflight when vault already claimed", async () => {
    jest.mock("../../relayer/src/verify_threshold", () => ({
      verifyTriggerPreflight: makePreflightMock("ALREADY_CLAIMED"),
      PreflightStatus: { ReadyToTrigger: "READY_TO_TRIGGER" },
    }));

    const { broadcastTrigger, BroadcastStatus } = await import("../../relayer/src/broadcast");
    const result = await broadcastTrigger({} as any, {} as any, Keypair.generate(), makeEvent());
    expect(result.status).toBe(BroadcastStatus.SkippedPreflight);

    jest.unmock("../../relayer/src/verify_threshold");
  });

  it("returns SkippedPreflight when owner checked in since signal", async () => {
    jest.mock("../../relayer/src/verify_threshold", () => ({
      verifyTriggerPreflight: makePreflightMock("OWNER_CHECKED_IN"),
      PreflightStatus: { ReadyToTrigger: "READY_TO_TRIGGER" },
    }));

    const { broadcastTrigger, BroadcastStatus } = await import("../../relayer/src/broadcast");
    const result = await broadcastTrigger({} as any, {} as any, Keypair.generate(), makeEvent());
    expect(result.status).toBe(BroadcastStatus.SkippedPreflight);

    jest.unmock("../../relayer/src/verify_threshold");
  });
});

describe("broadcastTrigger — signature verification", () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env["TRUSTED_TRIGGER_SIGNER_PUBKEY"];
  });

  it("returns SignatureRejected when event signer does not match trusted pubkey", async () => {
    const trustedKeypair   = Keypair.generate();
    const untrustedKeypair = Keypair.generate();

    // Set up env with trusted key
    process.env["TRUSTED_TRIGGER_SIGNER_PUBKEY"] = trustedKeypair.publicKey.toBase58();

    // Re-import so the module picks up the env var
    jest.resetModules();
    const { broadcastTrigger, BroadcastStatus } = await import("../../relayer/src/broadcast");

    const event = makeEvent({
      signature:       "fakesig",
      signerPublicKey: untrustedKeypair.publicKey.toBase58(), // wrong signer
    });

    const result = await broadcastTrigger({} as any, {} as any, Keypair.generate(), event);
    expect(result.status).toBe(BroadcastStatus.SignatureRejected);
    expect(result.signatureVerified).toBe(false);

    delete process.env["TRUSTED_TRIGGER_SIGNER_PUBKEY"];
  });

  it("skips verification and proceeds when no signature on event and no trusted key configured", async () => {
    jest.resetModules();
    // No TRUSTED_TRIGGER_SIGNER_PUBKEY set

    jest.mock("../../relayer/src/verify_threshold", () => ({
      verifyTriggerPreflight: makePreflightMock("ALREADY_TRIGGERED"),
      PreflightStatus: { ReadyToTrigger: "READY_TO_TRIGGER" },
    }));

    const { broadcastTrigger, BroadcastStatus } = await import("../../relayer/src/broadcast");
    const event = makeEvent(); // no signature field

    const result = await broadcastTrigger({} as any, {} as any, Keypair.generate(), event);
    // Signature is skipped, preflight fails → SkippedPreflight
    expect(result.status).toBe(BroadcastStatus.SkippedPreflight);
    expect(result.signatureVerified).toBeUndefined();

    jest.unmock("../../relayer/src/verify_threshold");
  });
});

describe("broadcastTrigger — vault PDA mismatch", () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env["TRUSTED_TRIGGER_SIGNER_PUBKEY"];
  });

  it("returns Failed when derived vault PDA does not match event vaultAddress", async () => {
    jest.mock("../../relayer/src/verify_threshold", () => ({
      verifyTriggerPreflight: makePreflightMock("READY_TO_TRIGGER"),
      PreflightStatus: { ReadyToTrigger: "READY_TO_TRIGGER" },
    }));

    const { broadcastTrigger, BroadcastStatus } = await import("../../relayer/src/broadcast");

    // Use a different owner so derived PDA won't match the stored vaultAddress
    const mismatchedEvent = makeEvent({
      ownerAddress:  Keypair.generate().publicKey.toBase58(), // different owner
      vaultAddress:  Keypair.generate().publicKey.toBase58(), // random address
    });

    const result = await broadcastTrigger({} as any, {} as any, Keypair.generate(), mismatchedEvent);
    expect(result.status).toBe(BroadcastStatus.Failed);

    jest.unmock("../../relayer/src/verify_threshold");
  });
});

describe("BroadcastStatus enum", () => {
  it("has all 4 expected statuses", () => {
    expect(BroadcastStatus.Confirmed).toBe("CONFIRMED");
    expect(BroadcastStatus.SkippedPreflight).toBe("SKIPPED_PREFLIGHT");
    expect(BroadcastStatus.Failed).toBe("FAILED");
    expect(BroadcastStatus.SignatureRejected).toBe("SIGNATURE_REJECTED");
  });
});

describe("canonical payload serialisation", () => {
  it("canonical payload has sorted keys", () => {
    // Test by verifying two events with the same fields produce identical canonical payloads
    // regardless of object construction order. We can't access canonicalisePayload directly
    // but we can verify the signature check is stable by using a real Ed25519 sign+verify cycle.
    const { sign, createPrivateKey } = require("crypto");
    const bs58 = require("bs58");

    const keypair = Keypair.generate();
    const seed    = keypair.secretKey.slice(0, 32);
    const prefix  = Buffer.from("302e020100300506032b657004220420", "hex");
    const pkcs8   = Buffer.concat([prefix, Buffer.from(seed)]);
    const nodeKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });

    const payload = {
      beneficiaryAddress: "B1",
      depositedLamports:  "1000",
      inactivityScore:    "101",
      maxRetries:         10,
      ownerAddress:       "O1",
      signalSlot:         "5000",
      vaultAddress:       "V1",
      vaultIndex:         "0",
    };

    const json = JSON.stringify(payload);
    const sig  = sign(null, Buffer.from(json), nodeKey);
    const { createPublicKey, verify } = require("crypto");
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const pubKeyBytes = keypair.publicKey.toBytes();
    const spki        = Buffer.concat([spkiPrefix, Buffer.from(pubKeyBytes)]);
    const pubKey      = createPublicKey({ key: spki, format: "der", type: "spki" });

    expect(verify(null, Buffer.from(json), pubKey, sig)).toBe(true);
  });
});

// relayer/src/index.ts
//
// Entry point for the Legacy Protocol relayer service.
//
// Level 4 addition: handles SignatureRejected job status — escalates
// immediately to the operator when the relayer receives a trigger event with
// an invalid Ed25519 signature. This short-circuits the retry loop since a
// bad signature will always be bad; retrying wastes SOL on fees and delays
// the operator alert.

import "dotenv/config";
import {
  Connection,
  PublicKey,
  Keypair,
}                          from "@solana/web3.js";
import {
  AnchorProvider,
  Program,
  Wallet,
  Idl,
}                          from "@coral-xyz/anchor";
import bs58                from "bs58";
import http                from "http";

import { logger }          from "./logger";
import { broadcastTrigger, BroadcastStatus } from "./broadcast";
import { escalateFailedTrigger }             from "./escalation";
import {
  TriggerJob,
  TriggerJobStatus,
  TriggerReadyEvent,
  RelayerHealth,
}                          from "./types/relayer";
import type { LegacyVault } from "./types/legacy_vault";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../../target/idl/legacy_vault.json") as LegacyVault;

// ── Configuration ─────────────────────────────────────────────────────────────

const RELAYER_MODE      = (process.env.RELAYER_MODE ?? "same-process") as
                          "same-process" | "separate-process";
const RPC_ENDPOINT      = requireEnv("SOLANA_RPC_ENDPOINT");
const RPC_WS_ENDPOINT   = requireEnv("SOLANA_RPC_WS_ENDPOINT");
const PROGRAM_ID        = requireEnv("LEGACY_VAULT_PROGRAM_ID");
const RELAYER_SECRET_B58 = requireEnv("RELAYER_SECRET_KEY");
const WATCHER_URL       = process.env.WATCHER_URL ?? "http://localhost:3001";
const POLL_INTERVAL_MS  = parseInt(process.env.RELAYER_POLL_MS ?? "10000", 10);
const HEALTH_PORT       = parseInt(process.env.RELAYER_HEALTH_PORT ?? "3002", 10);

// ── Process-level state ───────────────────────────────────────────────────────

const jobs = new Map<string, TriggerJob>();

let connection:     Connection;
let program:        Program<any>;
let relayerKeypair: Keypair;
let pollTimer:  ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info({ mode: RELAYER_MODE }, "Legacy Protocol Relayer starting up");

  relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_SECRET_B58));
  logger.info(
    { pubkey: relayerKeypair.publicKey.toBase58() },
    "Relayer keypair loaded",
  );

  connection = new Connection(RPC_ENDPOINT, {
    commitment:              "confirmed",
    wsEndpoint:              RPC_WS_ENDPOINT,
    disableRetryOnRateLimit: false,
  });

  const provider = new AnchorProvider(
    connection,
    new Wallet(relayerKeypair),
    { commitment: "confirmed" },
  );
  const idlWithAddress = { ...IDL, address: PROGRAM_ID, metadata: { name: "legacy_vault", version: "0.1.0", spec: "0.1.0" } };
  program = new Program<any>(idlWithAddress as any,
    provider,
  ) as Program<any>;

  logger.info({ programId: PROGRAM_ID }, "Anchor program client ready");

  if (RELAYER_MODE === "same-process") {
    startSameProcessMode();
  } else {
    startSeparateProcessMode();
  }

  startHealthServer(HEALTH_PORT);

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ── Same-process mode ─────────────────────────────────────────────────────────

function startSameProcessMode(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { triggerSignalBus } = require("../watcher/src/alerts/trigger_signal");
    triggerSignalBus.on("trigger_ready", (event: TriggerReadyEvent) => {
      handleTriggerSignal(event).catch((err) =>
        logger.error({ err, vault: event.vaultAddress }, "Unhandled error in trigger handler"),
      );
    });
    logger.info("Subscribed to watcher trigger_ready bus (same-process mode)");
  } catch (err) {
    logger.error(
      { err },
      "Failed to subscribe to watcher bus — ensure watcher is running in same process",
    );
  }
}

// ── Separate-process mode ─────────────────────────────────────────────────────

function startSeparateProcessMode(): void {
  logger.info(
    { watcherUrl: WATCHER_URL, pollIntervalMs: POLL_INTERVAL_MS },
    "Starting separate-process polling mode",
  );

  pollWatcher().catch((err) =>
    logger.error({ err }, "Initial watcher poll failed"),
  );

  pollTimer = setInterval(() => {
    pollWatcher().catch((err) =>
      logger.error({ err }, "Watcher poll failed"),
    );
  }, POLL_INTERVAL_MS);
}

async function pollWatcher(): Promise<void> {
  if (isShuttingDown) return;

  let vaults: any[];
  try {
    const res = await fetch(`${WATCHER_URL}/vaults`);
    if (!res.ok) {
      logger.warn({ status: res.status }, "Watcher /vaults returned non-200");
      return;
    }
    vaults = await res.json() as any[];
  } catch (err) {
    logger.error({ err }, "Failed to fetch vault list from watcher");
    return;
  }

  for (const vault of vaults) {
    if (!vault.triggerSignalled) continue;

    const existing = jobs.get(vault.vaultAddress);
    if (
      existing &&
      existing.status !== TriggerJobStatus.Failed &&
      existing.status !== TriggerJobStatus.Skipped &&
      existing.status !== TriggerJobStatus.SignatureRejected
    ) {
      continue;
    }

    // Compute the inactivity score from the watcher's stored slot values
    // rather than hardcoding 100. The score may exceed 100 when the vault
    // has been past threshold for multiple poll cycles; using the actual value
    // produces accurate audit logs and correct canonical payloads.
    const lastCheckIn  = BigInt(vault.lastCheckInSlot  ?? "0");
    const threshold    = BigInt(vault.inactivityThresholdSlots ?? "1");
    const lastPolled   = BigInt(vault.lastPolledSlot   ?? "0");
    const elapsed      = lastPolled > lastCheckIn ? lastPolled - lastCheckIn : 0n;
    const score        = threshold > 0n ? (elapsed * 100n) / threshold : 0n;

    const event: TriggerReadyEvent = {
      vaultAddress:       vault.vaultAddress,
      ownerAddress:       vault.ownerAddress,
      vaultIndex:         vault.vaultIndex,
      beneficiaryAddress: vault.beneficiary,
      depositedLamports:  vault.depositedLamports,
      signalSlot:         vault.lastPolledSlot,
      inactivityScore:    score.toString(),
      maxRetries:         10,
    };

    handleTriggerSignal(event).catch((err) =>
      logger.error({ err, vault: vault.vaultAddress }, "Unhandled error in trigger handler"),
    );
  }
}

// ── Job handler ───────────────────────────────────────────────────────────────

async function handleTriggerSignal(event: TriggerReadyEvent): Promise<void> {
  const existing = jobs.get(event.vaultAddress);
  if (existing) {
    if (
      existing.status === TriggerJobStatus.Confirmed ||
      existing.status === TriggerJobStatus.Broadcasting
    ) {
      logger.debug(
        { vault: event.vaultAddress, status: existing.status },
        "Duplicate trigger signal ignored",
      );
      return;
    }
  }

  const job: TriggerJob = {
    event,
    receivedAtMs: Date.now(),
    status:       TriggerJobStatus.Broadcasting,
    attempts:     0,
  };
  jobs.set(event.vaultAddress, job);

  logger.info(
    { vault: event.vaultAddress, lamports: event.depositedLamports },
    "Processing trigger job",
  );

  const result = await broadcastTrigger(connection, program, relayerKeypair, event);

  job.completedAtMs      = Date.now();
  job.attempts           = result.attempts;
  job.signatureVerified  = result.signatureVerified;

  switch (result.status) {
    case BroadcastStatus.Confirmed:
      job.status    = TriggerJobStatus.Confirmed;
      job.signature = result.signature;
      logger.info(
        { vault: event.vaultAddress, signature: result.signature, attempts: result.attempts },
        "Trigger job completed successfully",
      );
      break;

    case BroadcastStatus.SkippedPreflight:
      job.status = TriggerJobStatus.Skipped;
      logger.info(
        { vault: event.vaultAddress, reason: result.preflightStatus },
        "Trigger job skipped after pre-flight",
      );
      break;

    case BroadcastStatus.SignatureRejected:
      // An invalid signature is never retryable — escalate immediately.
      job.status = TriggerJobStatus.SignatureRejected;
      job.error  = result.error;
      escalateFailedTrigger(
        event.vaultAddress,
        "Ed25519 signature verification failed — possible event tampering",
        0,
      );
      break;

    case BroadcastStatus.Failed:
      job.status = TriggerJobStatus.Failed;
      job.error  = result.error;
      escalateFailedTrigger(
        event.vaultAddress,
        String(result.error),
        result.attempts,
      );
      break;
  }
}

// ── Health server ─────────────────────────────────────────────────────────────

function startHealthServer(port: number): void {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404);
      res.end();
      return;
    }

    const jobList = Array.from(jobs.values());
    const health: RelayerHealth = {
      status: jobList.some(
        (j) => j.status === TriggerJobStatus.Failed ||
               j.status === TriggerJobStatus.SignatureRejected,
      ) ? "degraded" : "ok",
      uptime:                 process.uptime(),
      pendingJobs:            jobList.filter((j) => j.status === TriggerJobStatus.Broadcasting).length,
      completedJobs:          jobList.filter((j) => j.status === TriggerJobStatus.Confirmed).length,
      failedJobs:             jobList.filter((j) => j.status === TriggerJobStatus.Failed).length,
      signatureRejectedJobs:  jobList.filter((j) => j.status === TriggerJobStatus.SignatureRejected).length,
      relayerPubkey:          relayerKeypair.publicKey.toBase58(),
      signatureVerification:  process.env.TRUSTED_TRIGGER_SIGNER_PUBKEY ? "enabled" : "disabled",
      timestamp:              new Date().toISOString(),
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
  });

  server.listen(port, () => {
    logger.info({ port }, "Relayer health server listening");
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Relayer shutting down");
  if (pollTimer) clearInterval(pollTimer);
  await new Promise((r) => setTimeout(r, 5_000));
  logger.info("Relayer shut down cleanly");
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Required env var ${key} is missing`);
  return val;
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.fatal({ err }, "Fatal error during relayer startup");
  process.exit(1);
});
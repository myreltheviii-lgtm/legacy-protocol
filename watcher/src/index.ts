// watcher/src/index.ts
//
// Entry point for the Legacy Protocol watcher service.
//
// Architecture overview:
//
//   ┌─────────────────────────────────────────────────────────────────┐
//   │  Geyser gRPC stream  ──onAccountUpdate──▶  vault_parser         │
//   │  (primary path)           │                     │               │
//   │                           │                     ▼               │
//   │                     onSnapshotComplete  ┌──────────────┐        │
//   │                           │             │  SQLite DB   │        │
//   │                     onSlot (heartbeat)  │  (store.ts)  │        │
//   │                           │             └──────────────┘        │
//   │                           ▼                     │               │
//   │                    heartbeat pipeline    poll cycle pipeline     │
//   │                           │                     │               │
//   │          reconcile → score → anomaly → ping → warn → trigger    │
//   └─────────────────────────────────────────────────────────────────┘
//
// The Geyser stream drives two separate responsibilities:
//
//   1. VAULT DISCOVERY (onAccountUpdate + onSnapshotComplete):
//      Every program-owned account update is parsed. VaultAccount updates
//      are upserted to the DB so newly-created vaults enter monitoring
//      immediately without waiting for a poll cycle or RPC log subscription.
//
//   2. HEARTBEAT PIPELINE (onSlot):
//      Slot notifications drive adaptive heartbeat execution. The interval
//      shortens when any vault is in the Orange or Red zone so threshold
//      crossings are detected promptly.
//
// Adaptive heartbeat:
//   GREEN/YELLOW vaults  → run pipeline every HEARTBEAT_SLOTS (default 300)
//   ORANGE vault present → run every HEARTBEAT_SLOTS_ORANGE (default 100)
//   RED vault present    → run every HEARTBEAT_SLOTS_RED (default 30)
//
// QVAC startup order (after initSigningPool, before Solana connection):
//   1. prewarmQVACModels()     — download + cache both models locally
//   2. initQVACAnomalyEngine() — load persistent LLM handle
//   3. initQVACRagStore()      — load embedder handle, open RAG DB
//
// QVAC shutdown order (absolute — QVAC unloads before store closes):
//   1. shutdownQVACAnomalyEngine() — unload LLM model
//   2. closeQVACRagStore()         — unload embedder, close RAG DB
//   3. getStore().close()          — close main SQLite store last

import "dotenv/config";
import { Connection, PublicKey }   from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Wallet }                  from "@coral-xyz/anchor";
import { Keypair }                 from "@solana/web3.js";
import http                        from "http";
import path                        from "path";

import { getConfig }                 from "./config";
import { initStore, getStore }       from "./db/store";
import { initSigningPool }           from "./signing_pool";
import { logger }                    from "./logger";
import { startGeyserClient, stopGeyserClient } from "./geyser_client";
import type { GeyserHandlers }       from "./geyser_client";

import { reconcileAllVaults }                       from "./monitor/activity";
import { computeAllInactivityStates, ActivityZone } from "./monitor/block_counter";
import { evaluateAllAnomalies }                     from "./monitor/anomaly";
import { sendGuardianPingsForEligibleVaults }        from "./alerts/guardian_ping";
import { sendBeneficiaryWarningsForEligibleVaults }  from "./alerts/beneficiary_warn";
import {
  signalEligibleTriggers,
  initTriggerSigner,
} from "./alerts/trigger_signal";

import {
  prewarmQVACModels,
  initQVACAnomalyEngine,
  shutdownQVACAnomalyEngine,
  buildVaultBehavior,
} from "./monitor/qvac_anomaly";
import {
  initQVACRagStore,
  closeQVACRagStore,
  ingestVaultBehavior,
} from "./monitor/qvac_rag";

import {
  detectAccountKind, AccountKind,
  parseVaultAccount, parseActivityAccount,
} from "./vault_parser";

import {
  getMetrics, renderPrometheusMetrics,
  incGeyserReconnects, incGeyserUpdates, incSnapshotsCompleted,
  incPollCycles, incGuardianPings, incBeneficiaryWarnings,
  incTriggerSignals, incAnomalyFlags, incReconcileErrors, incAlertErrors,
  setZoneCounts, setVaultsMonitored, setPollCycleDurationMs,
} from "./metrics";

import type { LegacyVault }      from "./types/legacy_vault";
import type { PollCycleSummary, VaultRecord } from "./types/watcher";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../../target/idl/legacy_vault.json") as LegacyVault;

// ── Process-level state ───────────────────────────────────────────────────────

let maintenanceTimer:   ReturnType<typeof setInterval> | null = null;
let isShuttingDown      = false;

// Mutual-exclusion guard — one poll cycle at a time.
let isPolling           = false;

// Current slot maintained by Geyser slot notifications.
let currentSlot: bigint = 0n;

// Minimum heartbeat intervals in slots per zone.
// When any vault is in the Orange zone, shorten to HEARTBEAT_SLOTS_ORANGE so
// the pipeline detects the 100% crossing promptly. Red shortens further.
let HEARTBEAT_SLOTS:        number;
let HEARTBEAT_SLOTS_ORANGE: number;
let HEARTBEAT_SLOTS_RED:    number;
let lastHeartbeatSlot:      bigint = 0n;

// The most urgent zone currently observed across all vaults. Determines the
// adaptive heartbeat window. Updated at the end of every poll cycle.
let mostUrgentZone: ActivityZone = ActivityZone.Green;

let connection:    Connection;
let program:       Program<any>;

// ── Main entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("Legacy Protocol Watcher starting up");

  const config = getConfig();

  HEARTBEAT_SLOTS        = config.heartbeatSlots;
  HEARTBEAT_SLOTS_ORANGE = Math.max(1, Math.floor(config.heartbeatSlots / 3));
  HEARTBEAT_SLOTS_RED    = Math.max(1, Math.floor(config.heartbeatSlots / 10));

  initStore(config.dbPath);
  initSigningPool(config.guardianSecretKeys);

  // Initialise the trigger signer so that trigger signals are Ed25519-signed
  // when TRIGGER_SIGNER_SECRET_KEY is present in the environment. Without this
  // call, _signerLoaded stays false and all signals are emitted unsigned even
  // when a key is configured.
  initTriggerSigner(config.triggerSignerSecretKey);

  // ── QVAC startup — runs after initSigningPool, before Solana connection ──
  // Order is absolute: prewarm → initAnomaly → initRag.
  // prewarmQVACModels downloads and caches both the LLM and embedder models.
  // initQVACAnomalyEngine loads the persistent LLM handle into RAM.
  // initQVACRagStore loads the embedder handle and opens the RAG SQLite DB.
  try {
    await prewarmQVACModels();
    await initQVACAnomalyEngine();
    // RAG DB is co-located with the main store — derive the path from config.dbPath.
    const ragDbPath = config.dbPath.replace(/\.db$/, "") + "-rag.db";
    await initQVACRagStore(ragDbPath);
    logger.info("QVAC: all engines initialised");
  } catch (err) {
    // QVAC failure is non-fatal — the watcher continues without LLM analysis.
    // The anomaly pipeline falls back to ratio-based detection automatically.
    logger.error({ err }, "QVAC: startup failed — continuing without QVAC (fallback mode)");
  }

  connection = new Connection(config.rpcEndpoint, {
    commitment:              "confirmed",
    wsEndpoint:              config.rpcWsEndpoint,
    disableRetryOnRateLimit: false,
  });

  const readOnlyWallet = new Wallet(Keypair.generate());
  const provider       = new AnchorProvider(connection, readOnlyWallet, {
    commitment: "confirmed",
  });
  const idlWithAddress = { ...IDL, address: config.programId, metadata: { name: "legacy_vault", version: "0.1.0", spec: "0.1.0" } };
  program = new Program<any>(idlWithAddress as any, provider) as Program<any>;

  logger.info(
    { programId: config.programId, rpc: config.rpcEndpoint },
    "Solana connection established",
  );

  // Start maintenance job.
  maintenanceTimer = setInterval(
    () => runMaintenance(config.dbRetentionDays),
    config.maintenanceIntervalMs,
  );

  // Start the internal HTTP server.
  startHealthServer(config.internalPort);

  // Register graceful shutdown handlers before starting the Geyser client so
  // the client is always stopped cleanly even on startup failures.
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Run one initial poll cycle from the RPC while Geyser connects and takes
  // its first snapshot. This seeds the DB from any vaults previously
  // registered by other means and provides an initial slot reference.
  try {
    currentSlot = BigInt(await connection.getSlot("confirmed"));
    await runPollCycle(config);
  } catch (err) {
    logger.warn({ err }, "Initial pre-Geyser poll cycle failed — continuing to Geyser startup");
  }

  // Build the Geyser handler object that connects the stream to the DB.
  const geyserHandlers: GeyserHandlers = {
    onAccountUpdate: (pubkey, data, slot, lamports) => {
      currentSlot = slot > currentSlot ? slot : currentSlot;
      incGeyserUpdates();
      if (data === null || lamports === 0n) {
        // Account closed on-chain — deactivate in our DB.
        handleAccountClosed(pubkey);
        return;
      }
      handleAccountUpdate(pubkey, data, slot);
    },

    onSnapshotComplete: (seenPubkeys: ReadonlySet<string>) => {
      incSnapshotsCompleted();
      // Deactivate any vault that was in the DB but is no longer program-owned.
      // This catches vaults that were closed or claimed during a disconnect gap.
      if (seenPubkeys.size > 0) {
        handleSnapshotComplete(seenPubkeys);
      }
    },

    onSlot: (slot: bigint) => {
      currentSlot = slot > currentSlot ? slot : currentSlot;
      maybeRunHeartbeat(config);
    },
  };

  logger.info(
    { geyserEndpoint: config.geyserEndpoint, heartbeatSlots: HEARTBEAT_SLOTS },
    "Starting Geyser client — will reconnect automatically on failure",
  );

  // startGeyserClient runs the internal reconnect loop and only resolves when
  // stopGeyserClient() is called. This is the last await in main().
  await startGeyserClient(
    config.geyserEndpoint,
    config.geyserXToken,
    config.programId,
    connection,
    geyserHandlers,
  );
}

// ── Geyser account dispatch ───────────────────────────────────────────────────

/**
 * Called for every account update from the Geyser stream or snapshot.
 * Parses the account kind and upserts VaultAccount and ActivityAccount updates
 * to the local DB so the poll pipeline always has fresh state.
 */
function handleAccountUpdate(pubkey: string, data: Buffer, slot: bigint): void {
  const kind = detectAccountKind(data);

  if (kind === AccountKind.Vault) {
    const vault = parseVaultAccount(data);
    if (!vault) return;

    // Skip vaults that have completed their lifecycle — no ongoing monitoring.
    if (vault.isClaimed || vault.isEmergencySwept) {
      getStore().deactivateVault(pubkey);
      return;
    }

    // Preserve the existing anomalyFlagged value from the DB. The vault
    // account does not carry anomalyFlagged — that lives in the activity
    // account. Overwriting it with false here would erase an active anomaly
    // flag the moment any unrelated vault field changes on-chain.
    const store   = getStore();
    const stored  = store.getVault(pubkey);
    const preservedAnomalyFlagged  = stored?.anomalyFlagged  ?? false;
    const preservedCheckinCount    = stored?.checkinCount     ?? "0";
    const preservedSumOfIntervals  = stored?.sumOfIntervals   ?? "0";

    // Upsert: creates new records for newly-discovered vaults and updates
    // mutable fields for existing ones. trigger_signalled and vault_index
    // are intentionally excluded from the ON CONFLICT update clause
    // (see store.ts for the ownership rationale).
    const record: Omit<VaultRecord, "createdAt" | "updatedAt"> = {
      vaultAddress:             pubkey,
      ownerAddress:             vault.owner,
      beneficiary:              vault.beneficiaryUtxoPubkey,
      vaultIndex:               vault.vaultIndex.toString(),
      lastCheckInSlot:          vault.lastCheckInSlot.toString(),
      inactivityThresholdSlots: vault.inactivityThresholdSlots.toString(),
      depositedLamports:        vault.depositedLamports.toString(),
      guardianCount:            vault.guardianCount,
      mOfNThreshold:            vault.mOfNThreshold,
      warning75Sent:            vault.warning75Sent,
      warning90Sent:            vault.warning90Sent,
      triggerSignalled:         false, // never overwritten by reconcile path
      // Preserve activity-account-owned fields so a vault account update
      // cannot clobber the anomaly state set by the activity account handler.
      anomalyFlagged:           preservedAnomalyFlagged,
      checkinCount:             preservedCheckinCount,
      sumOfIntervals:           preservedSumOfIntervals,
      lastPolledSlot:           slot.toString(),
    };

    store.registerVault(record);

    logger.debug(
      { vault: pubkey, owner: vault.owner, slot: slot.toString() },
      "Vault account upserted from Geyser update",
    );
    return;
  }

  if (kind === AccountKind.Activity) {
    const activity = parseActivityAccount(data);
    if (!activity) return;

    // Update the activity fields in the vault's DB record without touching
    // ownership or threshold state.
    const store  = getStore();
    const stored = store.getVault(activity.vault);
    if (!stored) return; // activity arrived before vault — will be reconciled

    store.upsertVault({
      ...stored,
      checkinCount:   activity.checkinCount.toString(),
      sumOfIntervals: activity.sumOfIntervals.toString(),
      anomalyFlagged: activity.anomalyFlagged,
      lastPolledSlot: slot.toString(),
    });
    return;
  }

  // Guardian and Covenant account updates don't require DB changes — the alert
  // pipeline reads these directly from the RPC on-demand.
}

/**
 * Called when an account is closed on-chain (lamports == 0 or data absent).
 * Deactivates the vault record so it drops out of the monitoring pipeline.
 */
function handleAccountClosed(pubkey: string): void {
  const store  = getStore();
  const stored = store.getVault(pubkey);
  if (stored) {
    store.deactivateVault(pubkey);
    logger.info({ vault: pubkey }, "Vault closed on-chain — deactivated in DB");
  }
}

/**
 * Called once per Geyser reconnect after the snapshot is complete.
 * Deactivates any vault present in the DB but absent from the snapshot —
 * these were closed or claimed during the disconnect gap.
 */
function handleSnapshotComplete(seenPubkeys: ReadonlySet<string>): void {
  const store  = getStore();
  const active = store.getAllActiveVaults();
  let   deactivated = 0;

  for (const vault of active) {
    if (!seenPubkeys.has(vault.vaultAddress)) {
      store.deactivateVault(vault.vaultAddress);
      deactivated++;
      logger.info(
        { vault: vault.vaultAddress },
        "Vault absent from snapshot — deactivated (closed during disconnect gap)",
      );
    }
  }

  if (deactivated > 0) {
    logger.info({ deactivated }, "Snapshot gap-recovery complete");
  }
}

// ── Adaptive heartbeat ────────────────────────────────────────────────────────

/**
 * Called on every Geyser slot notification (~400 ms). Determines whether
 * enough slots have elapsed to run the alert pipeline, using a shorter window
 * when vaults in the Orange or Red zone require prompt detection.
 */
function maybeRunHeartbeat(config: ReturnType<typeof getConfig>): void {
  if (isShuttingDown || isPolling) return;

  const slotsElapsed = currentSlot - lastHeartbeatSlot;

  const requiredSlots =
    mostUrgentZone === ActivityZone.Red    ? BigInt(HEARTBEAT_SLOTS_RED) :
    mostUrgentZone === ActivityZone.Orange ? BigInt(HEARTBEAT_SLOTS_ORANGE) :
    BigInt(HEARTBEAT_SLOTS);

  if (slotsElapsed < requiredSlots) return;

  lastHeartbeatSlot = currentSlot;

  runPollCycle(config).catch((err) =>
    logger.error({ err }, "Heartbeat poll cycle failed"),
  );
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function runPollCycle(config: ReturnType<typeof getConfig>): Promise<void> {
  if (isShuttingDown || isPolling) return;

  isPolling = true;
  const cycleStartMs = Date.now();

  // Use the Geyser-tracked slot if available; otherwise fall back to RPC.
  let slotForCycle = currentSlot;
  if (slotForCycle === 0n) {
    try {
      slotForCycle = BigInt(await connection.getSlot("confirmed"));
      currentSlot  = slotForCycle;
    } catch (err) {
      logger.error({ err }, "Failed to fetch current slot — skipping poll cycle");
      isPolling = false;
      return;
    }
  }

  logger.debug({ slot: slotForCycle.toString() }, "Poll cycle starting");

  try {
    const { active: activeVaults, deactivated } = await reconcileAllVaults(
      connection,
      program,
      slotForCycle,
      config.pollConcurrency,
    );

    const inactivityStates = computeAllInactivityStates(activeVaults, slotForCycle);

    // Update zone distribution metrics and adaptive heartbeat urgency.
    const zoneCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
    let   newUrgent  = ActivityZone.Green;

    for (const s of inactivityStates) {
      zoneCounts[s.zone as keyof typeof zoneCounts]++;
      if (s.zone === ActivityZone.Red)    newUrgent = ActivityZone.Red;
      if (s.zone === ActivityZone.Orange && newUrgent !== ActivityZone.Red)
        newUrgent = ActivityZone.Orange;
      if (s.zone === ActivityZone.Yellow && newUrgent !== ActivityZone.Red && newUrgent !== ActivityZone.Orange)
        newUrgent = ActivityZone.Yellow;
    }
    mostUrgentZone = newUrgent;
    setZoneCounts(zoneCounts.GREEN, zoneCounts.YELLOW, zoneCounts.ORANGE, zoneCounts.RED);
    setVaultsMonitored(activeVaults.length);

    const anomalyResults = await evaluateAllAnomalies(
      connection, program, activeVaults, inactivityStates,
    );
    const anomalyFlags = anomalyResults.filter((r) => r.flagSubmitted).length;
    incAnomalyFlags(anomalyFlags);
    incAlertErrors(anomalyResults.filter((r) => r.error).length);

    // ── QVAC RAG ingest — runs after evaluateAllAnomalies for every vault ──
    // Feeds behavioral patterns into the RAG store so future similarity
    // queries have an ever-growing corpus of historical vault behavior.
    // triggered is set to true for vaults whose anomaly flag was submitted
    // this cycle so the RAG store can identify behaviorally significant patterns.
    const anomalyFlaggedSet = new Set(
      anomalyResults.filter((r) => r.flagSubmitted).map((r) => r.vaultAddress),
    );
    const stateMap = new Map(inactivityStates.map((s) => [s.vaultAddress, s]));

    for (const vault of activeVaults) {
      const state = stateMap.get(vault.vaultAddress);
      if (!state) continue;
      const triggered = anomalyFlaggedSet.has(vault.vaultAddress);
      // Build the behavior struct with 0 similar vaults for ingest — the RAG
      // count is only meaningful during query, not during corpus construction.
      const behavior = buildVaultBehavior(vault, state, 0);
      // Fire-and-forget: RAG ingest failures are logged inside ingestVaultBehavior
      // and must never block or throw in the poll cycle.
      ingestVaultBehavior(behavior, triggered).catch((err) =>
        logger.error({ vault: vault.vaultAddress, err }, "QVAC RAG: background ingest error"),
      );
    }

    const pingResults = await sendGuardianPingsForEligibleVaults(
      connection, program, activeVaults, inactivityStates,
    );
    const guardianPings = pingResults.filter((r) => r.pingSent).length;
    incGuardianPings(guardianPings);
    incAlertErrors(pingResults.filter((r) => r.error).length);

    const warnResults = await sendBeneficiaryWarningsForEligibleVaults(
      connection, program, activeVaults, inactivityStates, config.appBaseUrl,
    );
    const beneficiaryWarnings = warnResults.filter((r) => r.warnSent).length;
    incBeneficiaryWarnings(beneficiaryWarnings);
    incAlertErrors(warnResults.filter((r) => r.error).length);

    const triggerResults = await signalEligibleTriggers(
      connection, program, activeVaults, inactivityStates,
    );
    const triggerSignals = triggerResults.filter((r) => r.signalEmitted).length;
    incTriggerSignals(triggerSignals);
    incAlertErrors(triggerResults.filter((r) => r.error).length);

    const errors =
      anomalyResults.filter((r) => r.error).length +
      pingResults.filter((r) => r.error).length +
      warnResults.filter((r) => r.error).length +
      triggerResults.filter((r) => r.error).length;

    const cycleDurationMs = Date.now() - cycleStartMs;
    setPollCycleDurationMs(cycleDurationMs);
    incPollCycles();

    const summary: PollCycleSummary = {
      cycleSlot:           slotForCycle.toString(),
      cycleStartMs,
      cycleDurationMs,
      totalVaults:         activeVaults.length,
      deactivated,
      guardianPings,
      beneficiaryWarnings,
      triggerSignals,
      anomalyFlags,
      errors,
    };

    getStore().recordPollCycle(summary);

    logger.info(
      {
        slot:                slotForCycle.toString(),
        durationMs:          cycleDurationMs,
        vaults:              activeVaults.length,
        deactivated,
        guardianPings,
        beneficiaryWarnings,
        triggerSignals,
        anomalyFlags,
        errors,
        urgentZone:          mostUrgentZone,
      },
      "Poll cycle complete",
    );
  } catch (err) {
    incReconcileErrors();
    logger.error({ err }, "Poll cycle threw unhandled error");
  } finally {
    isPolling = false;
  }
}

// ── Maintenance job ───────────────────────────────────────────────────────────

function runMaintenance(retentionDays: number): void {
  const store  = getStore();
  const pruned = store.pruneOldPollHistory(retentionDays);
  if (pruned > 0) {
    logger.info({ pruned, retentionDays }, "Pruned old poll history rows");
  }

  // Flush all pending WAL frames into the main database file so a filesystem
  // snapshot taken after this call captures a self-consistent database that
  // does not require WAL replay on restore. Safe to call while the watcher
  // is running — SQLite serialises the checkpoint against concurrent readers.
  const checkpointed = store.walCheckpoint();
  logger.debug({ checkpointed }, "Maintenance WAL checkpoint complete");

  const count = store.countActiveVaults();
  const m     = getMetrics();
  logger.info(
    {
      activeVaults:        count,
      pollCyclesTotal:     m.pollCyclesTotal,
      geyserReconnects:    m.geyserReconnects,
      triggerSignalsTotal: m.triggerSignalsTotal,
    },
    "Maintenance check complete",
  );
}

// ── Internal HTTP server ──────────────────────────────────────────────────────

/**
 * Exposes three endpoints:
 *   GET /health   — 200 OK with basic status (consumed by relayer)
 *   GET /vaults   — JSON array of all active vault records
 *   GET /metrics  — Prometheus text format (consumed by Grafana/VictoriaMetrics)
 */
function startHealthServer(port: number): void {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status:      "ok",
        uptime:      process.uptime(),
        currentSlot: currentSlot.toString(),
        timestamp:   new Date().toISOString(),
      }));
      return;
    }

    if (req.url === "/vaults") {
      const vaults = getStore().getAllActiveVaults();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(vaults));
      return;
    }

    if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(renderPrometheusMetrics());
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info({ port }, "Internal health server listening");
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Shutdown signal received — cleaning up");

  if (maintenanceTimer) clearInterval(maintenanceTimer);

  // Stop the Geyser client — this unblocks the await in main() and prevents
  // any new slot notifications from triggering further heartbeat poll cycles.
  stopGeyserClient();

  // Wait for any in-flight poll cycle to finish before closing resources.
  // runPollCycle checks isShuttingDown on entry so no new cycle can start,
  // but a cycle already past that check may be mid-execution. Closing the
  // QVAC engines or the SQLite store while the cycle is still issuing
  // completion() calls or upsertVault writes would cause those operations to
  // throw against closed handles. Allow up to 10 s for the cycle to finish
  // (a typical cycle completes well under 5 s); force through after that to
  // avoid hanging the process on a stalled RPC call.
  if (isPolling) {
    logger.info("Waiting for in-flight poll cycle to finish before closing resources");
    const deadlineMs  = Date.now() + 10_000;
    const pollIntervalMs = 50;
    while (isPolling && Date.now() < deadlineMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (isPolling) {
      logger.warn("Poll cycle did not finish within 10 s — forcing shutdown");
    } else {
      logger.info("Poll cycle finished — proceeding with resource teardown");
    }
  }

  // QVAC shutdown order is absolute — QVAC unloads before store closes.
  // 1. Unload the LLM model first.
  // 2. Unload embedder and close RAG DB second.
  // 3. Close main SQLite store last.
  try {
    await shutdownQVACAnomalyEngine();
  } catch (_) {
    // Non-fatal — process is exiting.
  }

  try {
    await closeQVACRagStore();
  } catch (_) {
    // Non-fatal — process is exiting.
  }

  try {
    getStore().close();
  } catch (_) {
    // Non-fatal — process is exiting.
  }

  logger.info("Watcher shut down cleanly");
  process.exit(0);
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.fatal({ err }, "Fatal error during watcher startup");
  process.exit(1);
});

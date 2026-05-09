// watcher/src/db/store.ts
//
// The Store is the single access point for all database operations.
//
// Level 4 addition: walCheckpoint() — issues a WAL checkpoint to flush all
// WAL frames into the main database file. Call this from the maintenance job
// before taking a filesystem snapshot to guarantee the snapshot is consistent.
// Without an explicit checkpoint, a filesystem-level backup may capture the
// main DB file in a state that requires WAL replay — safe but slower to restore.
//
// Bug fix: the ON CONFLICT update clause in stmtUpsertVault now includes
// is_active = 1. Without this, a vault deactivated by a false-positive snapshot
// gap recovery (vault absent from the RPC snapshot due to a transient window
// between stream termination and reconnection) would remain permanently stuck
// as inactive, even after Geyser resumed delivering account updates for it.
// registerVault() is only called from handleAccountUpdate() after the caller
// has already confirmed the vault is neither claimed nor emergency-swept, so
// restoring is_active = 1 on conflict is always safe here.

import Database from "better-sqlite3";
import { runMigrations } from "./schema";
import { VaultRecord, PollCycleSummary } from "../types/watcher";
import { logger } from "../logger";

// ── Singleton state ───────────────────────────────────────────────────────────

let _store: Store | null = null;

export function initStore(dbPath: string): Store {
  if (_store !== null) {
    logger.warn({ dbPath }, "initStore called while store already initialised — closing existing connection");
    _store.close();
    _store = null;
  }

  const db = new Database(dbPath, { verbose: undefined });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  _store = new Store(db);
  logger.info({ dbPath }, "Store initialised");
  return _store;
}

export function getStore(): Store {
  if (!_store) {
    throw new Error("Store has not been initialised. Call initStore() first.");
  }
  return _store;
}

// ── Store class ───────────────────────────────────────────────────────────────

export class Store {
  private db: Database.Database;

  private readonly stmtUpsertVault:          Database.Statement;
  private readonly stmtGetAllActiveVaults:   Database.Statement;
  private readonly stmtCountActiveVaults:    Database.Statement;
  private readonly stmtGetVault:             Database.Statement;
  private readonly stmtDeactivateVault:      Database.Statement;
  private readonly stmtSetWarning75:         Database.Statement;
  private readonly stmtSetWarning90:         Database.Statement;
  private readonly stmtSetAnomalyFlagged:    Database.Statement;
  private readonly stmtSetTriggerSignalled:  Database.Statement;
  private readonly stmtIsTriggerSignalled:   Database.Statement;
  private readonly stmtRecordPollCycle:      Database.Statement;
  private readonly stmtPruneOldPollHistory:  Database.Statement;
  private readonly stmtGetRecentPollHistory: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    this.stmtUpsertVault = this.db.prepare(`
      INSERT INTO vaults (
        vault_address, owner_address, beneficiary, vault_index,
        last_check_in_slot, inactivity_threshold_slots, deposited_lamports,
        guardian_count, m_of_n_threshold,
        warning_75_sent, warning_90_sent,
        trigger_signalled, anomaly_flagged, is_active,
        checkin_count, sum_of_intervals,
        last_polled_slot, created_at, updated_at
      ) VALUES (
        @vaultAddress, @ownerAddress, @beneficiary, @vaultIndex,
        @lastCheckInSlot, @inactivityThresholdSlots, @depositedLamports,
        @guardianCount, @mOfNThreshold,
        @warning75Sent, @warning90Sent,
        @triggerSignalled, @anomalyFlagged, 1,
        @checkinCount, @sumOfIntervals,
        @lastPolledSlot, @createdAt, @updatedAt
      )
      ON CONFLICT(vault_address) DO UPDATE SET
        owner_address              = excluded.owner_address,
        beneficiary                = excluded.beneficiary,
        last_check_in_slot         = excluded.last_check_in_slot,
        inactivity_threshold_slots = excluded.inactivity_threshold_slots,
        deposited_lamports         = excluded.deposited_lamports,
        guardian_count             = excluded.guardian_count,
        m_of_n_threshold           = excluded.m_of_n_threshold,
        warning_75_sent            = excluded.warning_75_sent,
        warning_90_sent            = excluded.warning_90_sent,
        anomaly_flagged            = excluded.anomaly_flagged,
        checkin_count              = excluded.checkin_count,
        sum_of_intervals           = excluded.sum_of_intervals,
        last_polled_slot           = excluded.last_polled_slot,
        is_active                  = 1,
        updated_at                 = datetime('now')
    `);

    this.stmtGetAllActiveVaults = this.db.prepare(
      `SELECT * FROM vaults WHERE is_active = 1`,
    );

    this.stmtCountActiveVaults = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM vaults WHERE is_active = 1`,
    );

    this.stmtGetVault = this.db.prepare(
      `SELECT * FROM vaults WHERE vault_address = ?`,
    );

    this.stmtDeactivateVault = this.db.prepare(
      `UPDATE vaults SET is_active = 0, updated_at = datetime('now')
       WHERE vault_address = ?`,
    );

    this.stmtSetWarning75 = this.db.prepare(
      `UPDATE vaults SET warning_75_sent = @value, updated_at = datetime('now')
       WHERE vault_address = @vaultAddress`,
    );

    this.stmtSetWarning90 = this.db.prepare(
      `UPDATE vaults SET warning_90_sent = @value, updated_at = datetime('now')
       WHERE vault_address = @vaultAddress`,
    );

    this.stmtSetAnomalyFlagged = this.db.prepare(
      `UPDATE vaults SET anomaly_flagged = @value, updated_at = datetime('now')
       WHERE vault_address = @vaultAddress`,
    );

    this.stmtSetTriggerSignalled = this.db.prepare(
      `UPDATE vaults SET trigger_signalled = @value, updated_at = datetime('now')
       WHERE vault_address = @vaultAddress`,
    );

    this.stmtIsTriggerSignalled = this.db.prepare(
      `SELECT trigger_signalled FROM vaults WHERE vault_address = ?`,
    );

    this.stmtRecordPollCycle = this.db.prepare(`
      INSERT INTO poll_history (
        cycle_slot, cycle_start_ms, cycle_duration_ms,
        total_vaults, deactivated,
        guardian_pings, beneficiary_warnings, trigger_signals,
        anomaly_flags, errors
      ) VALUES (
        @cycleSlot, @cycleStartMs, @cycleDurationMs,
        @totalVaults, @deactivated,
        @guardianPings, @beneficiaryWarnings, @triggerSignals,
        @anomalyFlags, @errors
      )
    `);

    this.stmtPruneOldPollHistory = this.db.prepare(
      `DELETE FROM poll_history WHERE created_at < datetime('now', ?)`,
    );

    this.stmtGetRecentPollHistory = this.db.prepare(
      `SELECT * FROM poll_history ORDER BY id DESC LIMIT ?`,
    );
  }

  // ── Vault CRUD ──────────────────────────────────────────────────────────────

  upsertVault(vault: VaultRecord): void {
    this.stmtUpsertVault.run({
      vaultAddress:             vault.vaultAddress,
      ownerAddress:             vault.ownerAddress,
      beneficiary:              vault.beneficiary,
      vaultIndex:               vault.vaultIndex,
      lastCheckInSlot:          vault.lastCheckInSlot,
      inactivityThresholdSlots: vault.inactivityThresholdSlots,
      depositedLamports:        vault.depositedLamports,
      guardianCount:            vault.guardianCount,
      mOfNThreshold:            vault.mOfNThreshold,
      warning75Sent:            vault.warning75Sent ? 1 : 0,
      warning90Sent:            vault.warning90Sent ? 1 : 0,
      triggerSignalled:         vault.triggerSignalled ? 1 : 0,
      anomalyFlagged:           vault.anomalyFlagged ? 1 : 0,
      checkinCount:             vault.checkinCount,
      sumOfIntervals:           vault.sumOfIntervals,
      lastPolledSlot:           vault.lastPolledSlot,
      createdAt:                vault.createdAt,
      updatedAt:                vault.updatedAt,
    });
  }

  registerVault(vault: Omit<VaultRecord, "updatedAt" | "createdAt">): void {
    const now = new Date().toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    this.upsertVault({ ...vault, createdAt: now, updatedAt: now });
    logger.info({ vault: vault.vaultAddress }, "Vault registered for monitoring");
  }

  getAllActiveVaults(): VaultRecord[] {
    const rows = this.stmtGetAllActiveVaults.all() as any[];
    return rows.map(rowToVaultRecord);
  }

  countActiveVaults(): number {
    const row = this.stmtCountActiveVaults.get() as { cnt: number };
    return row.cnt;
  }

  getVault(vaultAddress: string): VaultRecord | null {
    const row = this.stmtGetVault.get(vaultAddress) as any | undefined;
    return row ? rowToVaultRecord(row) : null;
  }

  deactivateVault(vaultAddress: string): void {
    this.stmtDeactivateVault.run(vaultAddress);
    logger.info({ vault: vaultAddress }, "Vault deactivated in local store");
  }

  // ── Warning flag setters ────────────────────────────────────────────────────

  setWarning75Sent(vaultAddress: string, value: boolean): void {
    this.stmtSetWarning75.run({ value: value ? 1 : 0, vaultAddress });
  }

  setWarning90Sent(vaultAddress: string, value: boolean): void {
    this.stmtSetWarning90.run({ value: value ? 1 : 0, vaultAddress });
  }

  setAnomalyFlagged(vaultAddress: string, value: boolean): void {
    this.stmtSetAnomalyFlagged.run({ value: value ? 1 : 0, vaultAddress });
  }

  setTriggerSignalled(vaultAddress: string, value: boolean): void {
    this.stmtSetTriggerSignalled.run({ value: value ? 1 : 0, vaultAddress });
  }

  isTriggerSignalled(vaultAddress: string): boolean {
    const row = this.stmtIsTriggerSignalled.get(vaultAddress) as
      | { trigger_signalled: number }
      | undefined;
    return row?.trigger_signalled === 1;
  }

  // ── Poll history ────────────────────────────────────────────────────────────

  recordPollCycle(summary: PollCycleSummary): void {
    this.stmtRecordPollCycle.run({
      cycleSlot:           summary.cycleSlot,
      cycleStartMs:        summary.cycleStartMs,
      cycleDurationMs:     summary.cycleDurationMs,
      totalVaults:         summary.totalVaults,
      deactivated:         summary.deactivated,
      guardianPings:       summary.guardianPings,
      beneficiaryWarnings: summary.beneficiaryWarnings,
      triggerSignals:      summary.triggerSignals,
      anomalyFlags:        summary.anomalyFlags,
      errors:              summary.errors,
    });
  }

  pruneOldPollHistory(retentionDays: number): number {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      throw new Error(
        `pruneOldPollHistory: retentionDays must be a positive finite number, got ${retentionDays}`,
      );
    }
    const modifier = `-${Math.floor(retentionDays)} days`;
    const result   = this.stmtPruneOldPollHistory.run(modifier);
    return result.changes;
  }

  getRecentPollHistory(limit: number = 100): PollCycleSummary[] {
    const rows = this.stmtGetRecentPollHistory.all(limit) as any[];
    return rows.map(rowToPollCycleSummary);
  }

  /**
   * Issues a WAL checkpoint in TRUNCATE mode. This flushes all pending WAL
   * frames into the main database file and resets the WAL file to empty.
   *
   * Call this from the maintenance job before taking a filesystem snapshot
   * so the snapshot captures a self-consistent database that does not require
   * WAL replay on restore. Checkpointing while readers are active is safe —
   * SQLite serialises the checkpoint against concurrent readers and continues
   * if a reader holds an older snapshot (TRUNCATE degrades to PASSIVE silently).
   *
   * Returns the number of WAL frames checkpointed (useful for monitoring).
   */
  walCheckpoint(): number {
    try {
      // TRUNCATE resets the WAL file to zero length after all frames are
      // written to the main DB. This is safe here because the watcher is
      // single-process and no other processes hold WAL readers.
      const result = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{
        busy:         number;
        log:          number;
        checkpointed: number;
      }>;
      const checkpointed = result[0]?.checkpointed ?? 0;
      logger.debug({ checkpointed }, "WAL checkpoint complete");
      return checkpointed;
    } catch (err) {
      // Non-fatal — the DB is still consistent; the checkpoint will be
      // retried on the next maintenance cycle.
      logger.error({ err }, "WAL checkpoint failed — will retry next maintenance cycle");
      return 0;
    }
  }

  close(): void {
    // Issue a final checkpoint before closing so the WAL is fully merged
    // into the main file, preventing WAL replay on the next open.
    this.walCheckpoint();
    this.db.close();
    logger.info("Database connection closed");
  }
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToVaultRecord(row: any): VaultRecord {
  return {
    vaultAddress:             row.vault_address,
    ownerAddress:             row.owner_address,
    beneficiary:              row.beneficiary,
    vaultIndex:               row.vault_index,
    lastCheckInSlot:          row.last_check_in_slot,
    inactivityThresholdSlots: row.inactivity_threshold_slots,
    depositedLamports:        row.deposited_lamports,
    guardianCount:            row.guardian_count,
    mOfNThreshold:            row.m_of_n_threshold,
    warning75Sent:            row.warning_75_sent === 1,
    warning90Sent:            row.warning_90_sent === 1,
    triggerSignalled:         row.trigger_signalled === 1,
    anomalyFlagged:           row.anomaly_flagged === 1,
    checkinCount:             row.checkin_count,
    sumOfIntervals:           row.sum_of_intervals,
    lastPolledSlot:           row.last_polled_slot,
    createdAt:                row.created_at,
    updatedAt:                row.updated_at,
  };
}

function rowToPollCycleSummary(row: any): PollCycleSummary {
  return {
    cycleSlot:           row.cycle_slot,
    cycleStartMs:        row.cycle_start_ms,
    cycleDurationMs:     row.cycle_duration_ms,
    totalVaults:         row.total_vaults,
    deactivated:         row.deactivated,
    guardianPings:       row.guardian_pings,
    beneficiaryWarnings: row.beneficiary_warnings,
    triggerSignals:      row.trigger_signals,
    anomalyFlags:        row.anomaly_flags,
    errors:              row.errors,
  };
}

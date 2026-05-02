// watcher/src/db/schema.ts
//
// Defines the SQLite schema for the watcher's local database.
//
// Timestamp convention: all timestamps use SQLite's canonical format
// "YYYY-MM-DD HH:MM:SS" in UTC with a space separator (produced by
// datetime('now')). Application code must use the same format — ISO-8601
// "T"-format strings sort incorrectly against these values because 'T' > ' '
// in ASCII, making queries like "WHERE created_at < datetime('now', ?)"
// produce wrong results.

import Database from "better-sqlite3";
import { logger } from "../logger";

const CREATE_VAULTS_TABLE = `
CREATE TABLE IF NOT EXISTS vaults (
  vault_address              TEXT PRIMARY KEY NOT NULL,
  owner_address              TEXT NOT NULL,
  beneficiary                TEXT NOT NULL,
  vault_index                TEXT NOT NULL,

  last_check_in_slot         TEXT NOT NULL DEFAULT '0',
  inactivity_threshold_slots TEXT NOT NULL DEFAULT '0',
  deposited_lamports         TEXT NOT NULL DEFAULT '0',

  guardian_count             INTEGER NOT NULL DEFAULT 0,
  m_of_n_threshold           INTEGER NOT NULL DEFAULT 0,

  warning_75_sent            INTEGER NOT NULL DEFAULT 0,
  warning_90_sent            INTEGER NOT NULL DEFAULT 0,

  trigger_signalled          INTEGER NOT NULL DEFAULT 0,
  anomaly_flagged            INTEGER NOT NULL DEFAULT 0,
  is_active                  INTEGER NOT NULL DEFAULT 1,

  checkin_count              TEXT NOT NULL DEFAULT '0',
  sum_of_intervals           TEXT NOT NULL DEFAULT '0',

  last_polled_slot           TEXT NOT NULL DEFAULT '0',
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const CREATE_VAULTS_OWNER_INDEX = `
CREATE INDEX IF NOT EXISTS idx_vaults_owner
  ON vaults (owner_address);
`;

const CREATE_VAULTS_ACTIVE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_vaults_active
  ON vaults (is_active);
`;

const CREATE_POLL_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS poll_history (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_slot           TEXT    NOT NULL,
  cycle_start_ms       INTEGER NOT NULL,
  cycle_duration_ms    INTEGER NOT NULL,
  total_vaults         INTEGER NOT NULL DEFAULT 0,
  deactivated          INTEGER NOT NULL DEFAULT 0,
  guardian_pings       INTEGER NOT NULL DEFAULT 0,
  beneficiary_warnings INTEGER NOT NULL DEFAULT 0,
  trigger_signals      INTEGER NOT NULL DEFAULT 0,
  anomaly_flags        INTEGER NOT NULL DEFAULT 0,
  errors               INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;

export function runMigrations(db: Database.Database): void {
  logger.info("Running database migrations");

  db.exec(CREATE_VAULTS_TABLE);
  db.exec(CREATE_VAULTS_OWNER_INDEX);
  db.exec(CREATE_VAULTS_ACTIVE_INDEX);
  db.exec(CREATE_POLL_HISTORY_TABLE);

  logger.info("Database migrations complete");
}

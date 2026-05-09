// watcher/demo_seed.mjs
//
// Demo seed script for the QVAC anomaly detection pipeline.
// Inserts a synthetic vault behavioral record directly into the RAG store
// with currentSilenceDays: 15 and historicalAverageDays: 4, producing a
// 3.75x ratio that guarantees the fallback threshold (>1.5x) is exceeded
// and the LLM prompt receives a HIGH-risk behavioral profile.
//
// Usage: node watcher/demo_seed.mjs
// Requires: the watcher RAG DB to exist at the path derived from DB_PATH env.

import Database from "better-sqlite3";
import path     from "path";
import fs       from "fs";

const DB_PATH     = process.env.DB_PATH ?? "./watcher.db";
const RAG_DB_PATH = DB_PATH.replace(/\.db$/, "") + "-rag.db";

// ── Synthetic vault behavior ──────────────────────────────────────────────────

const DEMO_VAULT_ADDRESS      = "DEMO1111111111111111111111111111111111111111";
const CURRENT_SILENCE_DAYS    = 15;   // days silent
const HISTORICAL_AVERAGE_DAYS = 4;    // historical average check-in interval
// Ratio: 15 / 4 = 3.75x — well above the 1.5x anomaly threshold,
// guaranteeing HIGH or CRITICAL risk from both fallback and LLM paths.

// ── Build behavior text (mirrors qvac_rag.ts buildBehaviorText) ───────────────

const ratio        = (CURRENT_SILENCE_DAYS / HISTORICAL_AVERAGE_DAYS).toFixed(2);
const SLOTS_PER_DAY = 172_800;

const checkInHistory =
  `8 total check-ins recorded, average interval ${HISTORICAL_AVERAGE_DAYS.toFixed(1)} days, ` +
  `current silence ${CURRENT_SILENCE_DAYS.toFixed(1)} days (${ratio}x average)`;

const behaviorText = [
  `silence_days:${CURRENT_SILENCE_DAYS.toFixed(1)}`,
  `avg_days:${HISTORICAL_AVERAGE_DAYS.toFixed(1)}`,
  `ratio:${ratio}`,
  `guardians:3`,
  `signed:0`,
  `shielded:0`,
  `history:${checkInHistory}`,
].join(" ");

// ── Synthetic embedding (unit vector, 768 dims to match GTE_LARGE_FP16) ───────
// A real embedding would be produced by the embedder model. For demo purposes
// a normalised random vector of the correct dimensionality is used so the
// cosine similarity computation in the RAG store operates on valid data.

const EMBEDDING_DIMS = 768;
const rawVec = new Float32Array(EMBEDDING_DIMS);
let   norm   = 0;
for (let i = 0; i < EMBEDDING_DIMS; i++) {
  rawVec[i] = Math.random() * 2 - 1;
  norm      += rawVec[i] * rawVec[i];
}
norm = Math.sqrt(norm);
for (let i = 0; i < EMBEDDING_DIMS; i++) rawVec[i] /= norm;

const embeddingBlob = Buffer.from(rawVec.buffer);

// ── Seed ──────────────────────────────────────────────────────────────────────

console.log(`Demo seed: RAG DB path = ${RAG_DB_PATH}`);

if (!fs.existsSync(RAG_DB_PATH)) {
  console.log("RAG DB does not exist — creating it with schema");
}

const db = new Database(RAG_DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS rag_vault_embeddings (
    vault_address   TEXT    NOT NULL PRIMARY KEY,
    triggered       INTEGER NOT NULL DEFAULT 0,
    embedding_blob  BLOB    NOT NULL,
    behavior_text   TEXT    NOT NULL,
    ingested_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

const stmt = db.prepare(`
  INSERT INTO rag_vault_embeddings
    (vault_address, triggered, embedding_blob, behavior_text, ingested_at)
  VALUES
    (@vaultAddress, @triggered, @embeddingBlob, @behaviorText, datetime('now'))
  ON CONFLICT(vault_address) DO UPDATE SET
    triggered      = excluded.triggered,
    embedding_blob = excluded.embedding_blob,
    behavior_text  = excluded.behavior_text,
    ingested_at    = excluded.ingested_at
`);

stmt.run({
  vaultAddress:  DEMO_VAULT_ADDRESS,
  triggered:     1,     // this vault triggered inheritance — makes it count in similarity queries
  embeddingBlob: embeddingBlob,
  behaviorText:  behaviorText,
});

db.close();

console.log("Demo seed complete.");
console.log(`  Vault:              ${DEMO_VAULT_ADDRESS}`);
console.log(`  Silence:            ${CURRENT_SILENCE_DAYS} days`);
console.log(`  Historical average: ${HISTORICAL_AVERAGE_DAYS} days`);
console.log(`  Ratio:              ${ratio}x  (above 1.5x threshold)`);
console.log(`  Triggered:          true`);
console.log(`  Embedding dims:     ${EMBEDDING_DIMS}`);

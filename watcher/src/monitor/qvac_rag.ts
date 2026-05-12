// watcher/src/monitor/qvac_rag.ts
//
// QVAC RAG (Retrieval-Augmented Generation) store for the watcher service.
//
// Migrated from @qvac/embed-llamacpp (deprecated) to the unified @qvac/sdk
// package. The SDK runs natively on Node.js >= v22.17 without requiring a
// separate Bare runtime process.
//
// Stores behavioral embeddings of vaults that have triggered inheritance so
// that new anomalies can be matched against historical patterns before the LLM
// runs. The count of similar triggered vaults feeds into the VaultBehavior
// struct and appears in the LLM prompt as behavioral context.
//
// Implementation constraints from the spec:
//   - Embeddings stored as Float32Array BLOB in better-sqlite3
//   - Cosine similarity implemented in pure TypeScript only
//   - better-sqlite3 is already in watcher/package.json
//   - GPU forbidden throughout — device: "cpu", gpuLayers: 0 always
//
// Data boundary: ingestVaultBehavior receives a VaultBehavior struct which
// contains only behavioral metadata. Cloak cryptographic material (private
// keys, viewing keys, UTXO commitments) never enters the embedding pipeline.
// The embedding text is constructed from days-based behavioral descriptors only.
//
// Four exports required by index.ts:
//   initQVACRagStore()      — open DB table, load embedder model
//   closeQVACRagStore()     — unload embedder, close RAG DB, close SDK client
//   ingestVaultBehavior()   — embed and store a vault's behavioral profile
//   querySimilarTriggered() — query count of similar triggered vaults

import Database from "better-sqlite3";
import {
  loadModel,
  unloadModel,
  embed,
  close,
  GTE_LARGE_FP16,
} from "@qvac/sdk";

import { VaultBehavior } from "./qvac_anomaly";
import { logger }        from "../logger";

// ── Constants ─────────────────────────────────────────────────────────────────

// Embedder model config for CPU-only inference.
// @qvac/sdk defaults device to "gpu" and gpuLayers to 99 — both must be
// explicitly overridden here for CPU-only operation.
const EMBEDDER_MODEL_CONFIG = {
  device:    "cpu" as const,
  gpuLayers: 0,
};

// Exported so anomaly.ts passes the canonical values when calling
// querySimilarTriggered() rather than re-declaring magic literals.
// A threshold change requires exactly one update here.
export const SIMILARITY_THRESHOLD = 0.75;
export const TOP_K                = 5;

// ── Module state ──────────────────────────────────────────────────────────────

let _db:          Database.Database | null = null;
let _embedModelId: string           | null = null;

// Prepared statements — initialised once in initQVACRagStore() and reused
// for every ingest and query call to avoid repeated statement compilation.
let _stmtUpsert:               Database.Statement | null = null;
let _stmtGetAll:               Database.Statement | null = null;
let _stmtGetBehaviorByAddress: Database.Statement | null = null;

// ── Init / shutdown ───────────────────────────────────────────────────────────

/**
 * Opens the RAG SQLite database, runs the schema migration, prepares all
 * statements, and loads the embedder model into memory via @qvac/sdk.
 *
 * Called in main() after initQVACAnomalyEngine().
 * The DB path uses the same directory as the watcher's main SQLite store
 * with a "-rag.db" suffix, keeping all persistent state in one place.
 */
export async function initQVACRagStore(dbPath: string): Promise<void> {
  logger.info({ dbPath }, "QVAC RAG: initialising store and loading embedder model");

  _db = new Database(dbPath, { verbose: undefined });
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Schema: one row per vault address. triggered=1 marks vaults whose anomaly
  // flag was actually submitted so similarity queries can filter for them.
  // embedding_blob is a raw Float32Array written as a SQLite BLOB.
  // behavior_text is stored alongside the embedding so querySimilarTriggered()
  // can re-embed it as the query vector without reconstructing it from state.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS rag_vault_embeddings (
      vault_address   TEXT    NOT NULL PRIMARY KEY,
      triggered       INTEGER NOT NULL DEFAULT 0,
      embedding_blob  BLOB    NOT NULL,
      behavior_text   TEXT    NOT NULL,
      ingested_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Upsert: insert on first ingest, update all mutable fields on subsequent
  // ingest calls. vault_address is the primary key so the conflict is always
  // on the same row. triggered can flip from 0 to 1 on later cycles.
  _stmtUpsert = _db.prepare(`
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

  // Fetches all rows for cosine similarity scan in querySimilarTriggered().
  // Full table scan is acceptable — the corpus size is bounded by the number
  // of monitored vaults which is small (hundreds to low thousands).
  _stmtGetAll = _db.prepare(`
    SELECT vault_address, triggered, embedding_blob
    FROM   rag_vault_embeddings
  `);

  // Retrieves stored behavior_text for a specific vault so querySimilarTriggered()
  // can re-embed it as the query vector using the current embedder model.
  _stmtGetBehaviorByAddress = _db.prepare(`
    SELECT behavior_text
    FROM   rag_vault_embeddings
    WHERE  vault_address = ?
  `);

  // Load the embedder model. The returned ID is stored as module state and
  // passed to every embed() call for the lifetime of the process.
  _embedModelId = await loadModel({
    modelSrc:    GTE_LARGE_FP16,
    modelConfig: EMBEDDER_MODEL_CONFIG,
  });

  logger.info({ modelId: _embedModelId }, "QVAC RAG: store ready — embedder model loaded");
}

/**
 * Unloads the embedder model, closes the @qvac/sdk client, and closes the
 * RAG SQLite database connection.
 *
 * Called second in shutdown(), after shutdownQVACAnomalyEngine() and before
 * getStore().close(). Shutdown order is absolute.
 *
 * close() — which releases the entire @qvac/sdk client — is called here,
 * after both the LLM (unloaded in shutdownQVACAnomalyEngine) and the embedder
 * have been unloaded. This is the correct and only place for close() because
 * calling it before all models are unloaded would leave resources dangling.
 */
export async function closeQVACRagStore(): Promise<void> {
  // Step 1: unload the embedder model from memory.
  if (_embedModelId) {
    try {
      await unloadModel({ modelId: _embedModelId });
      logger.info("QVAC RAG: embedder model unloaded cleanly");
    } catch (err) {
      logger.error({ err }, "QVAC RAG: error unloading embedder — continuing shutdown");
    } finally {
      _embedModelId = null;
    }
  }

  // Step 2: close the @qvac/sdk client connection and release all SDK
  // resources. Called exactly once here, after both models are unloaded.
  // This is the last @qvac/sdk operation in the entire process.
  try {
    await close();
    logger.info("QVAC RAG: SDK client closed");
  } catch (err) {
    logger.error({ err }, "QVAC RAG: error closing SDK client — continuing shutdown");
  }

  // Step 3: close the SQLite connection. Done after SDK teardown so any
  // in-flight ingest that survived to this point has already failed cleanly
  // (the embedder was cleared in step 1, so no new writes can start).
  if (_db) {
    try {
      _db.close();
      logger.info("QVAC RAG: database connection closed");
    } catch (err) {
      logger.error({ err }, "QVAC RAG: error closing database — continuing shutdown");
    } finally {
      _db                       = null;
      _stmtUpsert               = null;
      _stmtGetAll               = null;
      _stmtGetBehaviorByAddress = null;
    }
  }
}

// ── Ingest ────────────────────────────────────────────────────────────────────

/**
 * Embeds a vault's behavioral profile and upserts it into the RAG store.
 *
 * Called after evaluateAllAnomalies() in runPollCycle() for every active vault
 * so the RAG store incrementally builds a corpus of behavioral patterns over time.
 * Failures are logged and swallowed — a failed ingest must never block the poll
 * cycle or cause a poll cycle to throw.
 *
 * The embedding text is derived from behavioral metadata only — days-based
 * durations, guardian counts, shielded status, check-in history. Cloak
 * cryptographic material never appears in the embedding text or stored data.
 *
 * triggered is set to 1 when the vault's anomaly flag was submitted this cycle
 * so future similarity queries can identify how many similar vaults escalated.
 */
export async function ingestVaultBehavior(
  behavior:  VaultBehavior,
  triggered: boolean,
): Promise<void> {
  if (!_embedModelId || !_db || !_stmtUpsert) {
    logger.warn(
      { vault: behavior.vaultAddress },
      "QVAC RAG: store not initialised — skipping ingest",
    );
    return;
  }

  const behaviorText = buildBehaviorText(behavior);

  try {
    // embed() returns number[] — the dense embedding vector for behaviorText.
    // GPU is disabled; inference runs entirely on CPU per EMBEDDER_MODEL_CONFIG.
    const { embedding } = await embed({
      modelId: _embedModelId,
      text:    behaviorText,
    });

    // Serialise to a raw Float32Array BLOB for compact SQLite storage.
    // The IEEE 754 bit representation is preserved exactly so deserialization
    // in bufferToFloat32Array() produces the identical float values.
    const embeddingBlob = float32ArrayToBuffer(new Float32Array(embedding));

    _stmtUpsert.run({
      vaultAddress:  behavior.vaultAddress,
      triggered:     triggered ? 1 : 0,
      embeddingBlob,
      behaviorText,
    });

    logger.debug(
      { vault: behavior.vaultAddress, triggered, dims: embedding.length },
      "QVAC RAG: vault behavior ingested",
    );
  } catch (err) {
    logger.error(
      { vault: behavior.vaultAddress, err },
      "QVAC RAG: ingest failed — skipping this vault",
    );
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Returns the count of behaviorally similar vaults that have triggered
 * inheritance, using cosine similarity over stored embeddings.
 *
 * Called inside evaluateSingleAnomaly() in anomaly.ts BEFORE analyzeVaultAnomaly()
 * so the LLM prompt always contains an accurate similarTriggeredVaults count
 * from the RAG store — never hardcoded to 0.
 *
 * The stored behavior_text for the query vault is retrieved from the RAG DB
 * and re-embedded to produce the query vector. If the vault has not yet been
 * ingested (first anomaly detection cycle for this vault), returns 0 immediately
 * without running the similarity search.
 *
 * The query vault is excluded from its own results so a vault never counts
 * itself as a similar triggered vault if it was previously flagged.
 *
 * Returns 0 on any error — the LLM analysis still runs, just without RAG context.
 */
export async function querySimilarTriggered(
  vaultAddress: string,
  threshold:    number,
  topK:         number,
): Promise<number> {
  if (!_embedModelId || !_db || !_stmtGetAll || !_stmtGetBehaviorByAddress) {
    logger.warn(
      { vault: vaultAddress },
      "QVAC RAG: store not initialised — returning 0 similar vaults",
    );
    return 0;
  }

  // Fetch the stored behavior text for this vault. If absent the vault has not
  // yet been ingested — nothing to compare against, return 0 immediately.
  const behaviorRow = _stmtGetBehaviorByAddress.get(vaultAddress) as
    | { behavior_text: string }
    | undefined;

  if (!behaviorRow) {
    logger.debug(
      { vault: vaultAddress },
      "QVAC RAG: vault not yet ingested — returning 0 similar vaults",
    );
    return 0;
  }

  try {
    // Re-embed the stored behavior text to get the query vector.
    // Using the stored text (not a freshly built one) ensures the query vector
    // is in the same embedding space as the corpus vectors stored at ingest time.
    const { embedding: queryEmbedding } = await embed({
      modelId: _embedModelId,
      text:    behaviorRow.behavior_text,
    });
    const queryVec = new Float32Array(queryEmbedding);

    type RagRow = { vault_address: string; triggered: number; embedding_blob: Buffer };
    const rows = _stmtGetAll.all() as RagRow[];

    // Full table cosine similarity scan in pure TypeScript.
    // No native vector extension needed — corpus size is bounded by vault count.
    const scored: Array<{ vaultAddress: string; triggered: number; similarity: number }> = [];

    for (const row of rows) {
      // Exclude the query vault from its own results.
      if (row.vault_address === vaultAddress) continue;

      const storedVec  = bufferToFloat32Array(row.embedding_blob);
      const similarity = cosineSimilarity(queryVec, storedVec);

      if (similarity >= threshold) {
        scored.push({
          vaultAddress: row.vault_address,
          triggered:    row.triggered,
          similarity,
        });
      }
    }

    // Sort descending by similarity, take top-k, count triggered among them.
    scored.sort((a, b) => b.similarity - a.similarity);
    const topKResults    = scored.slice(0, topK);
    const triggeredCount = topKResults.filter((r) => r.triggered === 1).length;

    logger.debug(
      {
        vault:          vaultAddress,
        candidates:     rows.length,
        aboveThreshold: scored.length,
        topK:           topKResults.length,
        triggered:      triggeredCount,
      },
      "QVAC RAG: similarity query complete",
    );

    return triggeredCount;
  } catch (err) {
    logger.error(
      { vault: vaultAddress, err },
      "QVAC RAG: similarity query failed — returning 0 similar vaults",
    );
    return 0;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Constructs the behavioral text string that gets embedded and stored.
 *
 * Uses only days-based behavioral descriptors and aggregate counts.
 * No vault addresses, public keys, slot numbers, lamport values, or any
 * cryptographic data appear here. The format is intentionally compact and
 * consistent so the embedder produces stable vectors across poll cycles.
 */
function buildBehaviorText(behavior: VaultBehavior): string {
  return [
    `silence_days:${behavior.currentSilenceDays.toFixed(1)}`,
    `avg_days:${behavior.historicalAverageDays.toFixed(1)}`,
    `ratio:${behavior.historicalAverageDays > 0
      ? (behavior.currentSilenceDays / behavior.historicalAverageDays).toFixed(2)
      : "0.00"}`,
    `guardians:${behavior.guardianCount}`,
    `signed:${behavior.guardiansSignedCount}`,
    `shielded:${behavior.isShielded ? "1" : "0"}`,
    `history:${behavior.checkInHistory}`,
  ].join(" ");
}

/**
 * Computes cosine similarity between two Float32Arrays.
 * Pure TypeScript — no native extension dependency.
 * Returns 0 if either vector has zero magnitude to avoid division by zero.
 * Uses the shorter vector's length when dimensions differ.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot   = 0;
  let magA  = 0;
  let magB  = 0;

  for (let i = 0; i < len; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) return 0;

  return dot / magnitude;
}

/**
 * Serialises a Float32Array to a Node.js Buffer for SQLite BLOB storage.
 * Preserves the exact IEEE 754 bit representation of each float value.
 */
function float32ArrayToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * Deserialises a SQLite BLOB back into a Float32Array.
 * The Buffer returned by better-sqlite3 may not be aligned on a 4-byte
 * boundary — copying into a fresh ArrayBuffer guarantees the alignment
 * requirement that Float32Array imposes on its underlying buffer.
 */
function bufferToFloat32Array(buf: Buffer): Float32Array {
  const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(aligned);
}

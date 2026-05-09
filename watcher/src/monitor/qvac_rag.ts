// watcher/src/monitor/qvac_rag.ts
//
// QVAC RAG (Retrieval-Augmented Generation) store for the watcher service.
//
// Stores behavioral embeddings of vaults that have triggered inheritance so
// that new anomalies can be matched against historical patterns before the LLM
// runs. The count of similar triggered vaults feeds into the VaultBehavior
// struct and appears in the LLM prompt as behavioral context.
//
// Implementation constraints from the spec:
//   - NO sqlite-wasm native vector extension — fragile in Codespaces
//   - Embeddings stored as Float32Array BLOB in better-sqlite3
//   - Cosine similarity implemented in pure TypeScript only
//   - better-sqlite3 is already in watcher/package.json
//
// The embedder handle uses @qvac/embed-llamacpp with:
//   MODEL: "GTE_LARGE_FP16"
//   modelConfig: { gpuLayers: 0, device: "cpu" }
//
// Data boundary: ingestVaultBehavior receives a VaultBehavior struct which
// contains only behavioral metadata. Cloak cryptographic material (private keys,
// viewing keys, UTXO commitments) never enters the embedding pipeline.
// The embedding text is constructed from days-based behavioral descriptors only.
//
// Four exports required by index.ts:
//   initQVACRagStore()         — open DB table, load embedder model
//   closeQVACRagStore()        — unload embedder model, close RAG DB connection
//   ingestVaultBehavior()      — embed and store a vault's behavioral profile
//   querySimilarTriggered()    — query count of similar triggered vaults

import Database                from "better-sqlite3";
import { getEmbedder }         from "@qvac/embed-llamacpp";
import { VaultBehavior }       from "./qvac_anomaly";
import { logger }              from "../logger";

// ── Constants ─────────────────────────────────────────────────────────────────

const EMBEDDER_MODEL = "GTE_LARGE_FP16";

// GPU forbidden throughout — device: "cpu", gpuLayers: 0 always.
const EMBEDDER_MODEL_CONFIG = {
  gpuLayers: 0,
  device:    "cpu" as const,
};

// Exported so call sites (anomaly.ts) pass the canonical values explicitly
// rather than relying on undocumented defaults.
export const SIMILARITY_THRESHOLD = 0.75;
export const TOP_K                = 5;

// ── Module state ──────────────────────────────────────────────────────────────

let _db:             Database.Database              | null = null;
let _embedderHandle: ReturnType<typeof getEmbedder> | null = null;

// Prepared statements — initialised once and reused for performance.
let _stmtUpsert:             Database.Statement | null = null;
let _stmtGetAll:             Database.Statement | null = null;
let _stmtGetBehaviorByAddress: Database.Statement | null = null;

// ── Init / shutdown ───────────────────────────────────────────────────────────

/**
 * Opens the RAG SQLite database (shared with the main store directory),
 * runs the schema migration, and loads the embedder model into memory.
 *
 * Called in main() after initQVACAnomalyEngine().
 * The DB path uses the same directory as the watcher's main SQLite store.
 */
export async function initQVACRagStore(dbPath: string): Promise<void> {
  logger.info({ dbPath }, "QVAC RAG: initialising store and loading embedder model");

  _db = new Database(dbPath, { verbose: undefined });
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS rag_vault_embeddings (
      vault_address   TEXT    NOT NULL PRIMARY KEY,
      triggered       INTEGER NOT NULL DEFAULT 0,
      embedding_blob  BLOB    NOT NULL,
      behavior_text   TEXT    NOT NULL,
      ingested_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

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

  _stmtGetAll = _db.prepare(`
    SELECT vault_address, triggered, embedding_blob
    FROM   rag_vault_embeddings
  `);

  _stmtGetBehaviorByAddress = _db.prepare(`
    SELECT behavior_text
    FROM   rag_vault_embeddings
    WHERE  vault_address = ?
  `);

  _embedderHandle = getEmbedder();
  await _embedderHandle.loadModel(EMBEDDER_MODEL, { modelConfig: EMBEDDER_MODEL_CONFIG });

  logger.info("QVAC RAG: store ready — embedder model loaded");
}

/**
 * Unloads the embedder model and closes the RAG DB connection.
 * Called second in shutdown(), after shutdownQVACAnomalyEngine() and
 * before getStore().close(). Shutdown order is absolute.
 */
export async function closeQVACRagStore(): Promise<void> {
  if (_embedderHandle) {
    try {
      await _embedderHandle.unloadModel();
      logger.info("QVAC RAG: embedder model unloaded cleanly");
    } catch (err) {
      logger.error({ err }, "QVAC RAG: error unloading embedder — continuing shutdown");
    } finally {
      _embedderHandle = null;
    }
  }

  if (_db) {
    try {
      _db.close();
      logger.info("QVAC RAG: database connection closed");
    } catch (err) {
      logger.error({ err }, "QVAC RAG: error closing database — continuing shutdown");
    } finally {
      _db                    = null;
      _stmtUpsert            = null;
      _stmtGetAll            = null;
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
 *
 * The embedding text is derived from behavioral metadata only — days-based
 * durations, guardian counts, shielded status, and trigger state. Cloak
 * cryptographic material never appears in the embedding text or stored data.
 *
 * triggered is set to 1 when the vault's anomaly flag was submitted this cycle,
 * so future similarity queries can identify how many similar vaults escalated.
 */
export async function ingestVaultBehavior(
  behavior:  VaultBehavior,
  triggered: boolean,
): Promise<void> {
  if (!_embedderHandle || !_db || !_stmtUpsert) {
    logger.warn(
      { vault: behavior.vaultAddress },
      "QVAC RAG: store not initialised — skipping ingest",
    );
    return;
  }

  const behaviorText = buildBehaviorText(behavior);

  try {
    // embed() returns Promise<{ embedding: number[] }>
    const { embedding } = await _embedderHandle.embed(behaviorText);

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
 * Finds the count of behaviorally similar vaults that have triggered
 * inheritance, using cosine similarity over stored embeddings.
 *
 * Called inside evaluateSingleAnomaly() BEFORE analyzeVaultAnomaly() so the
 * LLM prompt always contains an accurate similarTriggeredVaults count from the
 * RAG store — never hardcoded to 0.
 *
 * The stored behavior_text for the query vault is retrieved from the RAG DB
 * and re-embedded to produce the query vector. If the vault has not yet been
 * ingested (first anomaly detection cycle), returns 0.
 *
 * The query vault is excluded from its own results so a vault does not match
 * itself if it was previously ingested.
 *
 * @param vaultAddress  Base58 address of the vault to find similar patterns for.
 * @param threshold     Minimum cosine similarity score to count a match (0–1).
 * @param topK          Maximum number of similar results to consider.
 * @returns             Count of triggered vaults among the top-k most similar.
 */
export async function querySimilarTriggered(
  vaultAddress: string,
  threshold:    number,
  topK:         number,
): Promise<number> {
  if (!_embedderHandle || !_db || !_stmtGetAll || !_stmtGetBehaviorByAddress) {
    logger.warn(
      { vault: vaultAddress },
      "QVAC RAG: store not initialised — returning 0 similar vaults",
    );
    return 0;
  }

  // Retrieve the stored behavior text for this vault so we can embed the
  // vault's own behavioral profile as the query vector. If the vault has not
  // been ingested yet (first poll cycle for this vault), there is nothing to
  // compare against and we return 0 immediately.
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

  const behaviorText = behaviorRow.behavior_text;

  try {
    const { embedding: queryEmbedding } = await _embedderHandle.embed(behaviorText);
    const queryVec = new Float32Array(queryEmbedding);

    type RagRow = { vault_address: string; triggered: number; embedding_blob: Buffer };
    const rows = _stmtGetAll.all() as RagRow[];

    // Compute cosine similarity in pure TypeScript — no native extension.
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

    // Sort descending by similarity, take top-k.
    scored.sort((a, b) => b.similarity - a.similarity);
    const topKResults = scored.slice(0, topK);

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
 * Constructs the behavioral text that gets embedded.
 * Uses only days-based behavioral descriptors and aggregate counts.
 * No vault addresses, public keys, or cryptographic data appear here.
 */
function buildBehaviorText(behavior: VaultBehavior): string {
  return [
    `silence_days:${behavior.currentSilenceDays.toFixed(1)}`,
    `avg_days:${behavior.historicalAverageDays.toFixed(1)}`,
    `ratio:${behavior.historicalAverageDays > 0 ? (behavior.currentSilenceDays / behavior.historicalAverageDays).toFixed(2) : "0.00"}`,
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
 * Preserves the exact IEEE 754 bit representation of each float.
 */
function float32ArrayToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * Deserialises a SQLite BLOB back into a Float32Array.
 * The Buffer from better-sqlite3 may not be aligned — copy into a fresh
 * ArrayBuffer to guarantee Float32Array alignment requirements are met.
 */
function bufferToFloat32Array(buf: Buffer): Float32Array {
  const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(aligned);
}

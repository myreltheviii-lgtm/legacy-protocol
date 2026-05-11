// watcher/src/monitor/qvac_anomaly.ts
//
// QVAC LLM-powered anomaly analysis for the watcher service.
//
// This module sits between the mathematical anomaly detection in anomaly.ts
// and the on-chain flag submission. When isAnomalous() returns true, this
// module evaluates whether the pattern represents genuine risk before any
// on-chain transaction is submitted.
//
// The LLM receives only behavioral metadata — silence duration in days,
// historical average intervals, guardian counts, shielded status, and the
// count of similar vaults that previously triggered inheritance from the RAG
// store. Cloak private keys, viewing keys, UTXO commitments, and all other
// cryptographic material never enter this module under any circumstances.
// If a conflict arises between QVAC data needs and Cloak security, the Cloak
// security model wins absolutely.
//
// CRITICAL — completion() is NOT a Promise:
//   const result = _llmHandle.completion({ ... }); // synchronous return
//   const text   = await result.text;              // only .text is awaited
//   Never: await _llmHandle.completion({ ... })    // this is wrong
//
// Four exports required by index.ts:
//   prewarmQVACModels()         — download + load both LLM and embedder models
//   initQVACAnomalyEngine()     — initialise persistent LLM handle after prewarm
//   shutdownQVACAnomalyEngine() — unload LLM model, must run before closeQVACRagStore
//   analyzeVaultAnomaly()       — run LLM risk analysis, return QVACAnomalyResult

import LlmLlamacpp from "@qvac/llm-llamacpp";
import GGMLBert from "@qvac/embed-llamacpp";
import { SLOTS_PER_DAY, VaultInactivityState } from "./block_counter";
import { VaultRecord }       from "../types/watcher";
import { logger }            from "../logger";

// ── Constants ─────────────────────────────────────────────────────────────────

const LLM_MODEL      = "LLAMA_3_2_1B_INST_Q4_0";
const EMBEDDER_MODEL = "GTE_LARGE_FP16";

// ctx_size: 2048 for watcher LLM — as specified. GPU forbidden throughout.
const LLM_MODEL_CONFIG = {
  device:    "cpu" as const,
  ctx_size:  2048,
  verbosity: 0,
};

// gpuLayers: 0 and device: "cpu" for embedder — GPU forbidden throughout.
const EMBEDDER_MODEL_CONFIG = {
  device: "cpu" as const,
  gpu_layers: "0" as const,
};

// ── QVAC Types ────────────────────────────────────────────────────────────────

/**
 * Behavioral profile of a vault constructed from watcher state.
 * Contains only metadata derived from on-chain activity patterns.
 * Cloak cryptographic fields (utxoCommitment, privateKey, viewingKey)
 * are never present in this struct — behavioral proxy only.
 * isShielded is derived from depositedLamports === "0", not from utxoCommitment.
 */
export interface VaultBehavior {
  /** Base58 vault address — for logging only, never injected into LLM prompt. */
  vaultAddress:           string;
  /** How long the vault has been silent, expressed in days. */
  currentSilenceDays:     number;
  /** Average check-in interval derived from sumOfIntervals / checkinCount, in days. */
  historicalAverageDays:  number;
  /** Human-readable summary of recent check-in cadence for the LLM prompt. */
  checkInHistory:         string;
  /** Number of registered guardians on this vault. */
  guardianCount:          number;
  /** Number of guardians that have signed the active covenant (0 if none). */
  guardiansSignedCount:   number;
  /** True if the vault is shielded — derived from depositedLamports === "0". */
  isShielded:             boolean;
  /** Count of behaviorally similar vaults that previously triggered inheritance, from RAG. */
  similarTriggeredVaults: number;
}

/**
 * The structured result returned by analyzeVaultAnomaly().
 * LLM output is always validated against this shape before any action is taken.
 * shouldAlert: false → no on-chain flag submitted, regardless of math result.
 */
export interface QVACAnomalyResult {
  riskLevel:       "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  shouldAlert:     boolean;
  reasoning:       string;
  confidenceScore: number;
}

// ── Module state ──────────────────────────────────────────────────────────────

// Persistent LLM handle held for the lifetime of the watcher process.
// Initialised by initQVACAnomalyEngine(), released by shutdownQVACAnomalyEngine().
let _llmHandle: LlmLlamacpp | null = null;

// Embedder handle used only during prewarmQVACModels() to pre-cache the model.
// The RAG store manages its own embedder handle via qvac_rag.ts.
let _prewarmEmbedderHandle: GGMLBert | null = null;

// ── Prewarm ───────────────────────────────────────────────────────────────────

/**
 * Downloads and pre-loads both the LLM and embedder models so they are
 * cached locally before the watcher begins processing poll cycles.
 *
 * Called once in main() after initSigningPool() and before the Solana
 * connection is opened. initQVACAnomalyEngine() and initQVACRagStore()
 * are called immediately after this returns.
 *
 * Both models are unloaded after download so initQVACAnomalyEngine and
 * initQVACRagStore each load their own persistent handle cleanly.
 */
export async function prewarmQVACModels(): Promise<void> {
  logger.info("QVAC: prewarming LLM and embedder models — downloading to local cache");

  const llm      = new LlmLlamacpp({ files: { model: [LLM_MODEL] }, config: LLM_MODEL_CONFIG });
  const embedder = new GGMLBert({ files: { model: [EMBEDDER_MODEL] }, config: EMBEDDER_MODEL_CONFIG });
  await llm.load();
  await llm.unload();
  await embedder.load();
  await embedder.unload();

  logger.info("QVAC: prewarm complete — both models cached locally");
}

// ── Init / shutdown ───────────────────────────────────────────────────────────

/**
 * Initialises the persistent LLM handle used for all anomaly analysis calls.
 * Called in main() after prewarmQVACModels() and before the first poll cycle.
 * The model stays loaded in RAM for the lifetime of the watcher process,
 * avoiding per-analysis load/unload overhead.
 */
export async function initQVACAnomalyEngine(): Promise<void> {
  logger.info("QVAC: initialising anomaly LLM engine");
  _llmHandle = new LlmLlamacpp({ files: { model: [LLM_MODEL] }, config: LLM_MODEL_CONFIG });
  await _llmHandle.load();
  logger.info("QVAC: anomaly LLM engine ready — model loaded");
}

/**
 * Unloads the LLM model and clears the handle.
 * Called first in shutdown(), before closeQVACRagStore() and getStore().close().
 * Shutdown order is absolute: QVAC unloads before the store closes.
 */
export async function shutdownQVACAnomalyEngine(): Promise<void> {
  if (!_llmHandle) return;
  try {
    await _llmHandle.unload();
    logger.info("QVAC: anomaly LLM engine unloaded cleanly");
  } catch (err) {
    logger.error({ err }, "QVAC: error unloading anomaly LLM engine — continuing shutdown");
  } finally {
    _llmHandle = null;
  }
}

// ── Behavior construction ─────────────────────────────────────────────────────

/**
 * Constructs a VaultBehavior from watcher state for a given vault.
 * This is the only place where VaultRecord and VaultInactivityState fields
 * are translated into the behavioral representation the LLM sees.
 *
 * isShielded is derived from depositedLamports === "0" — never from
 * utxoCommitment or any other Cloak field. The VaultRecord type has no
 * utxoCommitment field by design; shielded detection is purely lamport-based.
 *
 * similarTriggeredVaults is supplied by the caller from the RAG store result —
 * it is never hardcoded to 0. The RAG lookup always precedes this call.
 */
export function buildVaultBehavior(
  vault:                  VaultRecord,
  state:                  VaultInactivityState,
  similarTriggeredVaults: number,
): VaultBehavior {
  const slotsDayF         = Number(SLOTS_PER_DAY);
  const currentSilenceDays    = Number(state.elapsedSlots) / slotsDayF;

  const checkinCount   = BigInt(vault.checkinCount);
  const sumOfIntervals = BigInt(vault.sumOfIntervals);

  const historicalAverageDays =
    checkinCount > 0n && sumOfIntervals > 0n
      ? Number(sumOfIntervals / checkinCount) / slotsDayF
      : 0;

  // Build a concise check-in history description for the LLM.
  // Uses only aggregate behavioral data — no addresses or cryptographic values.
  const checkInHistory =
    checkinCount === 0n
      ? "No check-in history recorded"
      : `${checkinCount.toString()} total check-ins recorded, ` +
        `average interval ${historicalAverageDays.toFixed(1)} days, ` +
        `current silence ${currentSilenceDays.toFixed(1)} days ` +
        `(${historicalAverageDays > 0 ? (currentSilenceDays / historicalAverageDays).toFixed(2) : "N/A"}x average)`;

  // Shielded detection: depositedLamports === "0" means the vault's SOL was
  // moved into the Cloak shielded pool. No Cloak fields are read here.
  const isShielded = vault.depositedLamports === "0";

  return {
    vaultAddress:           vault.vaultAddress,
    currentSilenceDays,
    historicalAverageDays,
    checkInHistory,
    guardianCount:          vault.guardianCount,
    guardiansSignedCount:   0, // watcher does not track live covenant signature counts
    isShielded,
    similarTriggeredVaults,
  };
}

// ── Analysis ──────────────────────────────────────────────────────────────────

/**
 * Runs LLM risk analysis on a vault's behavioral profile and returns a
 * structured QVACAnomalyResult that gates the on-chain flag submission.
 *
 * shouldAlert: false → submitAnomalyFlag is not called, regardless of math.
 * shouldAlert: true  → submitAnomalyFlag proceeds.
 *
 * The LLM prompt contains behavioral metadata only. No private keys, viewing
 * keys, UTXO commitments, vault addresses, or any Cloak data appear in it.
 *
 * Falls back deterministically on any LLM failure so the system never silently
 * drops a genuine anomaly due to LLM unavailability. Fallback logic:
 *   ratio > 1.5 (i.e. silence > 1.5× historical average) → shouldAlert true, MEDIUM
 *   ratio ≤ 1.5                                           → shouldAlert false, LOW
 */
export async function analyzeVaultAnomaly(
  vault:    VaultRecord,
  state:    VaultInactivityState,
  behavior: VaultBehavior,
): Promise<QVACAnomalyResult> {
  const fallback = buildFallbackResult(behavior);

  if (!_llmHandle) {
    logger.warn(
      { vault: vault.vaultAddress },
      "QVAC: LLM handle not initialised — returning fallback anomaly result",
    );
    return fallback;
  }

  const prompt = buildAnomalyPrompt(behavior);

  try {
    const llmRes = await _llmHandle.run(
      [{ role: "user", content: prompt }],
      { generationParams: { predict: 256, temp: 0.1 } },
    );
    const llmOut = await llmRes.await() as any;
    const raw = typeof llmOut === "string" ? llmOut : (Array.isArray(llmOut) ? String(llmOut[llmOut.length - 1]) : String(llmOut));

    const parsed = parseQVACResponse(raw, fallback);

    logger.info(
      {
        vault:           vault.vaultAddress,
        riskLevel:       parsed.riskLevel,
        shouldAlert:     parsed.shouldAlert,
        confidenceScore: parsed.confidenceScore,
      },
      "QVAC: anomaly analysis complete",
    );

    return parsed;
  } catch (err) {
    logger.error(
      { vault: vault.vaultAddress, err },
      "QVAC: LLM completion threw — returning fallback anomaly result",
    );
    return fallback;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Builds the LLM prompt from behavioral metadata only.
 * The vault address is never injected into the prompt text — it is used only
 * for logging. No cryptographic material of any kind appears here.
 */
function buildAnomalyPrompt(behavior: VaultBehavior): string {
  const ratio = behavior.historicalAverageDays > 0
    ? (behavior.currentSilenceDays / behavior.historicalAverageDays).toFixed(2)
    : "N/A";

  return `You are a risk analysis engine for a blockchain inheritance protocol. Analyze vault behavioral data and assess anomaly risk.

Vault behavioral profile:
- Current silence: ${behavior.currentSilenceDays.toFixed(1)} days
- Historical average check-in interval: ${behavior.historicalAverageDays.toFixed(1)} days
- Silence-to-average ratio: ${ratio}x
- Guardian count: ${behavior.guardianCount}
- Guardians signed on active covenant: ${behavior.guardiansSignedCount}
- Vault uses shielded (private) balance: ${behavior.isShielded}
- Behaviorally similar vaults that triggered inheritance: ${behavior.similarTriggeredVaults}
- Check-in history: ${behavior.checkInHistory}

Determine whether this anomaly represents genuine risk warranting an on-chain anomaly flag.

Respond ONLY with a valid JSON object, no preamble, no markdown fences:
{"riskLevel":"HIGH","shouldAlert":true,"reasoning":"concise explanation here","confidenceScore":0.87}

Rules:
- riskLevel: exactly one of "LOW", "MEDIUM", "HIGH", "CRITICAL"
- shouldAlert: boolean — true only if the pattern strongly suggests genuine incapacitation
- reasoning: concise string, 1-2 sentences maximum
- confidenceScore: number 0.0 to 1.0`;
}

/**
 * Parses and validates the raw LLM text response against the QVACAnomalyResult shape.
 * LLM output is always validated before shouldAlert is acted upon.
 * Returns fallback on any parse failure or shape mismatch.
 */
function parseQVACResponse(raw: string, fallback: QVACAnomalyResult): QVACAnomalyResult {
  try {
    const clean  = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;

    const validLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

    if (
      typeof parsed.riskLevel      !== "string"          ||
      !validLevels.includes(parsed.riskLevel as string)  ||
      typeof parsed.shouldAlert    !== "boolean"          ||
      typeof parsed.reasoning      !== "string"           ||
      typeof parsed.confidenceScore !== "number"
    ) {
      logger.warn({ parsed }, "QVAC: LLM response failed shape validation — using fallback");
      return fallback;
    }

    return {
      riskLevel:       parsed.riskLevel       as QVACAnomalyResult["riskLevel"],
      shouldAlert:     parsed.shouldAlert      as boolean,
      reasoning:       parsed.reasoning        as string,
      confidenceScore: parsed.confidenceScore  as number,
    };
  } catch (err) {
    logger.warn({ err, raw }, "QVAC: failed to parse LLM JSON response — using fallback");
    return fallback;
  }
}

/**
 * Deterministic fallback result used when the LLM is unavailable or returns
 * a malformed response. Ensures the system never silently drops a genuine
 * anomaly. Ratio > 1.5 means silence has exceeded 1.5× historical average,
 * which is the same threshold isAnomalous() uses — so shouldAlert matches the
 * mathematical determination when the LLM cannot provide its own assessment.
 */
function buildFallbackResult(behavior: VaultBehavior): QVACAnomalyResult {
  const ratio = behavior.historicalAverageDays > 0
    ? behavior.currentSilenceDays / behavior.historicalAverageDays
    : 0;

  const shouldAlert = ratio > 1.5;

  return {
    riskLevel:       shouldAlert ? "MEDIUM" : "LOW",
    shouldAlert,
    reasoning:       shouldAlert
      ? `Fallback: silence ${behavior.currentSilenceDays.toFixed(1)}d exceeds 1.5× historical average ${behavior.historicalAverageDays.toFixed(1)}d`
      : `Fallback: silence ${behavior.currentSilenceDays.toFixed(1)}d within normal range`,
    confidenceScore: 0.5,
  };
}

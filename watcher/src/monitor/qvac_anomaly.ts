// watcher/src/monitor/qvac_anomaly.ts
//
// QVAC LLM-powered anomaly analysis for the watcher service.
//
// Migrated from @qvac/llm-llamacpp + @qvac/embed-llamacpp (deprecated) to
// the unified @qvac/sdk package. The SDK runs natively on Node.js >= v22.17
// without requiring a separate Bare runtime process.
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
//   const result = completion({ ... })  // synchronous return
//   const text   = await result.text    // only .text is awaited
//   Never: await completion({ ... })    // this is wrong
//
// Four exports required by index.ts:
//   prewarmQVACModels()         — download + cache both LLM and embedder models
//   initQVACAnomalyEngine()     — load persistent LLM model, store its ID
//   shutdownQVACAnomalyEngine() — unload LLM model, clear ID
//   analyzeVaultAnomaly()       — run LLM risk analysis, return QVACAnomalyResult
//
// buildVaultBehavior() is also exported and called directly by index.ts for
// the RAG ingest loop — it is a pure function with no @qvac/sdk dependency.

import {
  loadModel,
  unloadModel,
  completion,
  LLAMA_3_2_1B_INST_Q4_0,
  GTE_LARGE_FP16,
} from "@qvac/sdk";

import { SLOTS_PER_DAY, VaultInactivityState } from "./block_counter";
import { VaultRecord }                          from "../types/watcher";
import { logger }                               from "../logger";

// ── Model configuration ───────────────────────────────────────────────────────
//
// Both models run CPU-only throughout. @qvac/sdk defaults device to "gpu"
// and gpu_layers / gpuLayers to 99 — both must be explicitly overridden here.
// These constants are defined once so a future change requires exactly one
// edit per model type.

const LLM_MODEL_CONFIG = {
  ctx_size:   2048,     // context window — sufficient for anomaly prompts
  device:     "cpu" as const,
  gpu_layers: 0,        // override SDK default of 99
  verbosity:  0,        // suppress llama.cpp log noise
};

// EMBEDDER_MODEL_CONFIG is defined here and re-exported for prewarmQVACModels.
// qvac_rag.ts uses its own copy so both files are self-contained.
const EMBEDDER_MODEL_CONFIG = {
  device:    "cpu" as const,
  gpuLayers: 0,         // override SDK default of 99
};

// ── QVAC Types ────────────────────────────────────────────────────────────────

/**
 * Behavioral profile of a vault constructed from watcher state.
 *
 * Contains only metadata derived from on-chain activity patterns.
 * Cloak cryptographic fields (utxoCommitment, privateKey, viewingKey)
 * are never present in this struct — behavioral proxy only.
 *
 * isShielded is derived from depositedLamports === "0", not from
 * utxoCommitment. The VaultRecord type has no utxoCommitment field by
 * design; shielded detection is purely lamport-based throughout the watcher.
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
//
// @qvac/sdk identifies loaded models by a string ID returned from loadModel().
// We hold the LLM model ID for the process lifetime to avoid repeated
// load/unload overhead on every poll cycle. The embedder model ID is held
// by qvac_rag.ts which owns the RAG store lifecycle.

let _llmModelId: string | null = null;

// ── Prewarm ───────────────────────────────────────────────────────────────────

/**
 * Downloads and caches both the LLM and embedder models locally before the
 * watcher begins processing poll cycles.
 *
 * Called once in main() after initSigningPool() and before the Solana
 * connection is opened. initQVACAnomalyEngine() and initQVACRagStore() are
 * called immediately after this returns.
 *
 * Each model is loaded then immediately unloaded. The sole purpose is to
 * trigger @qvac/sdk's download-and-cache mechanism so that the subsequent
 * loadModel() calls in initQVACAnomalyEngine() and initQVACRagStore()
 * resolve from local disk instead of the network, keeping startup latency
 * low when the watcher restarts after the initial download.
 */
export async function prewarmQVACModels(): Promise<void> {
  logger.info("QVAC: prewarming LLM and embedder models — downloading to local cache");

  const llmId = await loadModel({
    modelSrc:    LLAMA_3_2_1B_INST_Q4_0,
    modelConfig: { ctx_size: 2048, gpu_layers: 0, device: "cpu" as const, verbosity: 0 },
  });
  await unloadModel({ modelId: llmId });

  const embedId = await loadModel({
    modelSrc:    GTE_LARGE_FP16,
    modelConfig: { gpuLayers: 0, device: "cpu" as const },
  });
  await unloadModel({ modelId: embedId });

  logger.info("QVAC: prewarm complete — both models cached locally");
}

// ── Init / shutdown ───────────────────────────────────────────────────────────

/**
 * Loads the LLM model into memory and stores its ID for the process lifetime.
 *
 * Called in main() after prewarmQVACModels() and before the first poll cycle.
 * The model stays loaded in RAM until shutdownQVACAnomalyEngine() is called,
 * avoiding per-analysis load/unload overhead across thousands of poll cycles.
 */
export async function initQVACAnomalyEngine(): Promise<void> {
  logger.info("QVAC: initialising anomaly LLM engine");

  _llmModelId = await loadModel({
    modelSrc:    LLAMA_3_2_1B_INST_Q4_0,
    modelConfig: { ctx_size: 2048, gpu_layers: 0, device: "cpu" as const, verbosity: 0 },
  });

  logger.info({ modelId: _llmModelId }, "QVAC: anomaly LLM engine ready — model loaded");
}

/**
 * Unloads the LLM model and clears its ID.
 *
 * Called first in shutdown(), before closeQVACRagStore() and getStore().close().
 * Shutdown order is absolute: LLM unloads first, embedder second, store last.
 * close() — which releases the @qvac/sdk client itself — is called at the end
 * of closeQVACRagStore() after both models have been unloaded.
 */
export async function shutdownQVACAnomalyEngine(): Promise<void> {
  if (!_llmModelId) return;

  try {
    await unloadModel({ modelId: _llmModelId });
    logger.info("QVAC: anomaly LLM engine unloaded cleanly");
  } catch (err) {
    logger.error({ err }, "QVAC: error unloading anomaly LLM engine — continuing shutdown");
  } finally {
    // Always clear the ID so the module is in a clean state even on error.
    _llmModelId = null;
  }
}

// ── Behavior construction ─────────────────────────────────────────────────────

/**
 * Constructs a VaultBehavior from watcher state for a given vault.
 *
 * This is the only place where VaultRecord and VaultInactivityState fields
 * are translated into the behavioral representation the LLM and embedder see.
 * It is a pure function — no @qvac/sdk calls, no I/O, no side effects.
 *
 * Called from two places:
 *   anomaly.ts  — during evaluateSingleAnomaly() before analyzeVaultAnomaly()
 *   index.ts    — during the RAG ingest loop after evaluateAllAnomalies()
 *
 * isShielded is derived from depositedLamports === "0" — never from
 * utxoCommitment or any other Cloak field.
 *
 * similarTriggeredVaults is supplied by the caller from the RAG store result —
 * it is never hardcoded to 0. The RAG lookup always precedes this call in
 * anomaly.ts; index.ts passes 0 explicitly for corpus ingest (the count is
 * only meaningful during similarity query, not during ingestion).
 */
export function buildVaultBehavior(
  vault:                  VaultRecord,
  state:                  VaultInactivityState,
  similarTriggeredVaults: number,
): VaultBehavior {
  const slotsDayF          = Number(SLOTS_PER_DAY);
  const currentSilenceDays = Number(state.elapsedSlots) / slotsDayF;

  const checkinCount   = BigInt(vault.checkinCount);
  const sumOfIntervals = BigInt(vault.sumOfIntervals);

  // Historical average in days. Zero when there is no check-in history so
  // the LLM and the fallback logic both handle the no-history case cleanly.
  const historicalAverageDays =
    checkinCount > 0n && sumOfIntervals > 0n
      ? Number(sumOfIntervals / checkinCount) / slotsDayF
      : 0;

  // Human-readable check-in history for the LLM prompt.
  // Aggregate counts only — no addresses or cryptographic values.
  const checkInHistory =
    checkinCount === 0n
      ? "No check-in history recorded"
      : `${checkinCount.toString()} total check-ins recorded, ` +
        `average interval ${historicalAverageDays.toFixed(1)} days, ` +
        `current silence ${currentSilenceDays.toFixed(1)} days ` +
        `(${historicalAverageDays > 0
          ? (currentSilenceDays / historicalAverageDays).toFixed(2)
          : "N/A"}x average)`;

  // Shielded detection: depositedLamports === "0" means the vault's SOL was
  // moved into the Cloak shielded pool. No Cloak fields are read here.
  const isShielded = vault.depositedLamports === "0";

  return {
    vaultAddress:           vault.vaultAddress,
    currentSilenceDays,
    historicalAverageDays,
    checkInHistory,
    guardianCount:          vault.guardianCount,
    // watcher does not track live covenant signature counts — always 0
    guardiansSignedCount:   0,
    isShielded,
    similarTriggeredVaults,
  };
}

// ── Analysis ──────────────────────────────────────────────────────────────────

/**
 * Runs LLM risk analysis on a vault's behavioral profile and returns a
 * validated QVACAnomalyResult that gates the on-chain flag submission.
 *
 * shouldAlert: false → submitAnomalyFlag is not called, regardless of math.
 * shouldAlert: true  → submitAnomalyFlag proceeds.
 *
 * The LLM prompt contains behavioral metadata only. No private keys, viewing
 * keys, UTXO commitments, vault addresses, or any Cloak data appear in it.
 *
 * Falls back deterministically on any LLM failure so the system never silently
 * drops a genuine anomaly due to LLM unavailability:
 *   ratio > 1.5 → shouldAlert true,  riskLevel MEDIUM
 *   ratio ≤ 1.5 → shouldAlert false, riskLevel LOW
 *
 * completion() returns a synchronous object — only result.text is awaited.
 * Never await completion() itself.
 */
export async function analyzeVaultAnomaly(
  vault:    VaultRecord,
  state:    VaultInactivityState,
  behavior: VaultBehavior,
): Promise<QVACAnomalyResult> {
  const fallback = buildFallbackResult(behavior);

  if (!_llmModelId) {
    logger.warn(
      { vault: vault.vaultAddress },
      "QVAC: LLM model not loaded — returning fallback anomaly result",
    );
    return fallback;
  }

  const prompt = buildAnomalyPrompt(behavior);

  try {
    // completion() is a synchronous call that returns a result object.
    // Awaiting result.text collects the full generated string after the
    // model finishes. stream: false is explicit — we need the complete
    // JSON response before parsing, not a token stream.
    const run = completion({
      modelId: _llmModelId,
      history: [{ role: "user", content: prompt }],
      stream:  false,
    });

    const final = await run.final;
    const raw   = final.raw.fullText;

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
 *
 * The vault address is never injected into the prompt text — it is used only
 * for logging in the caller. No cryptographic material of any kind appears
 * here. The prompt instructs the model to return raw JSON only so that
 * parseQVACResponse() has a clean string to work with.
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
 * Parses and validates the raw LLM text response against QVACAnomalyResult.
 *
 * The model is instructed to return raw JSON but may emit markdown fences
 * despite the prompt — these are stripped before parsing. Every field is
 * type-checked and enum-validated before the result is returned. Returns
 * fallback on any parse failure or shape mismatch so a malformed LLM response
 * can never cause an unhandled exception upstream.
 */
function parseQVACResponse(raw: string, fallback: QVACAnomalyResult): QVACAnomalyResult {
  try {
    const clean  = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;

    const validLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

    if (
      typeof parsed.riskLevel       !== "string"         ||
      !validLevels.includes(parsed.riskLevel as string)  ||
      typeof parsed.shouldAlert     !== "boolean"         ||
      typeof parsed.reasoning       !== "string"          ||
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
 * a malformed response.
 *
 * Mirrors the same 1.5× threshold used by isAnomalous() in block_counter.ts
 * so shouldAlert is consistent with the mathematical determination when the
 * LLM cannot provide its own assessment. This ensures the system never
 * silently drops a genuine anomaly due to LLM unavailability.
 */
function buildFallbackResult(behavior: VaultBehavior): QVACAnomalyResult {
  const ratio = behavior.historicalAverageDays > 0
    ? behavior.currentSilenceDays / behavior.historicalAverageDays
    : 0;

  const shouldAlert = ratio > 1.5;

  return {
    riskLevel:  shouldAlert ? "MEDIUM" : "LOW",
    shouldAlert,
    reasoning:  shouldAlert
      ? `Fallback: silence ${behavior.currentSilenceDays.toFixed(1)}d exceeds 1.5× historical average ${behavior.historicalAverageDays.toFixed(1)}d`
      : `Fallback: silence ${behavior.currentSilenceDays.toFixed(1)}d within normal range`,
    confidenceScore: 0.5,
  };
}

// guardian-app/src/lib/qvac_guardian.ts
//
// QVAC local LLM integration for the Guardian Android app.
//
// Uses @qvac/sdk — the unified mobile SDK — which manages the LLM lifecycle
// with an explicit state machine: idle → loaded → suspended.
//
// LIFECYCLE RULES (absolute):
//   While state() === "suspended", only suspend/resume/state are valid calls.
//   Always call unloadModel() in a finally block — never leave the model in RAM.
//   Always check state() before calling loadModel().
//   If state() === "suspended" in the finally block, call resume() first, then unloadModel().
//
// CRITICAL — completion() is NOT a Promise:
//   const result = llm.completion({ ... }); // synchronous return
//   const text   = await result.text;       // only .text is awaited
//   Never: await llm.completion({ ... })    // wrong
//
// ctx_size: 1024 for the guardian app LLM — smaller context than the watcher.
// device: "cpu" always — GPU forbidden throughout.
//
// Data boundary: generateRiskBrief() receives only GuardianVaultContext which
// contains behavioral metadata. No Cloak private keys, viewing keys, UTXO
// commitments, or cryptographic material ever enter the prompt or this module.
//
// Two exports:
//   generateRiskBrief(context) → GuardianRiskBrief
//   Fallback fires on any LLM failure — never throws to the caller.

import { getLlm, VERBOSITY } from "@qvac/sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_NAME = "LLAMA_3_2_1B_INST_Q4_0";

// ctx_size: 1024 for guardian app — as specified. GPU forbidden.
const MODEL_CONFIG = {
  device:    "cpu" as const,
  ctx_size:  1024,
  verbosity: VERBOSITY.ERROR,
};

// ── QVAC Types ────────────────────────────────────────────────────────────────

/**
 * Behavioral context passed to the LLM for risk brief generation.
 * Contains only behavioral metadata — no Cloak cryptographic material.
 * ownerAlias is a user-provided label, never a public key or address.
 */
export interface GuardianVaultContext {
  ownerAlias:             string;
  silenceDays:            number;
  historicalAvgDays:      number;
  guardiansRequired:      number;
  guardiansSignedSoFar:   number;
  vaultShielded:          boolean;
  anomalyFlagged:         boolean;
  covenantExpiresInDays:  number;
  similarTriggeredCount:  number;
}

/**
 * The structured risk brief returned to the RiskBrief screen.
 * Validated before any UI action is taken on the content.
 */
export interface GuardianRiskBrief {
  summary:              string;
  riskLevel:            "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recommendation:       string;
  irreversibleWarning:  string;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates a risk brief for the guardian decision screen using the local LLM.
 *
 * Manages the full model lifecycle within this call:
 *   1. Check state() — if suspended, resume first.
 *   2. Load model if state is idle.
 *   3. Run completion() (synchronous) and await result.text.
 *   4. Validate and parse the JSON response.
 *   5. Unload model in finally — never leave model in RAM.
 *      If state is "suspended" in the finally block, resume() before unloading.
 *
 * Falls back gracefully on any failure — never throws to the caller.
 * The RiskBrief screen always receives a valid GuardianRiskBrief.
 */
export async function generateRiskBrief(
  context: GuardianVaultContext,
): Promise<GuardianRiskBrief> {
  const fallback = buildFallback(context);
  const llm      = getLlm();

  try {
    // Check lifecycle state before any model operation.
    const currentState = await llm.state();

    if (currentState === "suspended") {
      await llm.resume();
    }

    // Load model only if currently idle (not already loaded).
    const stateAfterResume = await llm.state();
    if (stateAfterResume === "idle") {
      await llm.loadModel(MODEL_NAME, { modelConfig: MODEL_CONFIG });
    }

    const prompt = buildPrompt(context);

    // completion() returns synchronously — it is NOT a Promise.
    // Only result.text is awaited. Never await completion() itself.
    const result = llm.completion({
      prompt,
      completionConfig: { max_tokens: 300, temperature: 0.15 },
    });

    const raw = await result.text;

    return parseResponse(raw, fallback);
  } catch (err) {
    console.error("[QVAC] generateRiskBrief failed:", err);
    return fallback;
  } finally {
    // Always unload model in finally — never leave model in RAM.
    // If the model is in "suspended" state, resume() must be called first
    // before unloadModel() — per the QVAC lifecycle contract.
    try {
      const finalState = await llm.state();
      if (finalState === "suspended") {
        await llm.resume();
        await llm.unloadModel();
      } else if (finalState === "loaded") {
        await llm.unloadModel();
      }
      // If state is "idle", the model is already unloaded — nothing to do.
    } catch (unloadErr) {
      console.error("[QVAC] unloadModel failed in finally:", unloadErr);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Builds the LLM prompt from behavioral metadata only.
 * No vault addresses, public keys, private keys, or cryptographic data here.
 * ownerAlias is a user-supplied label — never a blockchain address.
 */
function buildPrompt(ctx: GuardianVaultContext): string {
  const ratio = ctx.historicalAvgDays > 0
    ? (ctx.silenceDays / ctx.historicalAvgDays).toFixed(2)
    : "N/A";

  return `You are an advisor helping a guardian decide whether to co-sign an inheritance covenant.

Vault behavioral context:
- Owner alias: ${ctx.ownerAlias}
- Current silence: ${ctx.silenceDays.toFixed(1)} days
- Historical average check-in interval: ${ctx.historicalAvgDays.toFixed(1)} days
- Silence-to-average ratio: ${ratio}x
- Guardians required to execute: ${ctx.guardiansRequired}
- Guardians signed so far: ${ctx.guardiansSignedSoFar}
- Vault uses shielded balance: ${ctx.vaultShielded}
- On-chain anomaly flag active: ${ctx.anomalyFlagged}
- Covenant expires in: ${ctx.covenantExpiresInDays} days
- Similar vaults that triggered inheritance: ${ctx.similarTriggeredCount}

Provide a concise risk brief to help the guardian make an informed signing decision.
Signing a covenant is IRREVERSIBLE once the threshold is met — make the irreversibleWarning clear.

Respond ONLY with a JSON object, no preamble, no markdown:
{"summary":"2 sentence overview","riskLevel":"HIGH","recommendation":"1 sentence action advice","irreversibleWarning":"clear statement about irreversibility"}

riskLevel: exactly one of "LOW", "MEDIUM", "HIGH", "CRITICAL"`;
}

/**
 * Parses and validates the LLM JSON response.
 * Returns fallback on any parse error or shape mismatch.
 */
function parseResponse(raw: string, fallback: GuardianRiskBrief): GuardianRiskBrief {
  try {
    const clean  = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;

    const validLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

    if (
      typeof parsed.summary              !== "string" ||
      typeof parsed.riskLevel            !== "string" ||
      !validLevels.includes(parsed.riskLevel as string) ||
      typeof parsed.recommendation       !== "string" ||
      typeof parsed.irreversibleWarning  !== "string"
    ) {
      return fallback;
    }

    return {
      summary:             parsed.summary             as string,
      riskLevel:           parsed.riskLevel           as GuardianRiskBrief["riskLevel"],
      recommendation:      parsed.recommendation      as string,
      irreversibleWarning: parsed.irreversibleWarning as string,
    };
  } catch {
    return fallback;
  }
}

/**
 * Deterministic fallback brief when the LLM is unavailable.
 * Risk level is escalated based on silence ratio so critical situations
 * are never downplayed due to LLM failure.
 */
function buildFallback(ctx: GuardianVaultContext): GuardianRiskBrief {
  const ratio = ctx.historicalAvgDays > 0
    ? ctx.silenceDays / ctx.historicalAvgDays
    : 0;

  const riskLevel: GuardianRiskBrief["riskLevel"] =
    ratio >= 3    ? "CRITICAL" :
    ratio >= 2    ? "HIGH"     :
    ratio >= 1.5  ? "MEDIUM"   : "LOW";

  return {
    summary:
      `Owner ${ctx.ownerAlias} has been silent for ${ctx.silenceDays.toFixed(1)} days ` +
      `against a ${ctx.historicalAvgDays.toFixed(1)}-day historical average (${ratio.toFixed(2)}x ratio). ` +
      `${ctx.anomalyFlagged ? "An on-chain anomaly flag is active. " : ""}` +
      `${ctx.similarTriggeredCount} similar vaults have previously triggered inheritance.`,
    riskLevel,
    recommendation:
      ratio >= 2
        ? "Review all available context carefully before signing — the silence period is significantly elevated."
        : "Verify you have attempted to contact the owner through all available channels before signing.",
    irreversibleWarning:
      "Signing this covenant is irreversible. Once the required threshold of guardians sign, inheritance execution cannot be stopped.",
  };
}

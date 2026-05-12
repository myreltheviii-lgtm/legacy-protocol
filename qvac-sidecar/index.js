'use strict';

// qvac-sidecar/index.js
//
// Node.js HTTP server wrapping @qvac/sdk LLM inference for the Guardian app.
// Runs as a Tauri sidecar on 127.0.0.1:7648.
//
// Endpoints:
//   GET  /health   — health check
//   POST /analyze  — accepts GuardianVaultContext, returns GuardianRiskBrief
//
// Uses the correct current @qvac/sdk API:
//   loadModel({ modelSrc, modelType, modelConfig }) → modelId (string)
//   completion({ modelId, history, stream, generationParams }) — synchronous
//   await result.text — only .text is awaited, never completion() itself
//   unloadModel({ modelId }) — always called in finally
//
// GPU forbidden throughout: device: "cpu", gpu_layers: 0 always.
// Cloak cryptographic material never enters this module or the LLM prompt.
// Data boundary: GuardianVaultContext contains behavioral metadata only.

const http = require('http');

const {
  loadModel,
  unloadModel,
  completion,
  LLAMA_3_2_1B_INST_Q4_0,
} = require('@qvac/sdk');

const PORT = 7648;
const HOST = '127.0.0.1';

// ── Model configuration ──────────────────────────────────────────────────────
//
// @qvac/sdk defaults device to "gpu" and gpu_layers to 99.
// Both must be explicitly overridden for CPU-only operation.

const LLM_MODEL_CONFIG = {
  ctx_size:   1024,   // guardian app context window
  device:     'cpu',  // GPU forbidden throughout
  gpu_layers: 0,      // override SDK default of 99
  verbosity:  0,      // suppress llama.cpp log noise
};

// ── Request helpers ──────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ── Prompt builder ───────────────────────────────────────────────────────────
//
// Behavioral metadata only. No vault addresses, public keys,
// private keys, or cryptographic data appear in the prompt.
// ownerAlias is a user-supplied behavioral descriptor — never a blockchain address.

function buildPrompt(ctx) {
  const ratio = ctx.historicalAvgDays > 0
    ? (ctx.silenceDays / ctx.historicalAvgDays).toFixed(2)
    : 'N/A';

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

Respond ONLY with a JSON object, no preamble, no markdown fences:
{"summary":"2 sentence overview","riskLevel":"HIGH","recommendation":"1 sentence action advice","irreversibleWarning":"clear statement about irreversibility"}

riskLevel: exactly one of "LOW", "MEDIUM", "HIGH", "CRITICAL"`;
}

// ── Fallback builder ─────────────────────────────────────────────────────────
//
// Deterministic fallback when the LLM is unavailable or returns a bad response.
// Risk level is escalated based on silence ratio so critical situations
// are never downplayed due to LLM failure.

function buildFallback(ctx) {
  const ratio = ctx.historicalAvgDays > 0
    ? ctx.silenceDays / ctx.historicalAvgDays
    : 0;

  const riskLevel =
    ratio >= 3   ? 'CRITICAL' :
    ratio >= 2   ? 'HIGH'     :
    ratio >= 1.5 ? 'MEDIUM'   : 'LOW';

  return {
    summary:
      `Owner ${ctx.ownerAlias} has been silent for ${ctx.silenceDays.toFixed(1)} days ` +
      `against a ${ctx.historicalAvgDays.toFixed(1)}-day historical average (${ratio.toFixed(2)}x ratio). ` +
      `${ctx.anomalyFlagged ? 'An on-chain anomaly flag is active. ' : ''}` +
      `${ctx.similarTriggeredCount} similar vaults have previously triggered inheritance.`,
    riskLevel,
    recommendation:
      ratio >= 2
        ? 'Review all available context carefully before signing — the silence period is significantly elevated.'
        : 'Verify you have attempted to contact the owner through all available channels before signing.',
    irreversibleWarning:
      'Signing this covenant is irreversible. Once the required threshold of guardians sign, inheritance execution cannot be stopped.',
  };
}

// ── Response parser ──────────────────────────────────────────────────────────

function parseResponse(raw, fallback) {
  try {
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const validLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

    if (
      typeof parsed.summary             !== 'string' ||
      typeof parsed.riskLevel           !== 'string' ||
      !validLevels.includes(parsed.riskLevel)        ||
      typeof parsed.recommendation      !== 'string' ||
      typeof parsed.irreversibleWarning !== 'string'
    ) {
      console.warn('[qvac-sidecar] LLM response failed shape validation — using fallback');
      return fallback;
    }

    return {
      summary:             parsed.summary,
      riskLevel:           parsed.riskLevel,
      recommendation:      parsed.recommendation,
      irreversibleWarning: parsed.irreversibleWarning,
    };
  } catch (err) {
    console.warn('[qvac-sidecar] Failed to parse LLM JSON response — using fallback:', err);
    return fallback;
  }
}

// ── Analyze handler ──────────────────────────────────────────────────────────
//
// Manages the full model lifecycle per request:
//   1. loadModel() → modelId
//   2. completion() — synchronous call, NOT a Promise
//   3. await result.text — only .text is awaited
//   4. unloadModel({ modelId }) in finally — never leave model in RAM

async function handleAnalyze(ctx) {
  const fallback = buildFallback(ctx);
  let modelId    = null;

  try {
    modelId = await loadModel({
      modelSrc:    LLAMA_3_2_1B_INST_Q4_0,
      modelType:   'llm',
      modelConfig: LLM_MODEL_CONFIG,
    });

    const prompt = buildPrompt(ctx);

    // completion() is a synchronous call — it returns an object immediately.
    // Only result.text is a Promise. Never await completion() itself.
    const result = completion({
      modelId,
      history:          [{ role: 'user', content: prompt }],
      stream:           false,
      generationParams: { temp: 0.15, predict: 300 },
    });

    const raw = await result.text;

    return parseResponse(raw, fallback);

  } catch (err) {
    console.error('[qvac-sidecar] handleAnalyze error:', err);
    return fallback;
  } finally {
    // Always unload in finally — never leave model in RAM.
    if (modelId) {
      try {
        await unloadModel({ modelId });
      } catch (unloadErr) {
        console.error('[qvac-sidecar] unloadModel failed in finally:', unloadErr);
      }
    }
  }
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    try {
      const ctx    = await readBody(req);
      const result = await handleAnalyze(ctx);
      send(res, 200, result);
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  send(res, 404, { error: `Unknown endpoint: ${req.url}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[qvac-sidecar] Ready on ${HOST}:${PORT}`);
});

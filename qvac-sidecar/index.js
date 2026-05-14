'use strict';

const http = require('http');
const { loadModel, unloadModel, completion, LLAMA_3_2_1B_INST_Q4_0 } = require('@qvac/sdk');

const PORT = 7648;
const HOST = '127.0.0.1';

const LLM_MODEL_CONFIG = {
  ctx_size:   2048,
  device:     'cpu',
  gpu_layers: 0,
  verbosity:  0,
};

// ── Request queue — only one LLM call runs at a time ─────────────────────────
let _queue    = [];
let _running  = false;

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    _queue.push({ fn, resolve, reject });
    drain();
  });
}

async function drain() {
  if (_running || _queue.length === 0) return;
  _running = true;
  const { fn, resolve, reject } = _queue.shift();
  try {
    resolve(await fn());
  } catch (err) {
    reject(err);
  } finally {
    _running = false;
    drain();
  }
}

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
- Guardians required: ${ctx.guardiansRequired}
- Guardians signed so far: ${ctx.guardiansSignedSoFar}
- Vault shielded: ${ctx.vaultShielded}
- Anomaly flag active: ${ctx.anomalyFlagged}
- Covenant expires in: ${ctx.covenantExpiresInDays} days
- Similar vaults triggered: ${ctx.similarTriggeredCount}

Respond ONLY with a JSON object, no preamble, no markdown fences:
{"summary":"2 sentence overview","riskLevel":"HIGH","recommendation":"1 sentence advice","irreversibleWarning":"clear irreversibility statement"}

riskLevel: exactly one of "LOW", "MEDIUM", "HIGH", "CRITICAL"`;
}

function buildFallback(ctx) {
  const ratio = ctx.historicalAvgDays > 0 ? ctx.silenceDays / ctx.historicalAvgDays : 0;
  const riskLevel = ratio >= 3 ? 'CRITICAL' : ratio >= 2 ? 'HIGH' : ratio >= 1.5 ? 'MEDIUM' : 'LOW';
  return {
    summary: `Owner ${ctx.ownerAlias} has been silent for ${ctx.silenceDays.toFixed(1)} days against a ${ctx.historicalAvgDays.toFixed(1)}-day historical average (${ratio.toFixed(2)}x ratio). ${ctx.similarTriggeredCount} similar vaults have previously triggered inheritance.`,
    riskLevel,
    recommendation: ratio >= 2
      ? 'Review all available context carefully before signing — the silence period is significantly elevated.'
      : 'Verify you have attempted to contact the owner through all available channels before signing.',
    irreversibleWarning: 'Signing this covenant is irreversible. Once the required threshold of guardians sign, inheritance execution cannot be stopped.',
  };
}

function parseResponse(raw, fallback) {
  try {
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const valid  = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (
      typeof parsed.summary             !== 'string' ||
      typeof parsed.riskLevel           !== 'string' ||
      !valid.includes(parsed.riskLevel)              ||
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
    console.warn('[qvac-sidecar] Failed to parse LLM JSON — using fallback:', err);
    return fallback;
  }
}

async function runLLM(ctx) {
  const fallback = buildFallback(ctx);
  let modelId    = null;

  try {
    modelId = await loadModel({
      modelSrc:    LLAMA_3_2_1B_INST_Q4_0,
      modelConfig: LLM_MODEL_CONFIG,
    });

    const run   = completion({
      modelId,
      history: [{ role: 'user', content: buildPrompt(ctx) }],
      stream:  false,
    });
    const final = await run.final;
    return parseResponse(final.raw.fullText, fallback);
  } catch (err) {
    console.error('[qvac-sidecar] LLM error:', err);
    return fallback;
  } finally {
    if (modelId) {
      try { await unloadModel({ modelId }); } catch (_) {}
    }
  }
}

async function handleAnalyze(ctx) {
  return enqueue(() => runLLM(ctx));
}

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
      send(res, 500, { error: String(err) });
    }
    return;
  }
  send(res, 404, { error: `Unknown endpoint: ${req.url}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[qvac-sidecar] Ready on ${HOST}:${PORT}`);
});

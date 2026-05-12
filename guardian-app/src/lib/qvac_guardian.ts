// guardian-app/src/lib/qvac_guardian.ts
//
// Bridge to the QVAC sidecar HTTP server on 127.0.0.1:7648.
// Zero @qvac/sdk imports — the SDK runs in the Node.js sidecar process.
// All calls are fetch() to the sidecar, mirroring the cloak-bridge pattern.
//
// Data boundary: GuardianVaultContext contains behavioral metadata only.
// No Cloak private keys, viewing keys, UTXO commitments, or cryptographic
// material ever enter this module or the QVAC LLM prompt.

const QVAC_BASE = 'http://127.0.0.1:7648';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Behavioral context passed to the QVAC sidecar for risk brief generation.
 * Contains only behavioral metadata — no Cloak cryptographic material.
 * ownerAlias is a user-provided behavioral descriptor, never a public key.
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
  riskLevel:            'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation:       string;
  irreversibleWarning:  string;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Sends GuardianVaultContext to the QVAC sidecar for LLM risk analysis.
 * Returns a validated GuardianRiskBrief. Falls back deterministically on
 * any failure — never throws to the caller.
 */
export async function generateRiskBrief(
  context: GuardianVaultContext,
): Promise<GuardianRiskBrief> {
  const fallback = buildFallback(context);

  try {
    const res = await fetch(`${QVAC_BASE}/analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(context),
    });

    if (!res.ok) {
      console.error('[qvac_guardian] Sidecar responded', res.status);
      return fallback;
    }

    const data = await res.json() as GuardianRiskBrief;

    // Validate shape before returning — never trust unvalidated LLM output.
    const validLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

    if (
      typeof data.summary             !== 'string' ||
      typeof data.riskLevel           !== 'string' ||
      !validLevels.includes(data.riskLevel)        ||
      typeof data.recommendation      !== 'string' ||
      typeof data.irreversibleWarning !== 'string'
    ) {
      console.warn('[qvac_guardian] Sidecar response failed shape validation — using fallback');
      return fallback;
    }

    return data;
  } catch (err) {
    console.error('[qvac_guardian] generateRiskBrief failed:', err);
    return fallback;
  }
}

// ── Fallback ─────────────────────────────────────────────────────────────────

/**
 * Deterministic fallback brief when the QVAC sidecar is unavailable.
 * Risk level is escalated based on silence ratio so critical situations
 * are never downplayed due to sidecar failure.
 */
function buildFallback(ctx: GuardianVaultContext): GuardianRiskBrief {
  const ratio = ctx.historicalAvgDays > 0
    ? ctx.silenceDays / ctx.historicalAvgDays
    : 0;

  const riskLevel: GuardianRiskBrief['riskLevel'] =
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

// guardian-app/src/screens/RiskBrief.tsx
//
// QVAC risk brief screen. Calls generateRiskBrief() via the QVAC sidecar HTTP
// server and displays the LLM result with full visual treatment.
// Converted from React Native to HTML/CSS for Tauri webview.
//
// Security invariant preserved: ownerAlias uses a purely behavioral descriptor
// derived from zone and silence duration — no vault address, public key, or
// any other cryptographic material ever enters the LLM prompt context.

import { useState, useEffect }       from 'react';
import { useNavigate, useLocation }  from 'react-router-dom';
import { generateRiskBrief }         from '../lib/qvac_guardian';
import type {
  GuardianRiskBrief,
  GuardianVaultContext,
}                                    from '../lib/qvac_guardian';
import { RiskBadge }                 from '../components/RiskBadge';
import { Colors, Typography, Spacing, Radius, riskColor } from '../theme';
import type { VaultSummary }         from '../hooks/useVaultData';

export function RiskBrief() {
  const navigate = useNavigate();
  const location = useLocation();
  const vault    = location.state?.vault as VaultSummary | undefined;

  const [brief,   setBrief]   = useState<GuardianRiskBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!vault) {
      navigate('/');
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        // Build GuardianVaultContext from behavioral metadata only.
        // ownerAlias MUST NOT contain any Solana address, public key, hash,
        // or other cryptographic value — vault.vaultAddress is a PDA (public key)
        // and must never appear in the LLM prompt. Use a behavioral descriptor.
        const context: GuardianVaultContext = {
          ownerAlias:            `${vault!.zone} zone vault (${vault!.silenceDays.toFixed(0)}d silent)`,
          silenceDays:           vault!.silenceDays,
          historicalAvgDays:     vault!.historicalAvgDays,
          guardiansRequired:     vault!.mOfNThreshold,
          guardiansSignedSoFar:  0,
          vaultShielded:         vault!.isShielded,
          anomalyFlagged:        vault!.anomalyFlagged,
          covenantExpiresInDays: 0,
          similarTriggeredCount: 0,
        };

        const result = await generateRiskBrief(context);
        if (!cancelled) setBrief(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // void satisfies the floating-Promise rule.
    // load() handles all errors internally and never rejects.
    void load();
    return () => { cancelled = true; };
  }, [vault, navigate]);

  if (!vault) return null;

  const rc         = brief ? riskColor(brief.riskLevel) : Colors.textMuted;
  const isCritical = brief?.riskLevel === 'CRITICAL';

  return (
    <div style={styles.safe}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate(-1)}>
          ← Detail
        </button>
        <h3 style={styles.headerTitle}>Risk Brief</h3>
        <div style={{ width: '60px' }} />
      </div>

      {/* Loading state */}
      {loading && (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Analysing vault behavior…</p>
          <p style={styles.privacyNote}>
            🔒 Analysis runs locally. No data leaves your device.
          </p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div style={styles.errorContainer}>
          <p style={styles.errorTitle}>Analysis unavailable</p>
          <p style={styles.errorText}>{error}</p>
          <button style={styles.retryBtn} onClick={() => navigate(-1)}>
            Go back
          </button>
        </div>
      )}

      {/* Content */}
      {!loading && !error && brief && (
        <div style={styles.scroll}>
          {/* Risk level hero block */}
          <div style={{
            ...styles.heroBanner,
            border:          `1px solid ${rc}`,
            backgroundColor: rc + '18',
          }}>
            <RiskBadge level={brief.riskLevel} />
            <div style={{
              ...styles.riskOrb,
              backgroundColor: rc + '33',
              border:          `2px solid ${rc}`,
            }}>
              <span style={{ ...styles.riskOrbText, color: rc }}>
                {brief.riskLevel}
              </span>
            </div>
          </div>

          {/* Summary */}
          <div style={styles.card}>
            <p style={styles.cardLabel}>SITUATION SUMMARY</p>
            <p style={styles.summaryText}>{brief.summary}</p>
          </div>

          {/* Recommendation */}
          <div style={styles.card}>
            <p style={styles.cardLabel}>RECOMMENDATION</p>
            <p style={{ ...styles.summaryText, color: Colors.accent }}>
              {brief.recommendation}
            </p>
          </div>

          {/* Irreversible warning — always prominent */}
          <div style={{
            ...styles.warningCard,
            border: `2px solid ${Colors.CRITICAL}`,
          }}>
            <span style={styles.warningIcon}>⚠</span>
            <p style={styles.warningTitle}>IRREVERSIBLE ACTION</p>
            <p style={styles.warningBody}>{brief.irreversibleWarning}</p>
          </div>

          {/* Vault context summary — behavioral only */}
          <div style={styles.card}>
            <p style={styles.cardLabel}>VAULT CONTEXT</p>
            <ContextRow
              label="Silence"
              value={`${vault.silenceDays.toFixed(1)} days`}
            />
            <ContextRow
              label="Avg interval"
              value={vault.historicalAvgDays > 0
                ? `${vault.historicalAvgDays.toFixed(1)} days`
                : 'Unknown'}
            />
            <ContextRow
              label="Anomaly flag"
              value={vault.anomalyFlagged ? 'Active' : 'Clear'}
              color={vault.anomalyFlagged ? Colors.CRITICAL : Colors.GREEN}
            />
            <ContextRow
              label="Shielded"
              value={vault.isShielded ? 'Yes' : 'No'}
            />
          </div>

          {/* Proceed button — blocked on CRITICAL */}
          {isCritical ? (
            <div style={styles.blockedBtn}>
              <p style={styles.blockedText}>
                Signing blocked at CRITICAL risk level. Seek independent verification.
              </p>
            </div>
          ) : (
            <button
              style={styles.signBtn}
              onClick={() => navigate('/sign-covenant', { state: { vault } })}
            >
              Proceed to Sign Covenant
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ContextRow({
  label, value, color,
}: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      display:        'flex',
      justifyContent: 'space-between',
      paddingTop:     Spacing.xs,
      paddingBottom:  Spacing.xs,
      borderBottom:   `1px solid ${Colors.border}`,
    }}>
      <span style={Typography.bodySmall}>{label}</span>
      <span style={{ ...Typography.body, color: color ?? Colors.textPrimary }}>
        {value}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  safe: {
    backgroundColor: Colors.background,
    minHeight:       '100vh',
  },
  header: {
    display:        'flex',
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingLeft:    Spacing.lg,
    paddingRight:   Spacing.lg,
    paddingTop:     Spacing.md,
    paddingBottom:  Spacing.md,
    borderBottom:   `1px solid ${Colors.border}`,
  },
  backBtn: {
    background: 'none',
    border:     'none',
    color:      Colors.accent,
    cursor:     'pointer',
    fontSize:   '14px',
    padding:    Spacing.xs,
    width:      '60px',
  },
  headerTitle: {
    ...Typography.heading3,
    margin: 0,
  },
  loadingContainer: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            Spacing.md,
    padding:        Spacing.xl,
    minHeight:      '60vh',
  },
  spinner: {
    width:          '36px',
    height:         '36px',
    borderRadius:   '50%',
    border:         `3px solid ${Colors.border}`,
    borderTopColor: Colors.accent,
    animation:      'spin 0.8s linear infinite',
  },
  loadingText: {
    ...Typography.body,
    margin: 0,
  },
  privacyNote: {
    ...Typography.bodySmall,
    textAlign: 'center',
    maxWidth:  '260px',
    margin:    0,
  },
  errorContainer: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        Spacing.xl,
    gap:            Spacing.md,
    minHeight:      '60vh',
  },
  errorTitle: {
    ...Typography.heading2,
    color:  Colors.CRITICAL,
    margin: 0,
  },
  errorText: {
    ...Typography.bodySmall,
    textAlign: 'center',
    margin:    0,
  },
  retryBtn: {
    padding:      `${Spacing.md}px`,
    borderRadius: `${Radius.md}px`,
    border:       `1px solid ${Colors.border}`,
    background:   'none',
    color:        Colors.accent,
    cursor:       'pointer',
    fontSize:     '14px',
    marginTop:    Spacing.sm,
  },
  scroll: {
    padding:       Spacing.lg,
    display:       'flex',
    flexDirection: 'column',
    gap:           Spacing.md,
  },
  heroBanner: {
    display:        'flex',
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    borderRadius:   `${Radius.lg}px`,
    padding:        Spacing.lg,
  },
  riskOrb: {
    width:          '80px',
    height:         '80px',
    borderRadius:   '40px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
  },
  riskOrbText: {
    fontSize:      '13px',
    fontWeight:    '800',
    letterSpacing: '1px',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius:    `${Radius.md}px`,
    border:          `1px solid ${Colors.border}`,
    padding:         Spacing.md,
    display:         'flex',
    flexDirection:   'column',
    gap:             Spacing.sm,
  },
  cardLabel: {
    ...Typography.label,
    marginBottom: Spacing.xs,
    margin:       0,
  },
  summaryText: {
    ...Typography.body,
    lineHeight: '22px',
    margin:     0,
  },
  warningCard: {
    backgroundColor: Colors.CRITICAL + '11',
    borderRadius:    `${Radius.md}px`,
    padding:         Spacing.md,
    display:         'flex',
    flexDirection:   'column',
    gap:             Spacing.xs,
    alignItems:      'center',
  },
  warningIcon: {
    fontSize: '28px',
  },
  warningTitle: {
    ...Typography.label,
    color:    Colors.CRITICAL,
    fontSize: '12px',
    margin:   0,
  },
  warningBody: {
    ...Typography.body,
    color:      Colors.CRITICAL,
    textAlign:  'center',
    lineHeight: '20px',
    margin:     0,
  },
  blockedBtn: {
    backgroundColor: Colors.CRITICAL + '18',
    borderRadius:    `${Radius.md}px`,
    border:          `1px solid ${Colors.CRITICAL}`,
    padding:         Spacing.md,
    textAlign:       'center',
  },
  blockedText: {
    ...Typography.body,
    color:  Colors.CRITICAL,
    margin: 0,
  },
  signBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    `${Radius.md}px`,
    padding:         Spacing.md,
    textAlign:       'center',
    border:          'none',
    color:           Colors.background,
    fontSize:        '16px',
    fontWeight:      '600',
    cursor:          'pointer',
    width:           '100%',
    marginTop:       Spacing.sm,
  },
};

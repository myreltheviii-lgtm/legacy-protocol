// guardian-app/src/components/VaultCard.tsx
//
// Renders a single vault row in the GuardianDashboard list.
// Shows zone indicator, silence duration, anomaly/trigger flags, guardian counts.
// Converted from React Native to HTML/CSS for Tauri webview.

import { Colors, Typography, Spacing, Radius, zoneColor } from '../theme';
import { RiskBadge } from './RiskBadge';
import type { VaultSummary } from '../hooks/useVaultData';

interface Props {
  vault:   VaultSummary;
  onPress: (vault: VaultSummary) => void;
}

export function VaultCard({ vault, onPress }: Props) {
  const zc = zoneColor(vault.zone);

  return (
    <div
      style={styles.card}
      onClick={() => onPress(vault)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onPress(vault); }}
    >
      {/* Zone indicator bar */}
      <div style={{ ...styles.zonebar, backgroundColor: zc }} />

      <div style={styles.body}>
        {/* Header row */}
        <div style={styles.row}>
          <span style={styles.address}>
            {vault.vaultAddress.slice(0, 8)}…{vault.vaultAddress.slice(-6)}
          </span>
          <RiskBadge level={vault.zone} size="sm" />
        </div>

        {/* Silence info */}
        <div style={styles.row}>
          <span style={styles.meta}>
            Silent {vault.silenceDays.toFixed(1)}d
            {vault.historicalAvgDays > 0
              ? `  ·  avg ${vault.historicalAvgDays.toFixed(1)}d`
              : ''}
          </span>
          {vault.isShielded && (
            <span style={styles.shield}>🔒 Shielded</span>
          )}
        </div>

        {/* Flags row */}
        <div style={styles.flagsRow}>
          <div style={styles.flagsLeft}>
            {vault.anomalyFlagged && (
              <div style={{ ...styles.flag, borderColor: Colors.CRITICAL }}>
                <span style={{ ...styles.flagText, color: Colors.CRITICAL }}>
                  ANOMALY
                </span>
              </div>
            )}
            {vault.triggerSignalled && (
              <div style={{ ...styles.flag, borderColor: Colors.RED }}>
                <span style={{ ...styles.flagText, color: Colors.RED }}>
                  TRIGGER
                </span>
              </div>
            )}
          </div>
          <span style={styles.guardians}>
            {vault.guardianCount} guardian{vault.guardianCount !== 1 ? 's' : ''}
            {'  ·  '}
            {vault.mOfNThreshold}-of-{vault.guardianCount} required
          </span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display:         'flex',
    flexDirection:   'row',
    backgroundColor: Colors.surface,
    borderRadius:    `${Radius.md}px`,
    border:          `1px solid ${Colors.border}`,
    marginBottom:    Spacing.sm,
    overflow:        'hidden',
    cursor:          'pointer',
  },
  zonebar: {
    width:     '4px',
    flexShrink: 0,
  },
  body: {
    flex:          1,
    padding:       Spacing.md,
    display:       'flex',
    flexDirection: 'column',
    gap:           Spacing.xs,
  },
  row: {
    display:        'flex',
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  address: {
    ...Typography.mono,
    fontSize:     '13px',
    color:        Colors.textPrimary,
    flex:         1,
    marginRight:  Spacing.sm,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },
  meta: {
    ...Typography.bodySmall,
  },
  shield: {
    ...Typography.bodySmall,
    color: Colors.accent,
  },
  flagsRow: {
    display:        'flex',
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  flagsLeft: {
    display:       'flex',
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.xs,
    flex:          1,
    flexWrap:      'wrap',
  },
  flag: {
    borderWidth:   '1px',
    borderStyle:   'solid',
    borderRadius:  `${Radius.sm}px`,
    paddingLeft:   '6px',
    paddingRight:  '6px',
    paddingTop:    '2px',
    paddingBottom: '2px',
  },
  flagText: {
    fontSize:      '9px',
    fontWeight:    '700',
    letterSpacing: '0.6px',
  },
  guardians: {
    ...Typography.bodySmall,
    textAlign: 'right',
  },
};

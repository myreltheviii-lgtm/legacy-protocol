// guardian-app/src/screens/VaultDetail.tsx
//
// Full vault state screen. Shows all fields, all flags, zone indicator,
// and provides navigation to the QVAC risk brief and covenant signing flow.
// Converted from React Native to HTML/CSS for Tauri webview.

import { useNavigate, useLocation } from 'react-router-dom';
import { RiskBadge }   from '../components/RiskBadge';
import { Colors, Typography, Spacing, Radius, zoneColor } from '../theme';
import type { VaultSummary } from '../hooks/useVaultData';

const SLOTS_PER_DAY = 172_800;

export function VaultDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const vault    = location.state?.vault as VaultSummary | undefined;

  if (!vault) {
    navigate('/');
    return null;
  }

  const zc              = zoneColor(vault.zone);
  const thresholdDays   = (Number(vault.inactivityThresholdSlots) / SLOTS_PER_DAY).toFixed(1);
  const lastCheckInDate = new Date(
    Date.now() - vault.silenceDays * 24 * 60 * 60 * 1000,
  ).toLocaleDateString();

  return (
    <div style={styles.safe}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>
          ← Vaults
        </button>
        <RiskBadge level={vault.zone} />
      </div>

      <div style={styles.scroll}>
        {/* Zone banner */}
        <div style={{
          ...styles.zoneBanner,
          backgroundColor: zc + '22',
          border:          `1px solid ${zc}`,
        }}>
          <div style={{ ...styles.zoneDot, backgroundColor: zc }} />
          <span style={{ ...styles.zoneText, color: zc }}>
            {vault.zone} ZONE  ·  {vault.silenceDays.toFixed(1)} days silent
          </span>
        </div>

        {/* Addresses */}
        <div style={styles.section}>
          <p style={styles.label}>VAULT ADDRESS</p>
          <p style={styles.mono}>{vault.vaultAddress}</p>
        </div>

        <div style={styles.section}>
          <p style={styles.label}>OWNER ADDRESS</p>
          <p style={styles.mono}>{vault.ownerAddress}</p>
        </div>

        {/* Inactivity stats */}
        <div style={styles.card}>
          <p style={styles.cardTitle}>INACTIVITY</p>
          <div style={styles.row}>
            <Stat label="Silence"      value={`${vault.silenceDays.toFixed(1)} days`} />
            <Stat label="Avg interval" value={vault.historicalAvgDays > 0 ? `${vault.historicalAvgDays.toFixed(1)} days` : '—'} />
            <Stat label="Threshold"    value={`${thresholdDays} days`} />
          </div>
          <div style={styles.row}>
            <Stat label="Last check-in" value={lastCheckInDate} />
            <Stat label="Check-ins"     value={vault.checkinCount} />
            <Stat label="Shielded"      value={vault.isShielded ? 'Yes' : 'No'} />
          </div>
        </div>

        {/* Guardian config */}
        <div style={styles.card}>
          <p style={styles.cardTitle}>GUARDIAN CONFIG</p>
          <div style={styles.row}>
            <Stat label="Guardians" value={String(vault.guardianCount)} />
            <Stat label="Threshold" value={`${vault.mOfNThreshold}-of-${vault.guardianCount}`} />
          </div>
        </div>

        {/* Status flags */}
        <div style={styles.card}>
          <p style={styles.cardTitle}>STATUS FLAGS</p>
          <FlagRow label="75% warning sent"  active={vault.warning75Sent}    color={Colors.YELLOW}   />
          <FlagRow label="90% warning sent"  active={vault.warning90Sent}    color={Colors.ORANGE}   />
          <FlagRow label="Anomaly flagged"    active={vault.anomalyFlagged}   color={Colors.CRITICAL} />
          <FlagRow label="Trigger signalled"  active={vault.triggerSignalled} color={Colors.RED}      />
        </div>

        {/* CTA buttons */}
        <button
          style={styles.btnPrimary}
          onClick={() => navigate('/risk-brief', { state: { vault } })}
        >
          View QVAC Risk Brief
        </button>

        <button
          style={styles.btnSecondary}
          onClick={() => navigate('/sign-covenant', { state: { vault } })}
        >
          Sign Covenant
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ ...Typography.label, fontSize: '9px' }}>{label}</span>
      <span style={Typography.body}>{value}</span>
    </div>
  );
}

function FlagRow({ label, active, color }: { label: string; active: boolean; color: string }) {
  return (
    <div style={{
      display:        'flex',
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            Spacing.sm,
      paddingTop:     Spacing.xs,
      paddingBottom:  Spacing.xs,
    }}>
      <div style={{
        width:        '8px',
        height:       '8px',
        borderRadius: '4px',
        backgroundColor: active ? color : Colors.border,
        flexShrink:   0,
      }} />
      <span style={{ ...Typography.body, color: active ? color : Colors.textMuted, flex: 1 }}>
        {label}
      </span>
      <span style={{ ...Typography.bodySmall, color: active ? color : Colors.textDim }}>
        {active ? 'ACTIVE' : 'clear'}
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
  },
  scroll: {
    padding:       Spacing.lg,
    display:       'flex',
    flexDirection: 'column',
    gap:           Spacing.md,
  },
  zoneBanner: {
    display:       'flex',
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    borderRadius:  `${Radius.md}px`,
    padding:       Spacing.md,
  },
  zoneDot: {
    width:        '10px',
    height:       '10px',
    borderRadius: '5px',
    flexShrink:   0,
  },
  zoneText: {
    ...Typography.heading3,
    margin: 0,
  },
  section: {
    display:       'flex',
    flexDirection: 'column',
    gap:           Spacing.xs,
  },
  label: {
    ...Typography.label,
    margin: 0,
  },
  mono: {
    ...Typography.mono,
    fontSize:  '11px',
    color:     Colors.textPrimary,
    margin:    0,
    wordBreak: 'break-all',
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
  cardTitle: {
    ...Typography.label,
    margin:       0,
    marginBottom: Spacing.xs,
  },
  row: {
    display:       'flex',
    flexDirection: 'row',
    gap:           Spacing.md,
  },
  btnPrimary: {
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
  btnSecondary: {
    backgroundColor: Colors.surface,
    borderRadius:    `${Radius.md}px`,
    border:          `1px solid ${Colors.border}`,
    padding:         Spacing.md,
    textAlign:       'center',
    color:           Colors.textPrimary,
    fontSize:        '16px',
    fontWeight:      '600',
    cursor:          'pointer',
    width:           '100%',
  },
};

// guardian-app/src/screens/GuardianDashboard.tsx
//
// Main dashboard screen showing all vaults the guardian monitors.
// Fetches vault data from the watcher, sorts by urgency, renders vault cards.
// Converted from React Native to HTML/CSS for Tauri webview.

import { useNavigate }    from 'react-router-dom';
import { useVaultData }   from '../hooks/useVaultData';
import { VaultCard }      from '../components/VaultCard';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { Colors, Typography, Spacing } from '../theme';
import type { VaultSummary } from '../hooks/useVaultData';

export function GuardianDashboard() {
  const { vaults, loading, error, lastFetch, refetch } = useVaultData();
  const navigate = useNavigate();

  const handleVaultPress = (vault: VaultSummary) => {
    navigate('/vault', { state: { vault } });
  };

  if (loading && vaults.length === 0) {
    return <LoadingOverlay message="Loading vaults…" />;
  }

  return (
    <div style={styles.safe}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Guardian</h1>
        <p style={styles.subtitle}>
          {vaults.length} vault{vaults.length !== 1 ? 's' : ''} monitored
          {lastFetch ? `  ·  ${lastFetch.toLocaleTimeString()}` : ''}
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div style={styles.errorBanner}>
          <p style={styles.errorText}>⚠ {error}</p>
        </div>
      )}

      {/* Vault list or empty state */}
      {vaults.length === 0 && !loading ? (
        <div style={styles.empty}>
          <p style={styles.emptyText}>No vaults found.</p>
          <p style={styles.emptySubtext}>
            Ensure the watcher is running and your guardian key is registered.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {vaults.map(vault => (
            <VaultCard
              key={vault.vaultAddress}
              vault={vault}
              onPress={handleVaultPress}
            />
          ))}

          <button
            style={styles.refreshBtn}
            onClick={refetch}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  safe: {
    backgroundColor: Colors.background,
    minHeight:       '100vh',
  },
  header: {
    paddingLeft:   Spacing.lg,
    paddingRight:  Spacing.lg,
    paddingTop:    Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottom:  `1px solid ${Colors.border}`,
  },
  title: {
    ...Typography.heading1,
    margin: 0,
  },
  subtitle: {
    ...Typography.bodySmall,
    marginTop: Spacing.xs,
    marginBottom: 0,
  },
  errorBanner: {
    margin:          Spacing.md,
    padding:         Spacing.md,
    backgroundColor: Colors.CRITICAL + '22',
    borderRadius:    '8px',
    border:          `1px solid ${Colors.CRITICAL}`,
  },
  errorText: {
    ...Typography.bodySmall,
    color:  Colors.CRITICAL,
    margin: 0,
  },
  list: {
    padding: Spacing.md,
  },
  empty: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        Spacing.xl,
    minHeight:      '60vh',
  },
  emptyText: {
    ...Typography.heading3,
    marginBottom: Spacing.sm,
  },
  emptySubtext: {
    ...Typography.bodySmall,
    textAlign: 'center',
  },
  refreshBtn: {
    marginTop:       Spacing.md,
    padding:         `${Spacing.sm}px ${Spacing.lg}px`,
    backgroundColor: Colors.surface,
    border:          `1px solid ${Colors.border}`,
    borderRadius:    '8px',
    color:           Colors.accent,
    cursor:          'pointer',
    fontSize:        '14px',
    width:           '100%',
  },
};

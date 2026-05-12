// guardian-app/src/App.tsx
//
// Root component for the Tauri Guardian app.
// Waits for both sidecars (signing-service + qvac-sidecar) to be ready
// before rendering the navigator.
// Sidecars are spawned by the Rust backend in src-tauri/src/lib.rs on startup.

import { useEffect, useState } from 'react';
import { AppNavigator }        from './navigation/AppNavigator';
import { waitForSidecars }     from './lib/sidecar-boot';
import { Colors }              from './theme';

type BootState = 'booting' | 'ready' | 'error';

export default function App() {
  const [bootState, setBootState] = useState<BootState>('booting');
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    waitForSidecars()
      .then(() => setBootState('ready'))
      .catch((err: unknown) => {
        setBootError(err instanceof Error ? err.message : String(err));
        setBootState('error');
      });
  }, []);

  if (bootState === 'booting') {
    return (
      <div style={styles.boot}>
        <div style={styles.spinner} />
        <p style={styles.bootText}>Starting Guardian…</p>
        <p style={styles.privacyNote}>
          🔒 All services run locally on your device.
        </p>
      </div>
    );
  }

  if (bootState === 'error') {
    return (
      <div style={styles.boot}>
        <p style={styles.errorTitle}>Startup failed</p>
        <p style={styles.errorText}>{bootError}</p>
      </div>
    );
  }

  return <AppNavigator />;
}

const styles: Record<string, React.CSSProperties> = {
  boot: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    height:         '100vh',
    backgroundColor: Colors.background,
    gap:            '16px',
    padding:        '32px',
    boxSizing:      'border-box',
  },
  spinner: {
    width:          '40px',
    height:         '40px',
    borderRadius:   '50%',
    border:         `3px solid ${Colors.border}`,
    borderTopColor: Colors.accent,
    animation:      'spin 0.8s linear infinite',
  },
  bootText: {
    fontSize: '14px',
    color:    Colors.textPrimary,
    margin:   0,
  },
  privacyNote: {
    fontSize:  '12px',
    color:     Colors.textMuted,
    textAlign: 'center',
    maxWidth:  '240px',
    margin:    0,
  },
  errorTitle: {
    fontSize:   '20px',
    fontWeight: '700',
    color:      Colors.CRITICAL,
    margin:     0,
  },
  errorText: {
    fontSize:  '12px',
    color:     Colors.textPrimary,
    textAlign: 'center',
    margin:    0,
  },
};

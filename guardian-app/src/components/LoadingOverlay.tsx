// guardian-app/src/components/LoadingOverlay.tsx
//
// Full-screen loading overlay with optional message text.
// Converted from React Native to HTML/CSS for Tauri webview.

import { Colors, Typography, Spacing } from '../theme';

interface Props {
  message?: string;
}

export function LoadingOverlay({ message }: Props) {
  return (
    <div style={styles.container}>
      <div style={styles.spinner} />
      {message && <p style={styles.message}>{message}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display:         'flex',
    flexDirection:   'column',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: Colors.background,
    minHeight:       '100vh',
    gap:             Spacing.md,
  },
  spinner: {
    width:          '40px',
    height:         '40px',
    borderRadius:   '50%',
    border:         `3px solid ${Colors.border}`,
    borderTopColor: Colors.accent,
    animation:      'spin 0.8s linear infinite',
  },
  message: {
    ...Typography.bodySmall,
    textAlign: 'center',
    maxWidth:  '240px',
    margin:    0,
  },
};

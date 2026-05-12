// guardian-app/src/screens/SignCovenant.tsx
//
// Covenant signing screen. Manages Shamir shares, scans the Cloak shielded
// pool, and executes the inheritance transfer via the signing-service sidecar.
// Converted from React Native to HTML/CSS for Tauri webview.
//
// Security invariants fully preserved from the Expo version:
//   walletKeyRef holds the private key in a mutable ref — NOT in React state.
//   Key is never captured in the component state tree or DevTools snapshots.
//   Key is zeroed in the finally block of executeTransfer() on every code path.
//   No private key appears in logs, state, or UI.
//   All Cloak calls go through cloak-bridge.ts → signing-service sidecar HTTP.
//   keyClearCounter forces the password input to remount and visually clear.

import { useState, useRef }           from 'react';
import { useNavigate, useLocation }   from 'react-router-dom';
import { LoadingOverlay }             from '../components/LoadingOverlay';
import { Colors, Typography, Spacing, Radius } from '../theme';
import { connectionUrl }              from '../lib/sdk';
import {
  scanOwnerUtxos,
  reconstructAndTransfer,
  testReconstruction,
}                                     from '../lib/cloak-bridge';
import type { GuardianShare }         from '../lib/cloak-bridge';
import type { VaultSummary }          from '../hooks/useVaultData';

type Phase = 'entry' | 'scanning' | 'confirm' | 'executing' | 'done' | 'error';

export function SignCovenant() {
  const navigate = useNavigate();
  const location = useLocation();
  const vault    = location.state?.vault as VaultSummary | undefined;

  const [phase,            setPhase]        = useState<Phase>('entry');
  const [shareInput,       setShareInput]   = useState('');
  const [additionalShares, setAdditional]   = useState<string[]>(['']);
  const [statusMessage,    setStatus]       = useState('');
  const [errorMessage,     setErrorMessage] = useState('');
  const [scanResult,       setScanResult]   = useState<{
    vaultUtxos:  unknown[];
    totalAmount: bigint;
  } | null>(null);

  // The guardian wallet private key (base58) is held in a mutable ref —
  // NOT in React state — so it never appears in the component state tree,
  // React DevTools snapshots, or memory dumps of the state tree.
  // It is sent to the signing-service sidecar and cleared in the finally
  // block of executeTransfer() covering every code path.
  // keyClearCounter forces the uncontrolled password input to remount
  // and visually clear after each use without holding the key in state.
  const walletKeyRef                          = useRef('');
  const [keyClearCounter, setKeyClearCounter] = useState(0);

  if (!vault) {
    navigate('/');
    return null;
  }

  const handleAddShareField = () => {
    setAdditional(prev => [...prev, '']);
  };

  const handleShareChange = (index: number, value: string) => {
    setAdditional(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  function buildGuardianShares(): GuardianShare[] {
    const allStrings = [
      shareInput.trim(),
      ...additionalShares.map(s => s.trim()).filter(Boolean),
    ].filter(Boolean);

    return allStrings.map((shareBase64, i) => ({
      shareIndex:     i + 1,
      shareBase64,
      guardianWallet: '',
    }));
  }

  const handleTestReconstruction = async () => {
    if (!shareInput.trim()) {
      alert('Enter your Shamir share first.');
      return;
    }

    const allShareStrings = [
      shareInput.trim(),
      ...additionalShares.map(s => s.trim()).filter(Boolean),
    ];

    if (allShareStrings.length < vault.mOfNThreshold) {
      setStatus(
        `Need at least ${vault.mOfNThreshold} shares to reconstruct. ` +
        `You have ${allShareStrings.length}.`,
      );
      return;
    }

    try {
      // Reconstruction happens inside the signing-service sidecar.
      // The reconstructed key is zeroed there — never exists in the JS heap.
      await testReconstruction({ shareStrings: allShareStrings });
      setStatus(
        `Reconstruction succeeded with ${allShareStrings.length} shares. Shares are consistent.`,
      );
    } catch (err) {
      alert(`Reconstruction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleScan = async () => {
    if (!shareInput.trim()) {
      alert('Enter your Shamir share before scanning.');
      return;
    }
    if (!walletKeyRef.current.trim()) {
      alert('Paste your guardian wallet private key (base58) to pay for the Cloak transfer.');
      return;
    }

    const shares = buildGuardianShares();
    if (shares.length < vault.mOfNThreshold) {
      alert(`Need at least ${vault.mOfNThreshold} shares. You have ${shares.length}.`);
      return;
    }

    setPhase('scanning');
    setStatus('Scanning shielded pool for vault UTXOs…');

    try {
      const result = await scanOwnerUtxos({ guardianShares: shares, connectionUrl });
      setScanResult(result);
      setStatus('');
      setPhase('confirm');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const handleExecute = () => {
    if (!scanResult) return;
    const confirmed = window.confirm(
      'This action is irreversible. Once submitted, the shielded transfer cannot be undone. Proceed?',
    );
    if (confirmed) void executeTransfer();
  };

  const executeTransfer = async () => {
    if (!scanResult) return;

    setPhase('executing');
    setStatus('Executing Cloak shielded transfer…');

    try {
      // The private key is passed to the signing-service sidecar over loopback.
      // The sidecar constructs the Keypair, signs, and zeroes it internally.
      // The key never exists as a Keypair object in the JS heap.
      await reconstructAndTransfer({
        guardianShares:           buildGuardianShares(),
        beneficiaryUtxoPubkeyHex: vault.beneficiary,
        vaultUtxos:               scanResult.vaultUtxos,
        totalAmount:              scanResult.totalAmount,
        relayerPrivateKeyBase58:  walletKeyRef.current.trim(),
        connectionUrl,
      });

      setStatus('Cloak shielded transfer submitted successfully.');
      setPhase('done');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      // Clear the private key ref regardless of outcome.
      // Force-remount the password input so it visually clears.
      walletKeyRef.current = '';
      setKeyClearCounter(c => c + 1);
    }
  };

  if (phase === 'scanning' || phase === 'executing') {
    return <LoadingOverlay message={statusMessage} />;
  }

  return (
    <div style={styles.safe}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate(-1)}>
          ← Risk Brief
        </button>
        <h3 style={styles.headerTitle}>Sign Covenant</h3>
        <div style={{ width: '80px' }} />
      </div>

      <div style={styles.scroll}>
        {/* Vault context */}
        <div style={styles.contextCard}>
          <p style={styles.label}>VAULT</p>
          <p style={styles.mono}>
            {vault.vaultAddress.slice(0, 12)}…{vault.vaultAddress.slice(-8)}
          </p>
          <p style={styles.meta}>
            Requires {vault.mOfNThreshold}-of-{vault.guardianCount} guardian signatures
          </p>
        </div>

        {/* Irreversible warning */}
        <div style={styles.warningCard}>
          <p style={styles.warningText}>
            ⚠ Executing inheritance is irreversible. The Cloak shielded transfer
            cannot be undone once submitted.
          </p>
        </div>

        {/* Scan result — shown in confirm phase */}
        {phase === 'confirm' && scanResult && (
          <div style={styles.scanResultCard}>
            <p style={styles.scanResultTitle}>UTXO SCAN COMPLETE</p>
            <p style={styles.scanResultBody}>
              Found {scanResult.vaultUtxos.length} UTXO
              {scanResult.vaultUtxos.length !== 1 ? 's' : ''} totalling{' '}
              {(Number(scanResult.totalAmount) / 1e9).toFixed(4)} SOL.
            </p>
            <p style={styles.scanResultNote}>
              Cloak fee will be deducted. Confirm to execute the shielded transfer
              to the beneficiary.
            </p>
          </div>
        )}

        {/* Entry phase inputs */}
        {(phase === 'entry' || phase === 'confirm') && (
          <>
            <div style={styles.section}>
              <p style={styles.sectionLabel}>YOUR SHAMIR SHARE</p>
              <textarea
                style={styles.textarea}
                value={shareInput}
                onChange={e => setShareInput(e.target.value)}
                placeholder="Paste your base64 share here"
                rows={3}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <div style={styles.section}>
              <p style={styles.sectionLabel}>ADDITIONAL SHARES (for threshold)</p>
              {additionalShares.map((share, i) => (
                <input
                  key={i}
                  style={{ ...styles.input, marginTop: i > 0 ? Spacing.xs : 0 }}
                  value={share}
                  onChange={e => handleShareChange(i, e.target.value)}
                  placeholder={`Share ${i + 2}`}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              ))}
              <button style={styles.addShareBtn} onClick={handleAddShareField}>
                + Add share
              </button>
            </div>

            <div style={styles.section}>
              <p style={styles.sectionLabel}>GUARDIAN WALLET KEY (base58)</p>
              <p style={styles.sectionHint}>
                Your Solana wallet private key — used only to sign the Cloak
                transaction. Not stored in state.
              </p>
              <input
                key={keyClearCounter}
                style={styles.input}
                type="password"
                onChange={e => { walletKeyRef.current = e.target.value; }}
                placeholder="Paste your base58 private key"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </>
        )}

        {/* Status message */}
        {statusMessage && (
          <div style={styles.statusBox}>
            <p style={styles.statusText}>{statusMessage}</p>
          </div>
        )}

        {/* Done state */}
        {phase === 'done' && (
          <div style={styles.successBox}>
            <p style={styles.successText}>
              ✓ Inheritance transfer executed successfully.
            </p>
            <button style={styles.doneBtn} onClick={() => navigate('/')}>
              Return to Dashboard
            </button>
          </div>
        )}

        {/* Error state */}
        {phase === 'error' && (
          <div style={styles.errorBox}>
            <p style={styles.errorTitle}>Execution failed</p>
            <p style={styles.errorBody}>{errorMessage}</p>
            <button
              style={styles.retryBtn}
              onClick={() => {
                setPhase('entry');
                setErrorMessage('');
                setScanResult(null);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* Action buttons — entry phase */}
        {phase === 'entry' && (
          <div style={styles.actions}>
            <button
              style={styles.testBtn}
              onClick={() => void handleTestReconstruction()}
            >
              Test Reconstruction
            </button>
            <button
              style={styles.executeBtn}
              onClick={() => void handleScan()}
            >
              Scan & Confirm
            </button>
          </div>
        )}

        {/* Action buttons — confirm phase */}
        {phase === 'confirm' && scanResult && (
          <div style={styles.actions}>
            <button
              style={styles.testBtn}
              onClick={() => { setScanResult(null); setPhase('entry'); }}
            >
              Back
            </button>
            <button style={styles.executeBtn} onClick={handleExecute}>
              Execute Inheritance
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  safe:            { backgroundColor: Colors.background, minHeight: '100vh' },
  header:          { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: Spacing.lg, paddingRight: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.md, borderBottom: `1px solid ${Colors.border}` },
  backBtn:         { background: 'none', border: 'none', color: Colors.accent, cursor: 'pointer', fontSize: '14px', padding: Spacing.xs, width: '80px' },
  headerTitle:     { ...Typography.heading3, margin: 0 },
  scroll:          { padding: Spacing.lg, display: 'flex', flexDirection: 'column', gap: Spacing.md },
  contextCard:     { backgroundColor: Colors.surface, borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.border}`, padding: Spacing.md, display: 'flex', flexDirection: 'column', gap: Spacing.xs },
  label:           { ...Typography.label, margin: 0 },
  mono:            { ...Typography.mono, fontSize: '11px', color: Colors.textPrimary, margin: 0, wordBreak: 'break-all' },
  meta:            { ...Typography.bodySmall, margin: 0 },
  warningCard:     { backgroundColor: Colors.CRITICAL + '11', borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.CRITICAL}`, padding: Spacing.md },
  warningText:     { ...Typography.body, color: Colors.CRITICAL, lineHeight: '20px', margin: 0 },
  scanResultCard:  { backgroundColor: Colors.GREEN + '11', borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.GREEN}`, padding: Spacing.md, display: 'flex', flexDirection: 'column', gap: Spacing.xs },
  scanResultTitle: { ...Typography.label, color: Colors.GREEN, margin: 0 },
  scanResultBody:  { ...Typography.body, color: Colors.textPrimary, margin: 0 },
  scanResultNote:  { ...Typography.bodySmall, color: Colors.textMuted, margin: 0 },
  section:         { display: 'flex', flexDirection: 'column', gap: Spacing.xs },
  sectionLabel:    { ...Typography.label, margin: 0 },
  sectionHint:     { ...Typography.bodySmall, color: Colors.textMuted, margin: 0 },
  textarea:        { backgroundColor: Colors.surface, borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.border}`, color: Colors.textPrimary, fontFamily: 'monospace', fontSize: '12px', padding: Spacing.md, width: '100%', boxSizing: 'border-box', resize: 'vertical' },
  input:           { backgroundColor: Colors.surface, borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.border}`, color: Colors.textPrimary, fontFamily: 'monospace', fontSize: '12px', padding: Spacing.md, width: '100%', boxSizing: 'border-box' },
  addShareBtn:     { alignSelf: 'flex-start', background: 'none', border: 'none', color: Colors.accent, cursor: 'pointer', fontSize: '14px', padding: Spacing.xs, marginTop: Spacing.xs },
  statusBox:       { backgroundColor: Colors.surface, borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.border}`, padding: Spacing.md },
  statusText:      { ...Typography.body, color: Colors.textMuted, margin: 0 },
  successBox:      { backgroundColor: Colors.GREEN + '18', borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.GREEN}`, padding: Spacing.md, display: 'flex', flexDirection: 'column', gap: Spacing.md, alignItems: 'center' },
  successText:     { ...Typography.body, color: Colors.GREEN, margin: 0 },
  doneBtn:         { backgroundColor: Colors.GREEN, borderRadius: `${Radius.md}px`, padding: `${Spacing.sm}px ${Spacing.lg}px`, border: 'none', color: Colors.background, fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  errorBox:        { backgroundColor: Colors.CRITICAL + '18', borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.CRITICAL}`, padding: Spacing.md, display: 'flex', flexDirection: 'column', gap: Spacing.sm },
  errorTitle:      { ...Typography.heading3, color: Colors.CRITICAL, margin: 0 },
  errorBody:       { ...Typography.bodySmall, color: Colors.CRITICAL, margin: 0 },
  retryBtn:        { alignSelf: 'flex-start', padding: Spacing.sm, borderRadius: `${Radius.sm}px`, border: `1px solid ${Colors.CRITICAL}`, background: 'none', color: Colors.CRITICAL, cursor: 'pointer', fontSize: '14px' },
  actions:         { display: 'flex', flexDirection: 'column', gap: Spacing.sm, marginTop: Spacing.sm },
  testBtn:         { backgroundColor: Colors.surface, borderRadius: `${Radius.md}px`, border: `1px solid ${Colors.border}`, padding: Spacing.md, textAlign: 'center', color: Colors.textPrimary, fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  executeBtn:      { backgroundColor: Colors.accent, borderRadius: `${Radius.md}px`, border: 'none', padding: Spacing.md, textAlign: 'center', color: Colors.background, fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
};

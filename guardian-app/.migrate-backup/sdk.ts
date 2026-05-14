// guardian-app/src/lib/sdk.ts
//
// Thin wrapper that initialises the Legacy Protocol SDK connection.
// Converted from Expo to Tauri: EXPO_PUBLIC_* → import.meta.env.VITE_*.
// Exports a shared Connection and connectionUrl for screens and cloak-bridge.
//
// The guardian app is read-only with respect to Solana — it needs only
// Connection from @solana/web3.js. @coral-xyz/anchor is NOT in this app's
// package.json and must never be imported.

import { Connection } from '@solana/web3.js';

const _rpcEndpoint = import.meta.env.VITE_SOLANA_RPC_ENDPOINT as string | undefined;

if (!_rpcEndpoint) {
  throw new Error(
    '[legacy-protocol] VITE_SOLANA_RPC_ENDPOINT is not set. ' +
    'Add it to your .env file before building the app.',
  );
}

export const connection    = new Connection(_rpcEndpoint, { commitment: 'confirmed' });

// Exported as a plain string for the signing-service sidecar.
// The sidecar constructs its own Connection instance —
// Connection objects cannot cross the HTTP boundary.
export const connectionUrl: string = connection.rpcEndpoint;


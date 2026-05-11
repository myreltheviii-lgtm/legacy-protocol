// guardian-app/src/lib/sdk.ts
//
// Thin wrapper that initialises the Legacy Protocol SDK connection for the
// guardian app. Exports a shared Connection so screens do not each create
// their own.
//
// The guardian app is read-only. It needs only `connection: Connection` from
// @solana/web3.js. @coral-xyz/anchor is NOT in this app's package.json and
// must never be imported — doing so would cause a Metro build failure.
// AnchorProvider and Program are not needed and must not exist in this file.

import { Connection } from "@solana/web3.js";

// Validate the required env var at module initialisation time.
// EXPO_PUBLIC_* vars are baked in by the Expo build toolchain — if this var
// is undefined the app was built without the required configuration, and a
// clear error surfaces here rather than a silent connection failure later.
const _rpcEndpoint = process.env.EXPO_PUBLIC_SOLANA_RPC_ENDPOINT;
if (!_rpcEndpoint) {
  throw new Error(
    "[legacy-protocol] EXPO_PUBLIC_SOLANA_RPC_ENDPOINT is not set. " +
    "Add it to your .env file (or EAS build environment) before building the app.",
  );
}

export const connection = new Connection(_rpcEndpoint, { commitment: "confirmed" });

// Exported as a plain string for the signing-service worklet.
// The worklet runs in Bare and constructs its own Connection instance —
// Connection objects cannot cross the IPC boundary.
export const connectionUrl: string = connection.rpcEndpoint;

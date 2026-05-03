// app/src/lib/sdk.ts
//
// Initialises the SDK connection singleton for use throughout the app.
// Components import `getConnection` and `PROGRAM_ID` from here rather than
// constructing their own Connection objects — a single connection is more
// efficient and allows the wallet adapter's connection context to be the
// sole authority for RPC calls in wallet-adapter-react contexts.

import { Connection, PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_LEGACY_VAULT_PROGRAM_ID ??
  "7h9BH7d9aHGuPubFc6s9GCYDwtWrFNGB8kKKKV8YaSAe",
);

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ??
  "https://api.mainnet-beta.solana.com";

// Singleton connection used outside of wallet-adapter-react contexts
// (e.g., Server Components, API routes).
let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(RPC_ENDPOINT, { commitment: "confirmed" });
  }
  return _connection;
}

/** Shortens a base58 pubkey for display: "AbCd…XyZ1". */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** Solana Explorer URL for a given address or transaction signature. */
export function explorerUrl(
  value: string,
  type: "address" | "tx" = "address",
): string {
  const cluster =
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet"
      ? "?cluster=devnet"
      : "";
  return `https://explorer.solana.com/${type}/${value}${cluster}`;
}
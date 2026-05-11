"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter }  from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
// RPC_ENDPOINT is the single source of truth for the endpoint used across
// the entire app — including the Connection singleton in lib/sdk.ts and the
// wallet-adapter ConnectionProvider here. Components must never declare their
// own RPC URL string; they import this export instead.
import { RPC_ENDPOINT } from "@/lib/sdk";

const WalletModalProvider = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then(m => m.WalletModalProvider),
  { ssr: false }
);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

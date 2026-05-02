// app/src/app/api/actions/claim/route.ts
//
// Solana Actions endpoint for claim_inheritance.
//
// GET  /api/actions/claim?vault=<address>
//   → Returns the action metadata so Blink-compatible wallets can render the
//     action card with the vault balance and beneficiary warning.
//
// POST /api/actions/claim?vault=<address>
//   Body: { account: "<base58 beneficiary pubkey>" }
//   → Returns a base64-encoded, unsigned transaction that the wallet signs
//     and submits. The transaction calls claim_inheritance on the vault.
//
// The caller (beneficiary's wallet) signs and submits the returned transaction.
// The endpoint never holds any private keys.
//
// Identity check: the POST handler verifies that `body.account` matches
// `vault.beneficiary` before building the transaction. The on-chain program
// enforces this anyway via has_one = beneficiary, but failing here produces
// a clear, actionable error message instead of a cryptic chain rejection that
// burns the caller's fee budget.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey, Transaction, Connection } from "@solana/web3.js";
import {
  fetchVault,
  buildClaimInheritanceIx,
  deriveActivityPda,
} from "@legacy-protocol/sdk";

const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_LEGACY_VAULT_PROGRAM_ID ??
  "LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ??
  "https://api.mainnet-beta.solana.com";

// Solana Actions CORS headers. Required by the Actions spec so wallets can
// call this endpoint from any origin.
const ACTIONS_CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Action-Version":             "2.1.3",
  "X-Blockchain-Ids":             "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

export async function OPTIONS() {
  return NextResponse.json(null, { headers: ACTIONS_CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const vaultAddress = searchParams.get("vault");

  if (!vaultAddress) {
    return NextResponse.json(
      { error: "Missing vault parameter" },
      { status: 400, headers: ACTIONS_CORS_HEADERS },
    );
  }

  try {
    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const vaultPk    = new PublicKey(vaultAddress);
    const vault      = await fetchVault(connection, PROGRAM_ID, vaultPk);

    if (!vault) {
      return NextResponse.json(
        { error: "Vault not found" },
        { status: 404, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const lamportsSol = Number(vault.depositedLamports) / 1e9;
    const isTriggered = vault.isTriggered;

    // Action metadata consumed by wallets to render the Blink card.
    const action = {
      type:        "action",
      icon:        `${req.nextUrl.origin}/icon.png`,
      title:       isTriggered
        ? `Claim ${lamportsSol.toFixed(4)} SOL from Legacy Vault`
        : "Legacy Vault — Not Yet Triggered",
      description: isTriggered
        ? `The inactivity threshold has been crossed. Claiming transfers ${lamportsSol.toFixed(4)} SOL to the beneficiary wallet.`
        : "This vault has not yet reached its inactivity threshold. Check back once the threshold is crossed.",
      label:       isTriggered ? "Claim Inheritance" : "Not claimable yet",
      disabled:    !isTriggered,
      links: {
        actions: isTriggered
          ? [
              {
                type:  "transaction",
                label: `Claim ${lamportsSol.toFixed(4)} SOL`,
                href:  `/api/actions/claim?vault=${vaultAddress}`,
              },
            ]
          : [],
      },
    };

    return NextResponse.json(action, { headers: ACTIONS_CORS_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Failed to load vault" },
      { status: 500, headers: ACTIONS_CORS_HEADERS },
    );
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const vaultAddress = searchParams.get("vault");

  if (!vaultAddress) {
    return NextResponse.json(
      { error: "Missing vault parameter" },
      { status: 400, headers: ACTIONS_CORS_HEADERS },
    );
  }

  let body: { account?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: ACTIONS_CORS_HEADERS },
    );
  }

  if (!body.account) {
    return NextResponse.json(
      { error: "Missing account field in body" },
      { status: 400, headers: ACTIONS_CORS_HEADERS },
    );
  }

  try {
    const connection    = new Connection(RPC_ENDPOINT, "confirmed");
    const vaultPk       = new PublicKey(vaultAddress);
    const beneficiaryPk = new PublicKey(body.account);
    const [actPda]      = deriveActivityPda(PROGRAM_ID, vaultPk);

    const vault = await fetchVault(connection, PROGRAM_ID, vaultPk);
    if (!vault) {
      return NextResponse.json(
        { error: "Vault not found" },
        { status: 404, headers: ACTIONS_CORS_HEADERS },
      );
    }
    if (!vault.isTriggered) {
      return NextResponse.json(
        { error: "Vault has not been triggered yet" },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }
    if (vault.isClaimed || vault.isEmergencySwept) {
      return NextResponse.json(
        { error: "Vault has already been claimed or swept" },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    // Verify the calling account is the designated beneficiary before building
    // the transaction. The on-chain has_one = beneficiary constraint would
    // reject the transaction anyway, but failing here gives the wallet a
    // descriptive error instead of a raw program error code, and saves the
    // caller from paying a fee for a transaction that can never succeed.
    if (vault.beneficiary !== beneficiaryPk.toBase58()) {
      return NextResponse.json(
        { error: "Connected wallet is not the beneficiary of this vault" },
        { status: 403, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const ix = buildClaimInheritanceIx({
      programId:   PROGRAM_ID,
      beneficiary: beneficiaryPk,
      vaultPda:    vaultPk,
      activityPda: actPda,
    });

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction();
    tx.recentBlockhash      = blockhash;
    tx.feePayer             = beneficiaryPk;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.add(ix);

    // Serialize the unsigned transaction. The wallet will sign it before submission.
    const serialized = tx.serialize({ requireAllSignatures: false });
    const base64      = serialized.toString("base64");

    return NextResponse.json(
      { transaction: base64, message: "Sign to claim your inheritance." },
      { headers: ACTIONS_CORS_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to build transaction" },
      { status: 500, headers: ACTIONS_CORS_HEADERS },
    );
  }
}
```


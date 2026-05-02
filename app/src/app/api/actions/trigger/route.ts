// app/src/app/api/actions/trigger/route.ts
//
// Solana Actions endpoint for trigger_inheritance.
//
// GET  /api/actions/trigger?vault=<address>
//   → Returns action metadata. Shows the deposited balance and whether the
//     vault is past threshold so wallets can render an accurate action card.
//
// POST /api/actions/trigger?vault=<address>
//   Body: { account: "<base58 caller pubkey>" }
//   → Returns a base64-encoded unsigned trigger_inheritance transaction.
//     trigger_inheritance is permissionless: any account can be the caller.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey, Transaction, Connection } from "@solana/web3.js";
import { fetchVault, buildTriggerInheritanceIx } from "@legacy-protocol/sdk";
import { computeInactivityScore } from "@legacy-protocol/sdk";

const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_LEGACY_VAULT_PROGRAM_ID ??
  "LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ??
  "https://api.mainnet-beta.solana.com";

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

    const [vault, currentSlot] = await Promise.all([
      fetchVault(connection, PROGRAM_ID, vaultPk),
      connection.getSlot("confirmed"),
    ]);

    if (!vault) {
      return NextResponse.json(
        { error: "Vault not found" },
        { status: 404, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const score = computeInactivityScore(
      BigInt(currentSlot),
      vault.lastCheckInSlot,
      vault.inactivityThresholdSlots,
    );

    const pastThreshold = score >= 100n;
    const lamportsSol   = Number(vault.depositedLamports) / 1e9;

    const action = {
      type:        "action",
      icon:        `${req.nextUrl.origin}/icon.png`,
      title:       pastThreshold
        ? `Trigger Inheritance — ${lamportsSol.toFixed(4)} SOL`
        : `Legacy Vault — ${score.toString()}% inactive`,
      description: pastThreshold
        ? `The inactivity threshold has been crossed. Anyone can trigger this vault to make ${lamportsSol.toFixed(4)} SOL claimable by the beneficiary. You pay only the transaction fee.`
        : `The owner has been inactive for ${score.toString()}% of their threshold. The vault cannot be triggered until 100% is reached.`,
      label:    pastThreshold ? "Trigger Inheritance" : "Not yet triggerable",
      disabled: !pastThreshold || vault.isTriggered,
      links: {
        actions: pastThreshold && !vault.isTriggered
          ? [
              {
                type:  "transaction",
                label: "Trigger Inheritance",
                href:  `/api/actions/trigger?vault=${vaultAddress}`,
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
    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const vaultPk    = new PublicKey(vaultAddress);
    const callerPk   = new PublicKey(body.account);

    const [vault, currentSlot] = await Promise.all([
      fetchVault(connection, PROGRAM_ID, vaultPk),
      connection.getSlot("confirmed"),
    ]);

    if (!vault) {
      return NextResponse.json(
        { error: "Vault not found" },
        { status: 404, headers: ACTIONS_CORS_HEADERS },
      );
    }

    if (vault.isTriggered) {
      return NextResponse.json(
        { error: "Vault is already triggered" },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const score = computeInactivityScore(
      BigInt(currentSlot),
      vault.lastCheckInSlot,
      vault.inactivityThresholdSlots,
    );

    if (score < 100n) {
      return NextResponse.json(
        { error: "Inactivity threshold has not been reached" },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const ix = buildTriggerInheritanceIx({
      programId: PROGRAM_ID,
      caller:    callerPk,
      vaultPda:  vaultPk,
    });

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction();
    tx.recentBlockhash      = blockhash;
    tx.feePayer             = callerPk;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.add(ix);

    const serialized = tx.serialize({ requireAllSignatures: false });
    const base64      = serialized.toString("base64");

    return NextResponse.json(
      { transaction: base64, message: "Sign to trigger this inheritance vault." },
      { headers: ACTIONS_CORS_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to build transaction" },
      { status: 500, headers: ACTIONS_CORS_HEADERS },
    );
  }
}


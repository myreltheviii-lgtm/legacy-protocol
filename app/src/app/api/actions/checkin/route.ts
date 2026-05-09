//
// Solana Actions endpoint for check_in.
//
// GET  /api/actions/checkin?vault=<address>
//   → Returns action metadata showing the current inactivity score so the
//     owner can see at a glance how urgent a check-in is.
//
// POST /api/actions/checkin?vault=<address>
//   Body: { account: "<base58 owner pubkey>" }
//   → Returns a base64-encoded unsigned check_in transaction.
//     The owner signs and submits from their wallet.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  fetchVault,
  buildCheckInIx,
  deriveActivityPda,
  computeInactivityScore,
} from "@legacy-protocol/sdk";
// PROGRAM_ID and RPC_ENDPOINT are the single source of truth for this app.
// They must never be re-declared or hardcoded in any file other than
// app/src/lib/sdk.ts. API routes import them from there.
import { PROGRAM_ID, getConnection } from "@/lib/sdk";

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
    const connection = getConnection();
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

    const action = {
      type:  "action",
      icon:  `${req.nextUrl.origin}/icon.png`,
      title: `Check In — Legacy Vault (${score.toString()}% inactive)`,
      description:
        vault.isTriggered
          ? "This vault has already been triggered. Check-in is no longer possible."
          : `Prove you are alive. Resets the inactivity clock to 0%. Currently at ${score.toString()}%.`,
      label:    "Check In",
      disabled: vault.isTriggered || vault.isEmergencySwept,
      links: {
        actions: !vault.isTriggered && !vault.isEmergencySwept
          ? [
              {
                type:  "transaction",
                label: "Check In Now",
                href:  `/api/actions/checkin?vault=${vaultAddress}`,
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
    const connection = getConnection();
    const vaultPk    = new PublicKey(vaultAddress);
    const ownerPk    = new PublicKey(body.account);
    const [actPda]   = deriveActivityPda(PROGRAM_ID, vaultPk);

    const vault = await fetchVault(connection, PROGRAM_ID, vaultPk);
    if (!vault) {
      return NextResponse.json(
        { error: "Vault not found" },
        { status: 404, headers: ACTIONS_CORS_HEADERS },
      );
    }

    if (vault.isTriggered || vault.isEmergencySwept) {
      return NextResponse.json(
        { error: "Vault is no longer active" },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    if (vault.owner !== ownerPk.toBase58()) {
      return NextResponse.json(
        { error: "Only the vault owner can check in" },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const ix = buildCheckInIx({
      programId:   PROGRAM_ID,
      owner:       ownerPk,
      vaultPda:    vaultPk,
      activityPda: actPda,
    });

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction();
    tx.recentBlockhash      = blockhash;
    tx.feePayer             = ownerPk;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.add(ix);

    const serialized = tx.serialize({ requireAllSignatures: false });
    const base64      = serialized.toString("base64");

    return NextResponse.json(
      { transaction: base64, message: "Sign to check in and reset your inactivity clock." },
      { headers: ACTIONS_CORS_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to build transaction" },
      { status: 500, headers: ACTIONS_CORS_HEADERS },
    );
  }
}

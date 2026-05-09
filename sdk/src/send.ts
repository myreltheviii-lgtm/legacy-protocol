// sdk/src/send.ts
//
// Transaction submission helper used throughout the app and relayer.

import {
  Connection,
  Transaction,
  TransactionInstruction,
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";

export interface WalletAdapter {
  publicKey:       PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

export interface SendResult {
  signature: string;
}

/**
 * Builds, signs, and confirms a transaction containing the given instructions.
 * Adds compute budget instructions for reliability on congested networks.
 */
export async function sendAndConfirmLegacyTx(
  connection:  Connection,
  wallet:      WalletAdapter,
  instructions: TransactionInstruction[],
  opts?: { computeUnits?: number; microLamportsFee?: number },
): Promise<SendResult> {
  const { publicKey, signTransaction } = wallet;

  const computeUnits    = opts?.computeUnits    ?? 200_000;
  const microLamportsFee = opts?.microLamportsFee ?? 5_000;

  const budgetIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: microLamportsFee }),
  ];

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.add(...budgetIxs, ...instructions);
  tx.recentBlockhash = blockhash;
  tx.feePayer        = publicKey;

  const signed = await signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight:       false,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return { signature };
}

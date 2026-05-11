// sdk/src/fetch.ts
//
// On-chain account fetching utilities.

import { Connection, PublicKey } from "@solana/web3.js";
import type { VaultAccount, ActivityAccount, GuardianAccount, CovenantAccount } from "./types";
import {
  deserialiseVault,
  deserialiseActivity,
  deserialiseGuardian,
  deserialiseCovenantFromBuffer,
  VAULT_SIZE,
} from "./accounts";

export async function fetchVaultAccount(
  connection: Connection,
  vaultPda:   PublicKey,
): Promise<VaultAccount | null> {
  const info = await connection.getAccountInfo(vaultPda, "confirmed");
  if (!info) return null;
  return deserialiseVault(Buffer.from(info.data));
}

export async function fetchActivityAccount(
  connection:  Connection,
  activityPda: PublicKey,
): Promise<ActivityAccount | null> {
  const info = await connection.getAccountInfo(activityPda, "confirmed");
  if (!info) return null;
  return deserialiseActivity(Buffer.from(info.data));
}

export async function fetchGuardianAccount(
  connection:         Connection,
  guardianAccountPda: PublicKey,
): Promise<GuardianAccount | null> {
  const info = await connection.getAccountInfo(guardianAccountPda, "confirmed");
  if (!info) return null;
  return deserialiseGuardian(Buffer.from(info.data));
}

export async function fetchAllCovenantsForVault(
  connection: Connection,
  programId:  PublicKey,
  vaultPda:   PublicKey,
): Promise<Array<{ publicKey: string; account: CovenantAccount }>> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
    ],
  });

  const results: Array<{ publicKey: string; account: CovenantAccount }> = [];
  for (const { pubkey, account } of accounts) {
    const parsed = deserialiseCovenantFromBuffer(Buffer.from(account.data));
    if (parsed && parsed.vault === vaultPda.toBase58()) {
      results.push({ publicKey: pubkey.toBase58(), account: parsed });
    }
  }
  return results;
}

export async function fetchAllVaultsForBeneficiary(
  connection:  Connection,
  programId:   PublicKey,
  beneficiary: PublicKey,
): Promise<Array<{ publicKey: string; account: VaultAccount }>> {
  // beneficiary_utxo_pubkey is at offset 40 in the vault account.
  // For non-shielded vaults, these bytes = the Solana pubkey bytes.
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: VAULT_SIZE },
      { memcmp: { offset: 40, bytes: beneficiary.toBase58() } },
    ],
  });

  const results: Array<{ publicKey: string; account: VaultAccount }> = [];
  for (const { pubkey, account } of accounts) {
    const parsed = deserialiseVault(Buffer.from(account.data));
    if (parsed) results.push({ publicKey: pubkey.toBase58(), account: parsed });
  }
  return results;
}

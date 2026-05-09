// watcher/src/signing_pool.ts
//
// The SigningPool manages the set of guardian keypairs the watcher uses to
// submit on-chain transactions (anomaly_flag). These keypairs have zero
// authority over vault funds — they only pay transaction fees.
//
// Security model: even if these keys are compromised, an attacker cannot
// redirect funds or trigger inheritance. They can only call anomaly_flag,
// which sets a boolean on the ActivityAccount.

import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { logger } from "./logger";

let _pool: SigningPool | null = null;

export function initSigningPool(guardianSecretKeys: string[]): SigningPool {
  _pool = new SigningPool(guardianSecretKeys);
  return _pool;
}

export function getSigningPool(): SigningPool {
  if (!_pool) {
    throw new Error(
      "SigningPool has not been initialised. Call initSigningPool() first.",
    );
  }
  return _pool;
}

export class SigningPool {
  private keypairs:         Map<string, Keypair>;
  private vaultGuardianMap: Map<string, string>;

  constructor(secretKeys: string[]) {
    this.keypairs         = new Map();
    this.vaultGuardianMap = new Map();

    for (const secretKeyB58 of secretKeys) {
      try {
        const secretKey = bs58.decode(secretKeyB58);
        const keypair   = Keypair.fromSecretKey(secretKey);
        this.keypairs.set(keypair.publicKey.toBase58(), keypair);
        logger.info(
          { pubkey: keypair.publicKey.toBase58() },
          "Guardian keypair loaded into signing pool",
        );
      } catch (err) {
        logger.error({ err }, "Failed to load guardian keypair — skipping");
      }
    }

    if (this.keypairs.size === 0) {
      logger.warn(
        "Signing pool is empty — anomaly_flag transactions cannot be submitted",
      );
    }
  }

  /**
   * Returns the Keypair to use for a specific vault. Returns null if no
   * guardian keypair is available. Falls back to the first available keypair
   * for single-guardian setups.
   */
  getGuardianForVault(vaultAddress: string): Keypair | null {
    const mappedPubkey = this.vaultGuardianMap.get(vaultAddress);
    if (mappedPubkey) {
      return this.keypairs.get(mappedPubkey) ?? null;
    }
    const first = this.keypairs.values().next().value;
    return first ?? null;
  }

  setGuardianForVault(vaultAddress: string, guardianPubkey: string): void {
    if (!this.keypairs.has(guardianPubkey)) {
      throw new Error(
        `Guardian pubkey ${guardianPubkey} is not in the signing pool`,
      );
    }
    this.vaultGuardianMap.set(vaultAddress, guardianPubkey);
  }

  getPublicKeys(): string[] {
    return Array.from(this.keypairs.keys());
  }

  get size(): number {
    return this.keypairs.size;
  }
}

// watcher/src/alerts/guardian_ping.ts
//
// Fires when a vault crosses 75% of its inactivity threshold. The purpose
// of this alert is to give the guardian network early warning so they can
// attempt to reach the owner through off-chain channels (phone, email,
// in-person) before the vault fully triggers.
//
// The "ping" is an in-process event emitted on guardianAlertBus. This
// serves two purposes:
//   1. It provides a durable audit record (the DB flag is written first).
//   2. It allows the delivery layer (email/SMS/push) to receive the event
//      without the core watcher needing to know about notification providers.
//
// Note: The actual guardian outreach (SMS, email) is an off-chain concern
// handled by the alert delivery layer, which consumes the events this module
// emits. This module only handles the in-process signalling.

import { Connection, PublicKey } from "@solana/web3.js";
import { Program }               from "@coral-xyz/anchor";
import { LegacyVault }           from "../types/legacy_vault";
import { VaultRecord }           from "../types/watcher";
import {
  VaultInactivityState,
  estimateSecondsToTrigger,
  WARNING_SLOT_PCT_75,
} from "../monitor/block_counter";
import { getStore }              from "../db/store";
import { logger }                from "../logger";
import { EventEmitter }          from "events";

// ── Module-level event emitter ────────────────────────────────────────────────
// The delivery layer (email/SMS/push) subscribes to these events.
// This decouples the watcher core from specific notification providers.
//
// setMaxListeners(0) disables the Node.js default limit of 10 listeners per
// event. The delivery layer may attach multiple integrations (email, SMS, push,
// monitoring hooks) — each registers its own listener. The default limit would
// emit MaxListenersExceededWarning to stderr, which pollutes structured log
// monitoring and can be misinterpreted as a memory leak alarm. A production
// watcher has a bounded, known number of delivery integrations: 0 is the
// correct setting (unlimited) rather than raising the cap to an arbitrary value.

export const guardianAlertBus = new EventEmitter();
guardianAlertBus.setMaxListeners(0);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GuardianPingResult {
  vaultAddress: string;
  /** True if the ping was sent this cycle (i.e., first time crossing 75%). */
  pingSent: boolean;
  /** True if the ping was already sent in a prior cycle. */
  alreadySent: boolean;
  /** True if the vault has not yet reached 75%. */
  notReached: boolean;
  error?: string;
}

export interface GuardianPingEvent {
  vaultAddress:              string;
  ownerAddress:              string;
  beneficiaryAddress:        string;
  guardianAddresses:         string[];
  inactivityScorePct:        string;
  elapsedSlots:              string;
  triggerSlot:               string;
  estimatedSecondsToTrigger: number;
  pingSlot:                  string;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Evaluates all vaults and sends guardian pings for those that have crossed
 * the 75% inactivity threshold for the first time in this monitoring session.
 */
export async function sendGuardianPingsForEligibleVaults(
  connection: Connection,
  program: Program<LegacyVault>,
  vaults: VaultRecord[],
  states: VaultInactivityState[],
): Promise<GuardianPingResult[]> {
  const stateMap = new Map<string, VaultInactivityState>(
    states.map((s) => [s.vaultAddress, s]),
  );

  const results = await Promise.allSettled(
    vaults.map((vault) => {
      const state = stateMap.get(vault.vaultAddress);
      if (!state) {
        return Promise.resolve<GuardianPingResult>({
          vaultAddress: vault.vaultAddress,
          pingSent:     false,
          alreadySent:  false,
          notReached:   true,
        });
      }
      return evaluateAndPing(connection, program, vault, state);
    }),
  );

  return results.map((r, i) => {
    if (r.status === "rejected") {
      return {
        vaultAddress: vaults[i].vaultAddress,
        pingSent:     false,
        alreadySent:  false,
        notReached:   false,
        error:        String(r.reason),
      };
    }
    return r.value;
  });
}

// ── Single vault evaluation ───────────────────────────────────────────────────

async function evaluateAndPing(
  connection: Connection,
  program: Program<LegacyVault>,
  vault: VaultRecord,
  state: VaultInactivityState,
): Promise<GuardianPingResult> {
  // Score must be at or above the 75% zone boundary. The threshold is imported
  // from block_counter.ts so both the classifier and this guard use the same
  // constant — a single source of truth that tracks constants.rs.
  if (state.score < WARNING_SLOT_PCT_75) {
    return { vaultAddress: vault.vaultAddress, pingSent: false, alreadySent: false, notReached: true };
  }

  // The on-chain state tracks whether the warning has been sent. We respect
  // the on-chain flag as the authoritative source of truth rather than our
  // local DB alone — this prevents double-pinging if the watcher restarts.
  if (state.warning75AlreadySent || vault.warning75Sent) {
    return { vaultAddress: vault.vaultAddress, pingSent: false, alreadySent: true, notReached: false };
  }

  logger.warn(
    {
      vault:        vault.vaultAddress,
      score:        state.score.toString(),
      elapsedSlots: state.elapsedSlots.toString(),
      triggerSlot:  state.triggerSlot.toString(),
    },
    "Vault crossed 75% inactivity threshold — sending guardian ping",
  );

  try {
    // Fetch guardian addresses for this vault to include in the event payload.
    const guardianAddresses = await fetchGuardianAddresses(program, vault);

    // Build the event payload for the delivery layer.
    const pingEvent: GuardianPingEvent = {
      vaultAddress:              vault.vaultAddress,
      ownerAddress:              vault.ownerAddress,
      beneficiaryAddress:        vault.beneficiary,
      guardianAddresses,
      inactivityScorePct:        state.score.toString(),
      elapsedSlots:              state.elapsedSlots.toString(),
      triggerSlot:               state.triggerSlot.toString(),
      estimatedSecondsToTrigger: estimateSecondsToTrigger(
        state.computedAtSlot,
        state.triggerSlot,
      ),
      pingSlot: state.computedAtSlot.toString(),
    };

    // Write the DB flag BEFORE emitting the event. This ordering ensures that
    // if the process restarts after the DB write but before the emit, the flag
    // prevents re-emission on the next cycle. The inverse ordering (emit first,
    // then write DB) risks a crash window where the event fires but the DB flag
    // is never set, causing a duplicate notification on every subsequent restart.
    // EventEmitter.emit() is synchronous — listeners run to completion before
    // the next line executes — so the DB write happens before any downstream
    // delivery work begins.
    getStore().setWarning75Sent(vault.vaultAddress, true);

    // Emit the event for the delivery layer (email/SMS/push integrations).
    guardianAlertBus.emit("guardian_ping", pingEvent);

    logger.info(
      {
        vault:     vault.vaultAddress,
        guardians: guardianAddresses.length,
      },
      "Guardian ping event emitted",
    );

    return { vaultAddress: vault.vaultAddress, pingSent: true, alreadySent: false, notReached: false };
  } catch (err) {
    logger.error({ vault: vault.vaultAddress, err }, "Guardian ping failed");
    return {
      vaultAddress: vault.vaultAddress,
      pingSent:     false,
      alreadySent:  false,
      notReached:   false,
      error:        String(err),
    };
  }
}

// ── Guardian address resolution ───────────────────────────────────────────────

/**
 * Fetches all active guardian pubkeys for a vault by scanning for guardian
 * PDA accounts. The program's getProgramAccounts filter is scoped to accounts
 * that encode the vault pubkey at the expected byte offset in the guardian
 * account layout.
 *
 * Byte offset breakdown (GuardianAccount discriminator + vault field):
 *   0–7:   Anchor discriminator (8 bytes)
 *   8–39:  vault: Pubkey (32 bytes)
 *   40–71: guardian: Pubkey (32 bytes)  ← what we want
 *   72:    is_active: bool (1 byte)
 */
async function fetchGuardianAddresses(
  program: Program<LegacyVault>,
  vault: VaultRecord,
): Promise<string[]> {
  try {
    const vaultPubkey = new PublicKey(vault.vaultAddress);

    // Filter accounts by: program-owned + vault pubkey at offset 8.
    const accounts = await program.account.guardianAccount.all([
      {
        memcmp: {
          offset: 8, // skip the 8-byte Anchor discriminator
          bytes:  vaultPubkey.toBase58(),
        },
      },
    ]);

    return accounts
      .filter((a) => (a.account as any).isActive)
      .map((a) => (a.account as any).guardian.toBase58());
  } catch (err) {
    logger.error(
      { vault: vault.vaultAddress, err },
      "Failed to fetch guardian addresses — using empty list",
    );
    return [];
  }
}
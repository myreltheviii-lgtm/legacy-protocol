// watcher/src/alerts/beneficiary_warn.ts
//
// Fires when a vault crosses 90% of its inactivity threshold. At this point
// the situation is critical: the owner has been silent for almost the full
// configured period. The beneficiary is notified so they can:
//
//   a) Attempt to reach the owner through personal channels.
//   b) Prepare their wallet to call claim_inheritance if the vault triggers.
//   c) Alert guardians to consider opening an EmergencySweep covenant if
//      they suspect the owner is in danger.
//
// Like guardian_ping.ts, this module emits an in-process event for the
// delivery layer and marks the warning in the local database. The on-chain
// warning_90_sent flag is read during vault reconciliation to prevent
// duplicate alerts across watcher restarts.

import { Connection }               from "@solana/web3.js";
import { Program }                  from "@coral-xyz/anchor";
import { LegacyVault }              from "../types/legacy_vault";
import { VaultRecord }              from "../types/watcher";
import {
  VaultInactivityState,
  estimateSecondsToTrigger,
  WARNING_SLOT_PCT_90,
} from "../monitor/block_counter";
import { getStore }                 from "../db/store";
import { logger }                   from "../logger";
import { EventEmitter }             from "events";

// ── Module-level event emitter ────────────────────────────────────────────────
// Delivery integrations (push notifications, email, SMS) subscribe to this bus.
//
// setMaxListeners(0) disables the Node.js default limit of 10 listeners per
// event. The delivery layer may attach multiple integrations (email, SMS, push,
// monitoring hooks) — each registers its own listener. The default limit would
// emit MaxListenersExceededWarning to stderr, which pollutes structured log
// monitoring and can be misinterpreted as a memory leak alarm. A production
// watcher has a bounded, known number of delivery integrations: 0 is the
// correct setting (unlimited) rather than raising the cap to an arbitrary value.

export const beneficiaryAlertBus = new EventEmitter();
beneficiaryAlertBus.setMaxListeners(0);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BeneficiaryWarnResult {
  vaultAddress: string;
  warnSent:     boolean;
  alreadySent:  boolean;
  notReached:   boolean;
  error?:       string;
}

/**
 * The payload emitted on the beneficiaryAlertBus when a 90% warning fires.
 * Delivery integrations consume this event and route it to the appropriate
 * notification channel (push, email, SMS).
 */
export interface BeneficiaryWarnEvent {
  vaultAddress:              string;
  ownerAddress:              string;
  beneficiaryAddress:        string;
  inactivityScorePct:        string;
  elapsedSlots:              string;
  triggerSlot:               string;
  /** Approximate wall-clock seconds until the vault becomes claimable. */
  estimatedSecondsToTrigger: number;
  depositedLamports:         string;
  warnSlot:                  string;
  /**
   * The Solana Blink URL the beneficiary can click to call claim_inheritance
   * once the vault is triggered. Constructed here so the delivery layer does
   * not need to know about PDA derivation or Blink URL format.
   *
   * Fix: the path must be /api/actions/claim (the Next.js app's Solana Actions
   * endpoint) rather than /claim (which is the UI page and does not respond to
   * the Blink protocol's GET/POST workflow wallets expect).
   */
  claimBlinkUrl:             string;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Evaluates all vaults and sends beneficiary warnings for those that have
 * crossed the 90% inactivity threshold for the first time.
 */
export async function sendBeneficiaryWarningsForEligibleVaults(
  connection: Connection,
  program: Program<any>,
  vaults: VaultRecord[],
  states: VaultInactivityState[],
  blinkBaseUrl: string,
): Promise<BeneficiaryWarnResult[]> {
  const stateMap = new Map<string, VaultInactivityState>(
    states.map((s) => [s.vaultAddress, s]),
  );

  const results = await Promise.allSettled(
    vaults.map((vault) => {
      const state = stateMap.get(vault.vaultAddress);
      if (!state) {
        return Promise.resolve<BeneficiaryWarnResult>({
          vaultAddress: vault.vaultAddress,
          warnSent:     false,
          alreadySent:  false,
          notReached:   true,
        });
      }
      return evaluateAndWarn(connection, program, vault, state, blinkBaseUrl);
    }),
  );

  return results.map((r, i) => {
    if (r.status === "rejected") {
      return {
        vaultAddress: vaults[i].vaultAddress,
        warnSent:     false,
        alreadySent:  false,
        notReached:   false,
        error:        String(r.reason),
      };
    }
    return r.value;
  });
}

// ── Single vault evaluation ───────────────────────────────────────────────────

async function evaluateAndWarn(
  connection: Connection,
  program: Program<any>,
  vault: VaultRecord,
  state: VaultInactivityState,
  blinkBaseUrl: string,
): Promise<BeneficiaryWarnResult> {
  // Must be at least in the Orange zone (≥ 90%) but not yet triggered (Red).
  // Using the canonical WARNING_SLOT_PCT_90 constant from block_counter.ts
  // rather than a bare literal — if the on-chain constant changes, this
  // threshold updates automatically via the single imported source.
  if (state.score < WARNING_SLOT_PCT_90) {
    return { vaultAddress: vault.vaultAddress, warnSent: false, alreadySent: false, notReached: true };
  }

  // Respect the on-chain and local warning flags.
  if (state.warning90AlreadySent || vault.warning90Sent) {
    return { vaultAddress: vault.vaultAddress, warnSent: false, alreadySent: true, notReached: false };
  }

  logger.warn(
    {
      vault:        vault.vaultAddress,
      score:        state.score.toString(),
      elapsedSlots: state.elapsedSlots.toString(),
      triggerSlot:  state.triggerSlot.toString(),
    },
    "Vault crossed 90% inactivity threshold — sending beneficiary warning",
  );

  try {
    const secondsToTrigger = estimateSecondsToTrigger(
      state.computedAtSlot,
      state.triggerSlot,
    );

    // Construct the Blink URL pointing to the Next.js Solana Actions endpoint.
    // The endpoint at /api/actions/claim implements the Blink GET/POST protocol:
    //   GET  → returns action metadata (title, description, label)
    //   POST → returns an unsigned transaction the wallet signs and submits
    // The UI page at /claim is a human-navigable React page, NOT a Blink endpoint.
    const claimBlinkUrl = buildClaimBlinkUrl(blinkBaseUrl, vault.vaultAddress);

    const warnEvent: BeneficiaryWarnEvent = {
      vaultAddress:              vault.vaultAddress,
      ownerAddress:              vault.ownerAddress,
      beneficiaryAddress:        vault.beneficiary,
      inactivityScorePct:        state.score.toString(),
      elapsedSlots:              state.elapsedSlots.toString(),
      triggerSlot:               state.triggerSlot.toString(),
      estimatedSecondsToTrigger: secondsToTrigger,
      depositedLamports:         vault.depositedLamports,
      warnSlot:                  state.computedAtSlot.toString(),
      claimBlinkUrl,
    };

    // Write the DB flag BEFORE emitting the event so that a crash between the
    // two operations leaves the system in a safe state: the flag prevents
    // re-emission on the next restart. The inverse ordering (emit first, write
    // later) risks a duplicate beneficiary warning on every restart in the
    // window between the emit and the DB write.
    getStore().setWarning90Sent(vault.vaultAddress, true);

    // Emit to the delivery layer.
    beneficiaryAlertBus.emit("beneficiary_warn", warnEvent);

    logger.info(
      {
        vault:             vault.vaultAddress,
        beneficiary:       vault.beneficiary,
        secondsToTrigger,
        claimBlinkUrl,
      },
      "Beneficiary warning event emitted",
    );

    return { vaultAddress: vault.vaultAddress, warnSent: true, alreadySent: false, notReached: false };
  } catch (err) {
    logger.error({ vault: vault.vaultAddress, err }, "Beneficiary warning failed");
    return {
      vaultAddress: vault.vaultAddress,
      warnSent:     false,
      alreadySent:  false,
      notReached:   false,
      error:        String(err),
    };
  }
}

// ── Blink URL builder ─────────────────────────────────────────────────────────

/**
 * Constructs a Solana Blink URL for the claim_inheritance instruction.
 *
 * The Blink endpoint lives at /api/actions/claim in the Next.js app. This
 * path implements the Solana Actions protocol (GET for action metadata,
 * POST with { account } body for unsigned transaction). Blink-compatible
 * wallets (Phantom, Backpack, etc.) call GET on this URL to discover the
 * action and POST to build the transaction for the user to sign.
 *
 * Format: {blinkBaseUrl}/api/actions/claim?vault={vaultAddress}
 */
function buildClaimBlinkUrl(blinkBaseUrl: string, vaultAddress: string): string {
  const url = new URL("/api/actions/claim", blinkBaseUrl);
  url.searchParams.set("vault", vaultAddress);
  return url.toString();
}

// ── Urgency helpers ───────────────────────────────────────────────────────────

/**
 * Returns a human-readable urgency string based on the estimated time
 * remaining. Used by delivery integrations to set notification priority.
 */
export function deriveUrgencyLabel(estimatedSecondsToTrigger: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const hours = estimatedSecondsToTrigger / 3600;
  if (hours > 72)  return "LOW";
  if (hours > 24)  return "MEDIUM";
  if (hours > 6)   return "HIGH";
  return "CRITICAL";
}
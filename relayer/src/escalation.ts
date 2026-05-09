// relayer/src/escalation.ts
//
// Called when the relayer has exhausted all retry attempts for a
// trigger_inheritance transaction and still cannot get it confirmed.
// At this point a human operator must investigate.
//
// Escalation emits a FATAL log (which monitoring services like Datadog,
// PagerDuty, or Grafana can alert on) and fires an event on the
// escalationBus so any registered delivery integration (email, SMS,
// on-call webhook) can notify the team.
//
// Possible root causes for escalation:
//   - The relayer's SOL balance is too low to pay fees.
//   - The RPC node is degraded and not accepting transactions.
//   - The vault was closed or already handled between signal and broadcast.
//   - A bug in the pre-flight logic is incorrectly returning ReadyToTrigger.

import { EventEmitter } from "events";
import { logger }       from "./logger";

// ── Escalation bus ────────────────────────────────────────────────────────────
// Delivery integrations (PagerDuty webhook, email, Slack) subscribe to this bus.

export const escalationBus = new EventEmitter();

export interface EscalationEvent {
  vaultAddress:  string;
  reason:        string;
  attemptCount:  number;
  escalatedAtMs: number;
}

/**
 * Emits a FATAL log and fires an escalation event. Called by index.ts when
 * a trigger job's BroadcastStatus is Failed.
 */
export function escalateFailedTrigger(
  vaultAddress: string,
  reason:       string,
  attemptCount: number,
): void {
  const event: EscalationEvent = {
    vaultAddress,
    reason,
    attemptCount,
    escalatedAtMs: Date.now(),
  };

  // FATAL log — triggers PagerDuty/Opsgenie if log-level alerting is configured.
  logger.fatal(
    { vaultAddress, reason, attemptCount },
    "CRITICAL: trigger_inheritance could not be confirmed after maximum retries — human intervention required",
  );

  // Fire the escalation event for any registered delivery integrations.
  escalationBus.emit("escalation", event);
}

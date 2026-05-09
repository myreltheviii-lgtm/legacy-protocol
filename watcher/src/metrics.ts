// watcher/src/metrics.ts
//
// Lightweight Prometheus text-format metrics for operator observability.
// Exposes counters and gauges without requiring the prom-client package.
// The /metrics endpoint in index.ts serves these in Prometheus exposition
// format so Grafana/VictoriaMetrics can scrape them directly.
//
// Design: all counters are in-memory only and reset on restart. For
// production durability, persist them to SQLite or use an external push
// gateway. For the current scope, ephemeral metrics are sufficient.

export interface WatcherMetrics {
  // ── Uptime ──────────────────────────────────────────────────────────────────
  startTimeMs: number;

  // ── Geyser stream ───────────────────────────────────────────────────────────
  geyserReconnects:    number;
  geyserUpdatesTotal:  number;
  snapshotsCompleted:  number;

  // ── Poll cycles ──────────────────────────────────────────────────────────────
  pollCyclesTotal:     number;
  pollCycleDurationMs: number; // last cycle only
  vaultsMonitored:     number; // gauge — current value

  // ── Zone distribution (gauge — recomputed each cycle) ────────────────────────
  vaultsGreen:         number;
  vaultsYellow:        number;
  vaultsOrange:        number;
  vaultsRed:           number;

  // ── Alert counters ────────────────────────────────────────────────────────────
  guardianPingsTotal:       number;
  beneficiaryWarningsTotal: number;
  triggerSignalsTotal:      number;
  anomalyFlagsTotal:        number;

  // ── Error counters ────────────────────────────────────────────────────────────
  reconcileErrorsTotal: number;
  alertErrorsTotal:     number;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const _metrics: WatcherMetrics = {
  startTimeMs:              Date.now(),
  geyserReconnects:         0,
  geyserUpdatesTotal:       0,
  snapshotsCompleted:       0,
  pollCyclesTotal:          0,
  pollCycleDurationMs:      0,
  vaultsMonitored:          0,
  vaultsGreen:              0,
  vaultsYellow:             0,
  vaultsOrange:             0,
  vaultsRed:                0,
  guardianPingsTotal:       0,
  beneficiaryWarningsTotal: 0,
  triggerSignalsTotal:      0,
  anomalyFlagsTotal:        0,
  reconcileErrorsTotal:     0,
  alertErrorsTotal:         0,
};

export function getMetrics(): WatcherMetrics {
  return _metrics;
}

export function incGeyserReconnects():       void { _metrics.geyserReconnects++; }
export function incGeyserUpdates():          void { _metrics.geyserUpdatesTotal++; }
export function incSnapshotsCompleted():     void { _metrics.snapshotsCompleted++; }
export function incPollCycles():             void { _metrics.pollCyclesTotal++; }
export function incGuardianPings(n = 1):     void { _metrics.guardianPingsTotal    += n; }
export function incBeneficiaryWarnings(n=1): void { _metrics.beneficiaryWarningsTotal += n; }
export function incTriggerSignals(n = 1):    void { _metrics.triggerSignalsTotal   += n; }
export function incAnomalyFlags(n = 1):      void { _metrics.anomalyFlagsTotal     += n; }
export function incReconcileErrors(n = 1):   void { _metrics.reconcileErrorsTotal  += n; }
export function incAlertErrors(n = 1):       void { _metrics.alertErrorsTotal      += n; }

export function setZoneCounts(green: number, yellow: number, orange: number, red: number): void {
  _metrics.vaultsGreen  = green;
  _metrics.vaultsYellow = yellow;
  _metrics.vaultsOrange = orange;
  _metrics.vaultsRed    = red;
}

export function setVaultsMonitored(n: number):      void { _metrics.vaultsMonitored    = n; }
export function setPollCycleDurationMs(ms: number): void { _metrics.pollCycleDurationMs = ms; }

/**
 * Renders all metrics in Prometheus text exposition format.
 * Compatible with Prometheus scrapers, VictoriaMetrics, and Grafana.
 */
export function renderPrometheusMetrics(): string {
  const m    = _metrics;
  const now  = Date.now();
  const upMs = now - m.startTimeMs;

  const lines: string[] = [
    "# HELP watcher_uptime_seconds Watcher process uptime in seconds",
    "# TYPE watcher_uptime_seconds gauge",
    `watcher_uptime_seconds ${(upMs / 1000).toFixed(1)}`,
    "",
    "# HELP watcher_geyser_reconnects_total Total Geyser stream reconnection count",
    "# TYPE watcher_geyser_reconnects_total counter",
    `watcher_geyser_reconnects_total ${m.geyserReconnects}`,
    "",
    "# HELP watcher_geyser_updates_total Total account updates received from Geyser",
    "# TYPE watcher_geyser_updates_total counter",
    `watcher_geyser_updates_total ${m.geyserUpdatesTotal}`,
    "",
    "# HELP watcher_snapshots_completed_total Total program-account snapshots completed",
    "# TYPE watcher_snapshots_completed_total counter",
    `watcher_snapshots_completed_total ${m.snapshotsCompleted}`,
    "",
    "# HELP watcher_poll_cycles_total Total poll cycles completed",
    "# TYPE watcher_poll_cycles_total counter",
    `watcher_poll_cycles_total ${m.pollCyclesTotal}`,
    "",
    "# HELP watcher_poll_cycle_duration_ms Duration of the most recent poll cycle in ms",
    "# TYPE watcher_poll_cycle_duration_ms gauge",
    `watcher_poll_cycle_duration_ms ${m.pollCycleDurationMs}`,
    "",
    "# HELP watcher_vaults_monitored Current number of actively monitored vaults",
    "# TYPE watcher_vaults_monitored gauge",
    `watcher_vaults_monitored ${m.vaultsMonitored}`,
    "",
    "# HELP watcher_vaults_by_zone Current vault count per inactivity zone",
    "# TYPE watcher_vaults_by_zone gauge",
    `watcher_vaults_by_zone{zone="green"}  ${m.vaultsGreen}`,
    `watcher_vaults_by_zone{zone="yellow"} ${m.vaultsYellow}`,
    `watcher_vaults_by_zone{zone="orange"} ${m.vaultsOrange}`,
    `watcher_vaults_by_zone{zone="red"}    ${m.vaultsRed}`,
    "",
    "# HELP watcher_guardian_pings_total Total guardian ping events emitted",
    "# TYPE watcher_guardian_pings_total counter",
    `watcher_guardian_pings_total ${m.guardianPingsTotal}`,
    "",
    "# HELP watcher_beneficiary_warnings_total Total beneficiary warning events emitted",
    "# TYPE watcher_beneficiary_warnings_total counter",
    `watcher_beneficiary_warnings_total ${m.beneficiaryWarningsTotal}`,
    "",
    "# HELP watcher_trigger_signals_total Total trigger signals emitted to the relayer",
    "# TYPE watcher_trigger_signals_total counter",
    `watcher_trigger_signals_total ${m.triggerSignalsTotal}`,
    "",
    "# HELP watcher_anomaly_flags_total Total on-chain anomaly_flag transactions submitted",
    "# TYPE watcher_anomaly_flags_total counter",
    `watcher_anomaly_flags_total ${m.anomalyFlagsTotal}`,
    "",
    "# HELP watcher_reconcile_errors_total Total vault reconciliation errors",
    "# TYPE watcher_reconcile_errors_total counter",
    `watcher_reconcile_errors_total ${m.reconcileErrorsTotal}`,
    "",
    "# HELP watcher_alert_errors_total Total alert pipeline errors",
    "# TYPE watcher_alert_errors_total counter",
    `watcher_alert_errors_total ${m.alertErrorsTotal}`,
    "",
  ];

  return lines.join("\n");
}

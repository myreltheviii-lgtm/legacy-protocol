// watcher/src/config.ts
//
// Single source of truth for all watcher configuration.
//
// Level 4 addition: TRIGGER_SIGNER_SECRET_KEY — an Ed25519 private key (base58)
// used to sign every TriggerReadyEvent payload before it is emitted. The relayer
// verifies this signature using the corresponding public key before submitting
// trigger_inheritance transactions. This prevents a compromised watcher DB or
// event bus from causing spurious trigger submissions.

import { logger } from "./logger";

export interface WatcherConfig {
  rpcEndpoint:   string;
  rpcWsEndpoint: string | undefined;
  programId:     string;

  geyserEndpoint:  string;
  geyserXToken:    string;
  heartbeatSlots:  number;

  pollIntervalMs:  number;
  pollConcurrency: number;

  dbPath:          string;
  dbRetentionDays: number;

  guardianSecretKeys: string[];
  appBaseUrl:         string;

  maintenanceIntervalMs: number;
  internalPort:          number;

  // Level 4: operator keypair used to sign trigger signals. The relayer must be
  // configured with the matching public key so it can verify signals before
  // submitting trigger_inheritance. If absent, signals are emitted unsigned and
  // the relayer skips signature verification (development / single-process mode).
  triggerSignerSecretKey: string | undefined;
}

function loadConfig(): WatcherConfig {
  const required = (key: string): string => {
    const value = process.env[key];
    if (!value) {
      throw new Error(
        `Required environment variable ${key} is missing. Set it before starting the watcher.`,
      );
    }
    return value;
  };

  const optional    = (key: string, defaultValue: string): string =>
    process.env[key] ?? defaultValue;

  const optionalInt = (key: string, defaultValue: number): number => {
    const raw = process.env[key];
    if (!raw) return defaultValue;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) {
      throw new Error(`Environment variable ${key} must be an integer, got: "${raw}"`);
    }
    return parsed;
  };

  const rawGuardianKeys = optional("GUARDIAN_SECRET_KEYS", "");
  const guardianSecretKeys = rawGuardianKeys
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  const rawWsEndpoint = process.env["SOLANA_RPC_WS_ENDPOINT"];
  const rpcWsEndpoint = rawWsEndpoint && rawWsEndpoint.length > 0
    ? rawWsEndpoint
    : undefined;

  const rawSignerKey = process.env["TRIGGER_SIGNER_SECRET_KEY"];
  const triggerSignerSecretKey = rawSignerKey && rawSignerKey.length > 0
    ? rawSignerKey
    : undefined;

  const config: WatcherConfig = {
    rpcEndpoint:   required("SOLANA_RPC_ENDPOINT"),
    rpcWsEndpoint,
    programId:     required("LEGACY_VAULT_PROGRAM_ID"),

    geyserEndpoint:  required("GEYSER_GRPC_ENDPOINT"),
    geyserXToken:    optional("GEYSER_X_TOKEN", ""),
    heartbeatSlots:  optionalInt("HEARTBEAT_SLOTS", 300),

    pollIntervalMs:  optionalInt("POLL_INTERVAL_MS",  30_000),
    pollConcurrency: optionalInt("POLL_CONCURRENCY",  20),

    dbPath:          optional("DB_PATH",            "./watcher.db"),
    dbRetentionDays: optionalInt("DB_RETENTION_DAYS", 30),

    guardianSecretKeys,
    appBaseUrl: optional("APP_BASE_URL", "http://localhost:3000"),

    maintenanceIntervalMs: optionalInt("MAINTENANCE_INTERVAL_MS", 3_600_000),
    internalPort:          optionalInt("INTERNAL_PORT",            3001),

    triggerSignerSecretKey,
  };

  return config;
}

let _config: WatcherConfig | null = null;

export function getConfig(): WatcherConfig {
  if (!_config) {
    _config = loadConfig();
    logger.info(
      {
        rpcEndpoint:           _config.rpcEndpoint,
        rpcWsEndpoint:         _config.rpcWsEndpoint ?? "(derived from rpcEndpoint)",
        geyserEndpoint:        _config.geyserEndpoint,
        programId:             _config.programId,
        heartbeatSlots:        _config.heartbeatSlots,
        dbPath:                _config.dbPath,
        appBaseUrl:            _config.appBaseUrl,
        internalPort:          _config.internalPort,
        guardianCount:         _config.guardianSecretKeys.length,
        triggerSigningEnabled: _config.triggerSignerSecretKey !== undefined,
      },
      "Watcher configuration loaded",
    );
  }
  return _config;
}


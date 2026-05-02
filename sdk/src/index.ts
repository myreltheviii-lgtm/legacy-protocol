// sdk/src/index.ts
//
// Public API surface of the Legacy Protocol SDK.

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  VaultAccount,
  ActivityAccount,
  GuardianAccount,
  CovenantAccount,
  VaultWithAddress,
  ThresholdMilestones,
  VaultInactivityState,
  LegacyErrorInfo,
  LegacyEvent,
  VaultInitialisedEvent,
  CheckedInEvent,
  InheritanceTriggeredEvent,
  InheritanceClaimedEvent,
  EmergencySweptEvent,
  AnomalyFlaggedEvent,
  ThresholdUpdatedEvent,
  DepositedEvent,
  VaultClosedEvent,
  GuardianAddedEvent,
  GuardianRemovalInitiatedEvent,
  GuardianRemovedEvent,
  CovenantCreatedEvent,
  CovenantSignedEvent,
  BeneficiaryChangedEvent,
  GuardianRemovedByCovenantEvent,
  OrphanedCovenantClosedEvent,
} from "./types";

export { CovenantType, ActivityZone } from "./types";

// ── PDA helpers ───────────────────────────────────────────────────────────────
export {
  deriveVaultPda,
  deriveActivityPda,
  deriveGuardianPda,
  deriveCovenantPda,
} from "./pda";

// ── Account fetchers ──────────────────────────────────────────────────────────
export {
  fetchVault,
  fetchActivity,
  fetchGuardian,
  fetchCovenant,
  fetchAllVaultsForOwner,
  fetchAllGuardiansForVault,
  fetchAllCovenantsForVault,
} from "./accounts";

// ── Math helpers ──────────────────────────────────────────────────────────────
export {
  computeInactivityScore,
  classifyZone,
  computeMilestones,
  thresholdCrossed,
  isAnomalous,
  computeVaultInactivityState,
  estimateSecondsToTrigger,
  DEFAULT_INACTIVITY_THRESHOLD_SLOTS,
  MIN_INACTIVITY_THRESHOLD_SLOTS,
  MAX_INACTIVITY_THRESHOLD_SLOTS,
  GUARDIAN_REMOVAL_TIMELOCK_SLOTS,
  BENEFICIARY_CHANGE_TIMELOCK_SLOTS,
  EMERGENCY_SWEEP_TIMELOCK_SLOTS,
  GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS,
  ANOMALY_MULTIPLIER_PCT,
  WARNING_SLOT_PCT_75,
  WARNING_SLOT_PCT_90,
  MAX_GUARDIANS,
  MAX_COVENANT_SIGNERS,
} from "./math";

// ── Event parsers — all 17 ────────────────────────────────────────────────────
export {
  parseVaultInitialisedEvent,
  parseCheckedInEvent,
  parseInheritanceTriggeredEvent,
  parseInheritanceClaimedEvent,
  parseEmergencySweptEvent,
  parseAnomalyFlaggedEvent,
  parseThresholdUpdatedEvent,
  parseDepositedEvent,
  parseVaultClosedEvent,
  parseGuardianAddedEvent,
  parseGuardianRemovalInitiatedEvent,
  parseGuardianRemovedEvent,
  parseCovenantCreatedEvent,
  parseCovenantSignedEvent,
  parseBeneficiaryChangedEvent,
  parseGuardianRemovedByCovenantEvent,
  parseOrphanedCovenantClosedEvent,
  parseLegacyEventFromLog,
  parseLegacyEventsFromLogs,
} from "./events";

// ── Error decoder ─────────────────────────────────────────────────────────────
export { decodeLegacyError, getAllErrorCodes } from "./errors";

// ── Instruction builders — all 15 ────────────────────────────────────────────
export type {
  InitializeVaultParams,
  ConfigureThresholdParams,
  DepositParams,
  CloseVaultParams,
  AddGuardianParams,
  RemoveGuardianParams,
  CreateCovenantParams,
  GuardianSignParams,
  ExecuteCovenantParams,
  CheckInParams,
  AnomalyFlagParams,
  TriggerInheritanceParams,
  ClaimInheritanceParams,
  EmergencySweepParams,
  CloseOrphanedCovenantParams,
} from "./instructions";

export {
  buildInitializeVaultIx,
  buildConfigureThresholdIx,
  buildDepositIx,
  buildCloseVaultIx,
  buildAddGuardianIx,
  buildRemoveGuardianIx,
  buildCreateCovenantIx,
  buildGuardianSignIx,
  buildExecuteCovenantIx,
  buildCheckInIx,
  buildAnomalyFlagIx,
  buildTriggerInheritanceIx,
  buildClaimInheritanceIx,
  buildEmergencySweepIx,
  buildCloseOrphanedCovenantIx,
} from "./instructions";

// ── Transaction helpers — Level 2 + Level 4 ───────────────────────────────────
export type {
  WalletAdapter,
  SendTxOptions,
  SendTxResult,
  RetryOptions,
  UnsignedTxPayload,
} from "./transactions";

export {
  sendAndConfirmLegacyTx,
  sendAndConfirmVersionedTx,
  simulateTx,
  withRetry,
  isTransientError,
  // Level 4: offline signing
  buildUnsignedTransaction,
  deserializeAndSubmitTx,
  signOfflineAndSubmit,
} from "./transactions";

// ── React hooks — Level 3 ─────────────────────────────────────────────────────
export type {
  UseVaultResult,
  UseGuardiansResult,
  GuardianWithAddress,
  UseCovenantsResult,
  CovenantWithAddress,
  UseVaultInactivityResult,
} from "./hooks";

export {
  useVault,
  useVaultRealtime,
  useGuardians,
  useCovenants,
  useVaultInactivity,
} from "./hooks";

// ── Blink URL helpers — Level 3 ───────────────────────────────────────────────
export type { LegacyBlinkUrls } from "./blink";

export {
  buildVaultBlinkUrls,
  buildClaimBlinkUrl,
  buildTriggerBlinkUrl,
  buildCheckInBlinkUrl,
  parseLegacyBlinkUrl,
} from "./blink";

// ── Shamir's Secret Sharing — Level 4 ────────────────────────────────────────
export type { ShamirShare } from "./shamir";

export {
  splitSecret,
  reconstructSecret,
  verifyShare,
  encodeShareBase64,
  decodeShareBase64,
  ShamirError,
} from "./shamir";


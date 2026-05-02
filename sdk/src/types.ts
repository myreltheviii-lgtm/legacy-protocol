// sdk/src/types.ts
//
// Canonical TypeScript representations of every on-chain type. All u64 fields
// use bigint to preserve precision past Number.MAX_SAFE_INTEGER — Solana slot
// numbers routinely exceed 2^53 in production. Pubkeys are kept as their
// base58 string form so callers do not need to import PublicKey just to read
// an account field.

// ── Enums ────────────────────────────────────────────────────────────────────

/**
 * The three actions a covenant can authorise once it reaches M-of-N signatures.
 * Numeric values match the borsh variant index in the on-chain enum.
 */
export enum CovenantType {
  EmergencySweep    = 0,
  BeneficiaryChange = 1,
  GuardianRemoval   = 2,
}

/**
 * Which zone a vault's inactivity score currently falls into.
 * Matches the Rust ActivityZone enum in math/activity_score.rs.
 */
export enum ActivityZone {
  /** 0–74 %: Normal. Owner is checking in regularly. */
  Green  = "GREEN",
  /** 75–89 %: Unusual silence. Guardian ping warranted. */
  Yellow = "YELLOW",
  /** 90–99 %: Critical silence. Beneficiary warning warranted. */
  Orange = "ORANGE",
  /** ≥100 %: Threshold crossed. trigger_inheritance is callable. */
  Red    = "RED",
}

// ── On-chain account types ────────────────────────────────────────────────────

/** Deserialised VaultAccount. Central on-chain record for one inheritance vault. */
export interface VaultAccount {
  owner:                    string;  // base58
  beneficiary:              string;  // base58
  guardianCount:            number;
  mOfNThreshold:            number;
  inactivityThresholdSlots: bigint;
  lastCheckInSlot:          bigint;
  createdSlot:              bigint;
  depositedLamports:        bigint;
  covenantCounter:          bigint;
  vaultIndex:               bigint;
  isTriggered:              boolean;
  isClaimed:                boolean;
  isEmergencySwept:         boolean;
  warning75Sent:            boolean;
  warning90Sent:            boolean;
  bump:                     number;
}

/** Deserialised ActivityAccount. Statistical model of owner check-in behaviour. */
export interface ActivityAccount {
  vault:              string;  // base58
  checkinCount:       bigint;
  sumOfIntervals:     bigint;
  lastInterval:       bigint;
  anomalyFlagged:     boolean;
  anomalyFlaggedSlot: bigint;
  bump:               number;
}

/** Deserialised GuardianAccount. One PDA per (vault, guardian) pair. */
export interface GuardianAccount {
  vault:                string;  // base58
  guardian:             string;  // base58
  isActive:             boolean;
  addedSlot:            bigint;
  removalRequestedSlot: bigint;
  bump:                 number;
}

/** Deserialised CovenantAccount. A multi-guardian approval request. */
export interface CovenantAccount {
  vault:                  string;       // base58
  covenantType:           CovenantType;
  target:                 string;       // base58
  signers:                string[];     // base58 array
  requiredSignatures:     number;
  createdSlot:            bigint;
  timelockSlots:          bigint;
  signaturesCompleteSlot: bigint;
  covenantIndex:          bigint;
  isExecuted:             boolean;
  bump:                   number;
}

/** A fetched vault with its on-chain address. */
export interface VaultWithAddress {
  publicKey: string;      // base58 PDA address
  account:   VaultAccount;
}

// ── Milestone / math result types ─────────────────────────────────────────────

/** Pre-computed absolute slot numbers for a vault's inactivity milestones. */
export interface ThresholdMilestones {
  /** Slot at which the inactivity score crosses 75 %. */
  warning75Slot: bigint;
  /** Slot at which the inactivity score crosses 90 %. */
  warning90Slot: bigint;
  /** Slot at which trigger_inheritance becomes callable. */
  triggerSlot:   bigint;
}

/** Full inactivity state for a vault at a point in time. */
export interface VaultInactivityState {
  score:         bigint;
  zone:          ActivityZone;
  elapsedSlots:  bigint;
  milestones:    ThresholdMilestones;
}

// ── Event payload types ───────────────────────────────────────────────────────
// All 17 on-chain events emitted by the program.

export interface VaultInitialisedEvent {
  name:           "VaultInitialised";
  vault:          string;
  owner:          string;
  beneficiary:    string;
  thresholdSlots: bigint;
  createdSlot:    bigint;
}

export interface CheckedInEvent {
  name:         "CheckedIn";
  vault:        string;
  owner:        string;
  slot:         bigint;
  interval:     bigint;
  checkinCount: bigint;
}

export interface InheritanceTriggeredEvent {
  name:              "InheritanceTriggered";
  vault:             string;
  owner:             string;
  beneficiary:       string;
  triggeredSlot:     bigint;
  lastCheckInSlot:   bigint;
  depositedLamports: bigint;
}

export interface InheritanceClaimedEvent {
  name:        "InheritanceClaimed";
  vault:       string;
  beneficiary: string;
  lamports:    bigint;
  claimedSlot: bigint;
}

export interface EmergencySweptEvent {
  name:        "EmergencySwept";
  vault:       string;
  beneficiary: string;
  lamports:    bigint;
  sweptSlot:   bigint;
  covenant:    string;
}

export interface AnomalyFlaggedEvent {
  name:             "AnomalyFlagged";
  vault:            string;
  guardian:         string;
  flaggedSlot:      bigint;
  lastCheckInSlot:  bigint;
  checkinCount:     bigint;
}

export interface ThresholdUpdatedEvent {
  name:         "ThresholdUpdated";
  vault:        string;
  oldThreshold: bigint;
  newThreshold: bigint;
}

export interface DepositedEvent {
  name:     "Deposited";
  vault:    string;
  lamports: bigint;
  total:    bigint;
}

export interface VaultClosedEvent {
  name:  "VaultClosed";
  vault: string;
  owner: string;
}

export interface GuardianAddedEvent {
  name:          "GuardianAdded";
  vault:         string;
  guardian:      string;
  guardianCount: number;
  mOfN:          number;
}

export interface GuardianRemovalInitiatedEvent {
  name:                  "GuardianRemovalInitiated";
  vault:                 string;
  guardian:              string;
  removalRequestedSlot:  bigint;
  finaliseAfterSlot:     bigint;
}

export interface GuardianRemovedEvent {
  name:             "GuardianRemoved";
  vault:            string;
  guardian:         string;
  guardianCount:    number;
  mOfN:             number;
  thresholdLowered: boolean;
}

export interface CovenantCreatedEvent {
  name:          "CovenantCreated";
  vault:         string;
  covenant:      string;
  covenantType:  CovenantType;
  covenantIndex: bigint;
  requiredSigs:  number;
  firstSigner:   string;
}

export interface CovenantSignedEvent {
  name:             "CovenantSigned";
  vault:            string;
  covenant:         string;
  guardian:         string;
  totalSigners:     number;
  requiredSigners:  number;
  thresholdReached: boolean;
}

export interface BeneficiaryChangedEvent {
  name:           "BeneficiaryChanged";
  vault:          string;
  oldBeneficiary: string;
  newBeneficiary: string;
  covenant:       string;
  executedSlot:   bigint;
}

export interface GuardianRemovedByCovenantEvent {
  name:             "GuardianRemovedByCovenant";
  vault:            string;
  guardian:         string;
  covenant:         string;
  guardianCount:    number;
  mOfN:             number;
  thresholdLowered: boolean;
  executedSlot:     bigint;
}

export interface OrphanedCovenantClosedEvent {
  name:          "OrphanedCovenantClosed";
  vault:         string;
  covenant:      string;
  covenantIndex: bigint;
  covenantType:  CovenantType;
  caller:        string;
  closedSlot:    bigint;
}

/** Union of all 17 possible events the program can emit. */
export type LegacyEvent =
  | VaultInitialisedEvent
  | CheckedInEvent
  | InheritanceTriggeredEvent
  | InheritanceClaimedEvent
  | EmergencySweptEvent
  | AnomalyFlaggedEvent
  | ThresholdUpdatedEvent
  | DepositedEvent
  | VaultClosedEvent
  | GuardianAddedEvent
  | GuardianRemovalInitiatedEvent
  | GuardianRemovedEvent
  | CovenantCreatedEvent
  | CovenantSignedEvent
  | BeneficiaryChangedEvent
  | GuardianRemovedByCovenantEvent
  | OrphanedCovenantClosedEvent;

// ── Error info ────────────────────────────────────────────────────────────────

/** The decoded form of a LegacyError returned by the program. */
export interface LegacyErrorInfo {
  code:    number;
  name:    string;
  message: string;
}

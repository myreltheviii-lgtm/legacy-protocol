// sdk/src/types.ts
//
// TypeScript representations of all on-chain account structs, plus derived
// types used throughout the SDK and frontend.
//
// VaultAccount layout (168 bytes on-chain):
//   [0..8]    discriminator
//   [8..40]   owner: Pubkey
//   [40..72]  beneficiary_utxo_pubkey: [u8;32]
//   [72]      guardian_count: u8
//   [73]      m_of_n_threshold: u8
//   [74..82]  inactivity_threshold_slots: u64
//   [82..90]  last_check_in_slot: u64
//   [90..98]  created_slot: u64
//   [98..106] deposited_lamports: u64
//   [106..114] covenant_counter: u64
//   [114..122] vault_index: u64
//   [122..154] utxo_commitment: [u8;32]
//   [154..162] utxo_leaf_index: u64
//   [162]     is_triggered: bool
//   [163]     is_claimed: bool
//   [164]     is_emergency_swept: bool
//   [165]     warning_75_sent: bool
//   [166]     warning_90_sent: bool
//   [167]     bump: u8

// ── Account types ─────────────────────────────────────────────────────────────

export interface VaultAccount {
  /** Wallet that owns and controls this vault. */
  owner:                    string;

  /**
   * Hex-encoded 32-byte Cloak UTXO public key of the beneficiary.
   * NOT a Solana wallet address — do not attempt base58-decode.
   * For non-shielded vaults, this is the raw bytes of the Solana beneficiary
   * pubkey stored as hex (round-trips via Pubkey::from(bytes) on-chain).
   */
  beneficiaryUtxoPubkey:    string;

  /** @deprecated Use beneficiaryUtxoPubkey. Kept for backward compatibility. */
  beneficiary:              string;

  guardianCount:            number;
  mOfNThreshold:            number;
  inactivityThresholdSlots: bigint;
  lastCheckInSlot:          bigint;
  createdSlot:              bigint;
  /** Declared shielded lamports (from record_cloak_deposit). */
  depositedLamports:        bigint;
  covenantCounter:          bigint;
  vaultIndex:               bigint;

  /** Hex-encoded Poseidon UTXO commitment. All zeros = no shielded deposit. */
  utxoCommitment:           string;
  /** Leaf index in Cloak's Merkle tree. */
  utxoLeafIndex:            bigint;

  isTriggered:              boolean;
  isClaimed:                boolean;
  isEmergencySwept:         boolean;
  warning75Sent:            boolean;
  warning90Sent:            boolean;
  bump:                     number;
}

export interface ActivityAccount {
  vault:              string;
  checkinCount:       bigint;
  sumOfIntervals:     bigint;
  lastInterval:       bigint;
  anomalyFlagged:     boolean;
  anomalyFlaggedSlot: bigint;
  bump:               number;
}

export interface GuardianAccount {
  vault:                string;
  guardian:             string;
  isActive:             boolean;
  addedSlot:            bigint;
  removalRequestedSlot: bigint;
  bump:                 number;
}

export interface CovenantAccount {
  vault:                  string;
  covenantType:           CovenantType;
  target:                 string;
  signers:                string[];
  requiredSignatures:     number;
  createdSlot:            bigint;
  timelockSlots:          bigint;
  signaturesCompleteSlot: bigint;
  covenantIndex:          bigint;
  isExecuted:             boolean;
  bump:                   number;
}

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum CovenantType {
  EmergencySweep    = "EmergencySweep",
  BeneficiaryChange = "BeneficiaryChange",
  GuardianRemoval   = "GuardianRemoval",
}

export enum ActivityZone {
  Green  = "Green",
  Yellow = "Yellow",
  Orange = "Orange",
  Red    = "Red",
}

// ── Derived types ─────────────────────────────────────────────────────────────

export interface ThresholdMilestones {
  warning75Slot: bigint;
  warning90Slot: bigint;
  triggerSlot:   bigint;
}

export interface VaultInactivityState {
  score:      bigint;
  zone:       ActivityZone;
  milestones: ThresholdMilestones;
}

export interface VaultWithAddress {
  publicKey: string;
  account:   VaultAccount;
}

export interface GuardianWithAddress {
  publicKey: string;
  account:   GuardianAccount;
}

export interface LegacyEvent {
  name: string;
  [key: string]: unknown;
}

export interface LegacyErrorInfo {
  code:    number;
  name:    string;
  message: string;
}

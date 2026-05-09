// sdk/src/errors.ts
//
// Maps every on-chain LegacyError code to a human-readable name and message.
// All 30 error codes from errors.rs are mapped here.
//
// The error code offset is 6000 (Anchor's default custom error start). The
// enum variant index in errors.rs determines the offset from 6000:
//   variant 0  → code 6000
//   variant 29 → code 6029

import { LegacyErrorInfo } from "./types";

const ERROR_MAP: Record<number, { name: string; message: string }> = {
  6000: { name: "UnauthorisedOwner",            message: "Only the vault owner can perform this action." },
  6001: { name: "UnauthorisedGuardian",          message: "Only an active guardian of this vault can perform this action." },
  6002: { name: "UnauthorisedBeneficiary",       message: "Only the vault beneficiary can claim." },
  6003: { name: "VaultAlreadyTriggered",         message: "The vault has already been triggered for inheritance." },
  6004: { name: "VaultNotTriggered",             message: "The inheritance threshold has not been reached yet." },
  6005: { name: "VaultAlreadyClaimed",           message: "The vault has already been claimed." },
  6006: { name: "VaultAlreadySwept",             message: "The vault has already been emergency-swept." },
  6007: { name: "VaultNotEmpty",                 message: "Drain the vault before closing it." },
  6008: { name: "ThresholdTooLow",               message: "Inactivity threshold is below the protocol minimum." },
  6009: { name: "ThresholdTooHigh",              message: "Inactivity threshold exceeds the protocol maximum." },
  6010: { name: "ThresholdNotReached",           message: "The inactivity threshold has not been reached yet." },
  6011: { name: "TooManyGuardians",              message: "This vault has reached the maximum number of guardians." },
  6012: { name: "GuardiansStillRegistered",      message: "All guardians must be removed before the vault can be closed." },
  6013: { name: "GuardianVaultMismatch",         message: "Guardian does not belong to this vault." },
  6014: { name: "GuardianAlreadyInactive",       message: "This guardian has already been removed." },
  6015: { name: "NoRemovalPending",              message: "No removal request is pending for this guardian." },
  6016: { name: "RemovalTimelockActive",         message: "The guardian removal timelock has not elapsed yet." },
  6017: { name: "ThresholdExceedsGuardianCount", message: "M-of-N threshold cannot exceed the number of active guardians." },
  6018: { name: "ThresholdTooSmall",             message: "M-of-N threshold must be at least 1." },
  6019: { name: "AlreadySigned",                 message: "This guardian has already signed this covenant." },
  6020: { name: "CovenantAlreadyExecuted",       message: "This covenant has already been executed." },
  6021: { name: "InsufficientSignatures",        message: "Not enough guardian signatures on this covenant." },
  6022: { name: "CovenantTimelockActive",        message: "The covenant timelock has not elapsed yet." },
  6023: { name: "CovenantTypeMismatch",          message: "Covenant type mismatch for this instruction." },
  6024: { name: "CovenantVaultMismatch",         message: "Covenant does not belong to this vault." },
  6025: { name: "AnomalyAlreadyFlagged",         message: "An anomaly flag is already active on this vault." },
  6026: { name: "InvalidBeneficiary",            message: "Beneficiary cannot be the zero address." },
  6027: { name: "ZeroAmount",                    message: "Lamport amount must be greater than zero." },
  6028: { name: "SameSlotCheckIn",               message: "A check-in was already submitted in this slot." },
  6029: { name: "MathOverflow",                  message: "Arithmetic overflow." },
};

/**
 * Decodes an error thrown by an Anchor program call into a typed LegacyErrorInfo.
 *
 * Anchor wraps program errors in several possible shapes:
 *   - AnchorError with error.errorCode.number
 *   - SendTransactionError with logs containing "custom program error: 0xHHHH"
 *   - Raw Error with message containing the code in hex
 *
 * Returns null for errors that are not Legacy Protocol program errors (e.g.,
 * network errors, simulation failures without a program error code).
 */
export function decodeLegacyError(error: unknown): LegacyErrorInfo | null {
  if (!error) return null;

  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    // Anchor 0.30 AnchorError
    if (err["error"] && typeof err["error"] === "object" && err["error"] !== null) {
      const inner = err["error"] as Record<string, unknown>;
      if (inner["errorCode"] && typeof inner["errorCode"] === "object" && inner["errorCode"] !== null) {
        const code = (inner["errorCode"] as Record<string, unknown>)["number"];
        if (typeof code === "number") {
          return lookupErrorCode(code);
        }
      }
    }

    // SendTransactionError — parse from logs array
    const logs = err["logs"];
    if (Array.isArray(logs)) {
      for (const log of logs) {
        if (typeof log === "string") {
          const match = log.match(/custom program error: 0x([0-9a-fA-F]+)/);
          if (match) {
            const code = parseInt(match[1], 16);
            const result = lookupErrorCode(code);
            if (result) return result;
          }
        }
      }
    }

    // Error with message string containing hex code
    const message = err["message"];
    if (typeof message === "string") {
      const match = message.match(/0x([0-9a-fA-F]+)/);
      if (match) {
        const code = parseInt(match[1], 16);
        const result = lookupErrorCode(code);
        if (result) return result;
      }
      const decMatch = message.match(/custom program error: (\d+)/);
      if (decMatch) {
        const result = lookupErrorCode(parseInt(decMatch[1], 10));
        if (result) return result;
      }
    }
  }

  return null;
}

function lookupErrorCode(code: number): LegacyErrorInfo | null {
  const entry = ERROR_MAP[code];
  if (!entry) return null;
  return { code, name: entry.name, message: entry.message };
}

/** Returns the full error map for display in developer tools. */
export function getAllErrorCodes(): LegacyErrorInfo[] {
  return Object.entries(ERROR_MAP).map(([code, { name, message }]) => ({
    code:    Number(code),
    name,
    message,
  }));
}

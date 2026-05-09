import { decodeLegacyError, getAllErrorCodes } from "../../sdk/src/errors";

const ALL_CODES: Array<[number, string]> = [
  [6000, "UnauthorisedOwner"],
  [6001, "UnauthorisedGuardian"],
  [6002, "UnauthorisedBeneficiary"],
  [6003, "VaultAlreadyTriggered"],
  [6004, "VaultNotTriggered"],
  [6005, "VaultAlreadyClaimed"],
  [6006, "VaultAlreadySwept"],
  [6007, "VaultNotEmpty"],
  [6008, "ThresholdTooLow"],
  [6009, "ThresholdTooHigh"],
  [6010, "ThresholdNotReached"],
  [6011, "TooManyGuardians"],
  [6012, "GuardiansStillRegistered"],
  [6013, "GuardianVaultMismatch"],
  [6014, "GuardianAlreadyInactive"],
  [6015, "NoRemovalPending"],
  [6016, "RemovalTimelockActive"],
  [6017, "ThresholdExceedsGuardianCount"],
  [6018, "ThresholdTooSmall"],
  [6019, "AlreadySigned"],
  [6020, "CovenantAlreadyExecuted"],
  [6021, "InsufficientSignatures"],
  [6022, "CovenantTimelockActive"],
  [6023, "CovenantTypeMismatch"],
  [6024, "CovenantVaultMismatch"],
  [6025, "AnomalyAlreadyFlagged"],
  [6026, "InvalidBeneficiary"],
  [6027, "ZeroAmount"],
  [6028, "SameSlotCheckIn"],
  [6029, "MathOverflow"],
];

describe("decodeLegacyError — all 30 error codes", () => {
  it("all 30 error codes decoded to correct error name via AnchorError errorCode.number", () => {
    for (const [code, name] of ALL_CODES) {
      const result = decodeLegacyError({
        error: { errorCode: { number: code } },
      });
      expect(result).not.toBeNull();
      expect(result!.code).toBe(code);
      expect(result!.name).toBe(name);
    }
  });

  it("all 30 codes decoded via SendTransactionError hex logs", () => {
    for (const [code, name] of ALL_CODES) {
      const hexCode = code.toString(16);
      const result = decodeLegacyError({
        logs: [`Program log: custom program error: 0x${hexCode}`],
      });
      expect(result).not.toBeNull();
      expect(result!.code).toBe(code);
      expect(result!.name).toBe(name);
    }
  });

  it("all 30 codes decoded via message hex string", () => {
    for (const [code, name] of ALL_CODES) {
      const hexCode = code.toString(16);
      const result = decodeLegacyError({
        message: `Transaction failed: 0x${hexCode}`,
      });
      expect(result).not.toBeNull();
      expect(result!.code).toBe(code);
      expect(result!.name).toBe(name);
    }
  });

  it("zero missing codes — all 30 numeric codes from 6000–6029 are present", () => {
    for (let code = 6000; code <= 6029; code++) {
      const result = decodeLegacyError({ error: { errorCode: { number: code } } });
      expect(result).not.toBeNull();
    }
  });

  it("unknown error code returns null, does not throw", () => {
    expect(decodeLegacyError({ error: { errorCode: { number: 9999 } } })).toBeNull();
    expect(decodeLegacyError({ error: { errorCode: { number: 5999 } } })).toBeNull();
    expect(decodeLegacyError({ error: { errorCode: { number: 6030 } } })).toBeNull();
  });

  it("null input returns null without throwing", () => {
    expect(decodeLegacyError(null)).toBeNull();
    expect(decodeLegacyError(undefined)).toBeNull();
  });

  it("non-matching error object returns null", () => {
    expect(decodeLegacyError({ foo: "bar" })).toBeNull();
    expect(decodeLegacyError(new Error("generic error"))).toBeNull();
  });

  it("decodeLegacyError works on raw transaction error objects with decimal message", () => {
    const result = decodeLegacyError({ message: "custom program error: 6000" });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("UnauthorisedOwner");
  });

  it("error message is non-empty for all 30 codes", () => {
    for (const [code] of ALL_CODES) {
      const result = decodeLegacyError({ error: { errorCode: { number: code } } });
      expect(result!.message.length).toBeGreaterThan(0);
    }
  });

  it("all error info objects have code, name, message fields", () => {
    for (const [code, name] of ALL_CODES) {
      const result = decodeLegacyError({ error: { errorCode: { number: code } } });
      expect(typeof result!.code).toBe("number");
      expect(typeof result!.name).toBe("string");
      expect(typeof result!.message).toBe("string");
    }
  });

  it("VaultAlreadyTriggered (6003) message matches errors.rs msg()", () => {
    const result = decodeLegacyError({ error: { errorCode: { number: 6003 } } });
    expect(result!.message).toContain("triggered");
  });

  it("InsufficientSignatures (6021) message mentions signatures", () => {
    const result = decodeLegacyError({ error: { errorCode: { number: 6021 } } });
    expect(result!.message.toLowerCase()).toContain("signature");
  });

  it("MathOverflow (6029) message mentions overflow", () => {
    const result = decodeLegacyError({ error: { errorCode: { number: 6029 } } });
    expect(result!.message.toLowerCase()).toContain("overflow");
  });
});

describe("getAllErrorCodes", () => {
  it("returns all 30 error codes", () => {
    const all = getAllErrorCodes();
    expect(all.length).toBe(30);
  });

  it("codes are in ascending order from 6000 to 6029", () => {
    const all = getAllErrorCodes().sort((a, b) => a.code - b.code);
    for (let i = 0; i < all.length; i++) {
      expect(all[i].code).toBe(6000 + i);
    }
  });

  it("every entry has non-empty name and message", () => {
    for (const entry of getAllErrorCodes()) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate codes", () => {
    const all = getAllErrorCodes();
    const codes = new Set(all.map((e) => e.code));
    expect(codes.size).toBe(all.length);
  });
});

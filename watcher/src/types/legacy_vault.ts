// watcher/src/types/legacy_vault.ts
//
// The Anchor IDL type for the Legacy Vault program. This file is generated
// by `anchor build` and placed in `target/types/legacy_vault.ts`. It is
// copied here so the watcher service can import it without depending on the
// build output directory.
//
// IMPORTANT: If the on-chain program's instruction signatures or account
// layouts change, regenerate this file by running `anchor build` and copying
// the updated type from `target/types/legacy_vault.ts`. A stale IDL type
// will cause silent deserialization failures at runtime.

export type LegacyVault = {
  version: "0.1.0";
  name:    "legacy_vault";

  instructions: [
    {
      name:     "initializeVault";
      accounts: [
        { name: "owner";          isMut: true;  isSigner: true  },
        { name: "beneficiary";    isMut: false; isSigner: false },
        { name: "vault";          isMut: true;  isSigner: false },
        { name: "activity";       isMut: true;  isSigner: false },
        { name: "systemProgram";  isMut: false; isSigner: false },
      ];
      args: [
        { name: "vaultIndex";               type: "u64" },
        { name: "inactivityThresholdSlots"; type: "u64" },
      ];
    },
    {
      name:     "configureThreshold";
      accounts: [
        { name: "owner"; isMut: true;  isSigner: true  },
        { name: "vault"; isMut: true;  isSigner: false },
      ];
      args: [{ name: "newThresholdSlots"; type: "u64" }];
    },
    {
      name:     "deposit";
      accounts: [
        { name: "owner";         isMut: true;  isSigner: true  },
        { name: "vault";         isMut: true;  isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false },
      ];
      args: [{ name: "lamports"; type: "u64" }];
    },
    {
      name:     "closeVault";
      accounts: [
        { name: "owner";         isMut: true;  isSigner: true  },
        { name: "vault";         isMut: true;  isSigner: false },
        { name: "activity";      isMut: true;  isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false },
      ];
      args: [];
    },
    {
      name:     "addGuardian";
      accounts: [
        { name: "owner";           isMut: true;  isSigner: true  },
        { name: "vault";           isMut: true;  isSigner: false },
        { name: "guardian";        isMut: false; isSigner: false },
        { name: "guardianAccount"; isMut: true;  isSigner: false },
        { name: "systemProgram";   isMut: false; isSigner: false },
      ];
      args: [{ name: "mOfNThreshold"; type: "u8" }];
    },
    {
      name:     "removeGuardian";
      accounts: [
        { name: "owner";           isMut: true;  isSigner: true  },
        { name: "vault";           isMut: true;  isSigner: false },
        { name: "guardian";        isMut: false; isSigner: false },
        { name: "guardianAccount"; isMut: true;  isSigner: false },
      ];
      args: [];
    },
    {
      name:     "createCovenant";
      accounts: [
        { name: "guardian";        isMut: true;  isSigner: true  },
        { name: "vault";           isMut: true;  isSigner: false },
        { name: "guardianAccount"; isMut: false; isSigner: false },
        { name: "covenant";        isMut: true;  isSigner: false },
        { name: "systemProgram";   isMut: false; isSigner: false },
      ];
      args: [
        { name: "covenantType"; type: { defined: "CovenantType" } },
        { name: "target";       type: "publicKey" },
      ];
    },
    {
      name:     "guardianSign";
      accounts: [
        { name: "guardian";        isMut: true;  isSigner: true  },
        { name: "vault";           isMut: false; isSigner: false },
        { name: "guardianAccount"; isMut: false; isSigner: false },
        { name: "covenant";        isMut: true;  isSigner: false },
      ];
      args: [];
    },
    {
      name:     "executeCovenant";
      accounts: [
        { name: "caller";         isMut: true;  isSigner: true             },
        { name: "vault";          isMut: true;  isSigner: false            },
        { name: "covenant";       isMut: true;  isSigner: false            },
        // Optional — present only for GuardianRemoval covenants. The Rust
        // Accounts struct declares this as Option<Account<GuardianAccount>>,
        // so it may be omitted entirely for BeneficiaryChange covenants.
        { name: "targetGuardian"; isMut: true;  isSigner: false; isOptional: true },
      ];
      args: [];
    },
    {
      name:     "checkIn";
      accounts: [
        { name: "owner";    isMut: false; isSigner: true  },
        { name: "vault";    isMut: true;  isSigner: false },
        { name: "activity"; isMut: true;  isSigner: false },
      ];
      args: [];
    },
    {
      name:     "anomalyFlag";
      accounts: [
        { name: "guardian";        isMut: false; isSigner: true  },
        { name: "vault";           isMut: false; isSigner: false },
        { name: "guardianAccount"; isMut: false; isSigner: false },
        { name: "activity";        isMut: true;  isSigner: false },
      ];
      args: [];
    },
    {
      // trigger_inheritance has exactly TWO accounts: caller and vault.
      // The Rust TriggerInheritance struct does NOT include an activity account.
      // Earlier versions of this IDL incorrectly listed activity as a third
      // account, which caused Anchor's TypeScript client to fail client-side
      // validation on every trigger_inheritance call — the relayer could never
      // submit the transaction that flips vault.is_triggered = true.
      name:     "triggerInheritance";
      accounts: [
        { name: "caller"; isMut: true; isSigner: true  },
        { name: "vault";  isMut: true; isSigner: false },
      ];
      args: [];
    },
    {
      name:     "claimInheritance";
      accounts: [
        { name: "beneficiary";   isMut: true;  isSigner: true  },
        { name: "vault";         isMut: true;  isSigner: false },
        { name: "activity";      isMut: true;  isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false },
      ];
      args: [];
    },
    {
      name:     "emergencySweep";
      accounts: [
        { name: "caller";        isMut: true;  isSigner: true  },
        { name: "vault";         isMut: true;  isSigner: false },
        { name: "beneficiary";   isMut: true;  isSigner: false },
        { name: "covenant";      isMut: true;  isSigner: false },
        { name: "activity";      isMut: true;  isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false },
      ];
      args: [];
    },
    {
      name:     "closeOrphanedCovenant";
      accounts: [
        { name: "caller";   isMut: true;  isSigner: true  },
        { name: "vault";    isMut: false; isSigner: false },
        { name: "covenant"; isMut: true;  isSigner: false },
      ];
      args: [];
    },
  ];

  accounts: [
    {
      name: "vaultAccount";
      type: {
        kind: "struct";
        fields: [
          { name: "owner";                    type: "publicKey" },
          { name: "beneficiary";              type: "publicKey" },
          { name: "guardianCount";            type: "u8"        },
          { name: "mOfNThreshold";            type: "u8"        },
          { name: "inactivityThresholdSlots"; type: "u64"       },
          { name: "lastCheckInSlot";          type: "u64"       },
          { name: "createdSlot";              type: "u64"       },
          { name: "depositedLamports";        type: "u64"       },
          { name: "covenantCounter";          type: "u64"       },
          { name: "vaultIndex";               type: "u64"       },
          { name: "isTriggered";              type: "bool"      },
          { name: "isClaimed";                type: "bool"      },
          { name: "isEmergencySwept";         type: "bool"      },
          { name: "warning75Sent";            type: "bool"      },
          { name: "warning90Sent";            type: "bool"      },
          { name: "bump";                     type: "u8"        },
        ];
      };
    },
    {
      name: "activityAccount";
      type: {
        kind: "struct";
        fields: [
          { name: "vault";              type: "publicKey" },
          { name: "checkinCount";       type: "u64"       },
          { name: "sumOfIntervals";     type: "u64"       },
          { name: "lastInterval";       type: "u64"       },
          { name: "anomalyFlagged";     type: "bool"      },
          { name: "anomalyFlaggedSlot"; type: "u64"       },
          { name: "bump";               type: "u8"        },
        ];
      };
    },
    {
      name: "guardianAccount";
      type: {
        kind: "struct";
        fields: [
          { name: "vault";                 type: "publicKey" },
          { name: "guardian";              type: "publicKey" },
          { name: "isActive";              type: "bool"      },
          { name: "addedSlot";             type: "u64"       },
          { name: "removalRequestedSlot";  type: "u64"       },
          { name: "bump";                  type: "u8"        },
        ];
      };
    },
    {
      name: "covenantAccount";
      type: {
        kind: "struct";
        fields: [
          { name: "vault";                   type: "publicKey"                },
          { name: "covenantType";            type: { defined: "CovenantType" } },
          { name: "target";                  type: "publicKey"                },
          { name: "signers";                 type: { vec: "publicKey" }       },
          { name: "requiredSignatures";      type: "u8"                       },
          { name: "createdSlot";             type: "u64"                      },
          { name: "timelockSlots";           type: "u64"                      },
          { name: "signaturesCompleteSlot";  type: "u64"                      },
          { name: "covenantIndex";           type: "u64"                      },
          { name: "isExecuted";              type: "bool"                     },
          { name: "bump";                    type: "u8"                       },
        ];
      };
    },
  ];

  types: [
    {
      name: "CovenantType";
      type: {
        kind: "enum";
        variants: [
          { name: "EmergencySweep"    },
          { name: "BeneficiaryChange" },
          { name: "GuardianRemoval"   },
        ];
      };
    },
  ];

  // All 30 error codes from errors.rs in declaration order.
  // Anchor assigns codes starting at 6000; each variant index maps to
  // 6000 + index. GuardiansStillRegistered is variant 12 (code 6012),
  // which was previously missing, causing every subsequent code to be
  // off by one and the last five codes to be absent entirely.
  errors: [
    { code: 6000; name: "UnauthorisedOwner"            },
    { code: 6001; name: "UnauthorisedGuardian"          },
    { code: 6002; name: "UnauthorisedBeneficiary"       },
    { code: 6003; name: "VaultAlreadyTriggered"         },
    { code: 6004; name: "VaultNotTriggered"             },
    { code: 6005; name: "VaultAlreadyClaimed"           },
    { code: 6006; name: "VaultAlreadySwept"             },
    { code: 6007; name: "VaultNotEmpty"                 },
    { code: 6008; name: "ThresholdTooLow"               },
    { code: 6009; name: "ThresholdTooHigh"              },
    { code: 6010; name: "ThresholdNotReached"           },
    { code: 6011; name: "TooManyGuardians"              },
    { code: 6012; name: "GuardiansStillRegistered"      },
    { code: 6013; name: "GuardianVaultMismatch"         },
    { code: 6014; name: "GuardianAlreadyInactive"       },
    { code: 6015; name: "NoRemovalPending"              },
    { code: 6016; name: "RemovalTimelockActive"         },
    { code: 6017; name: "ThresholdExceedsGuardianCount" },
    { code: 6018; name: "ThresholdTooSmall"             },
    { code: 6019; name: "AlreadySigned"                 },
    { code: 6020; name: "CovenantAlreadyExecuted"       },
    { code: 6021; name: "InsufficientSignatures"        },
    { code: 6022; name: "CovenantTimelockActive"        },
    { code: 6023; name: "CovenantTypeMismatch"          },
    { code: 6024; name: "CovenantVaultMismatch"         },
    { code: 6025; name: "AnomalyAlreadyFlagged"         },
    { code: 6026; name: "InvalidBeneficiary"            },
    { code: 6027; name: "ZeroAmount"                    },
    { code: 6028; name: "SameSlotCheckIn"               },
    { code: 6029; name: "MathOverflow"                  },
  ];
};
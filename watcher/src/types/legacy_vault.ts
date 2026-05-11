// watcher/src/types/legacy_vault.ts
//
// Anchor IDL type for the Legacy Vault program (v2 — Cloak integration).
// Updated from the pre-Cloak IDL to include:
//   - record_cloak_deposit instruction (new)
//   - record_cloak_claim instruction (new)
//   - initialize_vault now takes beneficiary_utxo_pubkey bytes instead of a Pubkey account
//   - VaultAccount now has beneficiary_utxo_pubkey, utxo_commitment, utxo_leaf_index fields

export type LegacyVault = {
  version: "0.1.0";
  name:    "legacy_vault";

  instructions: [
    {
      name:     "initializeVault";
      accounts: [
        { name: "owner";          isMut: true;  isSigner: true  },
        { name: "vault";          isMut: true;  isSigner: false },
        { name: "activity";       isMut: true;  isSigner: false },
        { name: "systemProgram";  isMut: false; isSigner: false },
      ];
      args: [
        { name: "vaultIndex";               type: "u64" },
        { name: "inactivityThresholdSlots"; type: "u64" },
        { name: "beneficiaryUtxoPubkey";    type: { array: ["u8", 32] } },
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
    {
      // NEW — Cloak integration
      name:     "recordCloakDeposit";
      accounts: [
        { name: "owner"; isMut: true; isSigner: true  },
        { name: "vault"; isMut: true; isSigner: false },
      ];
      args: [
        { name: "utxoCommitment";   type: { array: ["u8", 32] } },
        { name: "utxoLeafIndex";    type: "u64" },
        { name: "shieldedLamports"; type: "u64" },
      ];
    },
    {
      // NEW — Cloak integration (permissionless)
      name:     "recordCloakClaim";
      accounts: [
        { name: "caller";        isMut: true; isSigner: true  },
        { name: "vault";         isMut: true; isSigner: false },
        { name: "activity";      isMut: true; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false },
      ];
      args: [
        { name: "cloakTransferSignature"; type: { array: ["u8", 64] } },
      ];
    },
  ];

  accounts: [
    {
      name: "vaultAccount";
      type: {
        kind: "struct";
        fields: [
          { name: "owner";                    type: "publicKey"              },
          { name: "beneficiaryUtxoPubkey";    type: { array: ["u8", 32] }   },
          { name: "guardianCount";            type: "u8"                     },
          { name: "mOfNThreshold";            type: "u8"                     },
          { name: "inactivityThresholdSlots"; type: "u64"                    },
          { name: "lastCheckInSlot";          type: "u64"                    },
          { name: "createdSlot";              type: "u64"                    },
          { name: "depositedLamports";        type: "u64"                    },
          { name: "covenantCounter";          type: "u64"                    },
          { name: "vaultIndex";               type: "u64"                    },
          { name: "utxoCommitment";           type: { array: ["u8", 32] }   },
          { name: "utxoLeafIndex";            type: "u64"                    },
          { name: "isTriggered";              type: "bool"                   },
          { name: "isClaimed";                type: "bool"                   },
          { name: "isEmergencySwept";         type: "bool"                   },
          { name: "warning75Sent";            type: "bool"                   },
          { name: "warning90Sent";            type: "bool"                   },
          { name: "bump";                     type: "u8"                     },
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

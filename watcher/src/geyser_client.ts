// watcher/src/geyser_client.ts
//
// Manages the Yellowstone Geyser gRPC stream connection. This module is the
// sole owner of the gRPC channel and stream lifecycle.
//
// Design:
//   1. Transport-only: delivers raw bytes and slot numbers. No business logic.
//   2. Reconnect resilience: exponential backoff + full snapshot on every
//      (re)connect so no update is permanently missed.
//   3. Snapshot-first: every (re)connect begins with getProgramAccounts via
//      RPC to close the gap between stream termination and resumption.
//   4. Metrics: increments geyserReconnects on every reconnect attempt.

import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdateAccount,
  SubscribeUpdateSlot,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { logger }                from "./logger";
import { incGeyserReconnects }   from "./metrics";

export interface GeyserHandlers {
  /**
   * Called for every account update and for every account in the snapshot.
   * data is null when the account has been closed (lamports == 0 / no data).
   */
  onAccountUpdate: (
    pubkey:   string,
    data:     Buffer | null,
    slot:     bigint,
    lamports: bigint,
  ) => void;

  /**
   * Called after every snapshot is fully delivered. The set contains the
   * base58 pubkeys of every program-owned account seen in the snapshot.
   */
  onSnapshotComplete: (seenPubkeys: ReadonlySet<string>) => void;

  /** Called for every slot notification from the stream (~400 ms). */
  onSlot: (slot: bigint) => void;
}

let isGeyserRunning = false;
let activeClient: Client | null = null;

export async function startGeyserClient(
  geyserEndpoint: string,
  xToken:         string,
  programId:      string,
  connection:     Connection,
  handlers:       GeyserHandlers,
): Promise<void> {
  isGeyserRunning = true;

  let backoffMs = 1_000;

  logger.info({ geyserEndpoint, programId }, "Geyser client starting");

  while (isGeyserRunning) {
    let client: Client | null = null;

    try {
      // Snapshot closes the gap window between the previous stream's
      // termination and this stream's first update.
      await snapshotAllProgramAccounts(connection, programId, handlers);

      client = new Client(geyserEndpoint, xToken, {
        "grpc.keepalive_time_ms":              10_000,
        "grpc.keepalive_timeout_ms":            5_000,
        "grpc.keepalive_permit_without_calls":      1,
      });
      activeClient = client;

      const stream = await client.subscribe();

      const request: SubscribeRequest = {
        accounts: {
          watcher_accounts: {
            account: [],
            owner:   [programId],
            filters: [],
          },
        },
        slots: {
          watcher_slots: {},
        },
        transactions:        {},
        transactionsStatus:  {},
        blocks:              {},
        blocksMeta:          {},
        accountsDataSlice:   [],
        commitment:          CommitmentLevel.CONFIRMED,
        entry:               {},
        ping:                undefined,
      };

      await new Promise<void>((resolve, reject) => {
        stream.write(request, (writeErr: Error | null | undefined) => {
          if (writeErr) {
            reject(new Error(`Geyser subscribe write failed: ${writeErr.message}`));
          }
        });

        stream.on("data", (update: SubscribeUpdate) => {
          try {
            dispatchUpdate(update, handlers);
          } catch (dispatchErr) {
            logger.error({ err: dispatchErr }, "Error dispatching Geyser update");
          }
        });

        stream.on("error", (err: Error) => {
          logger.error({ err }, "Geyser stream error");
          reject(err);
        });

        stream.on("end", () => {
          logger.warn("Geyser stream ended — will reconnect");
          resolve();
        });

        stream.on("close", () => {
          logger.warn("Geyser stream closed — will reconnect");
          resolve();
        });
      });

      // Successful session — reset backoff for the next reconnect.
      backoffMs = 1_000;

    } catch (err) {
      if (!isGeyserRunning) break;

      incGeyserReconnects();
      logger.error(
        { err, nextRetryMs: backoffMs },
        "Geyser stream failed — reconnecting after backoff",
      );

      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);

    } finally {
      if (activeClient === client && client !== null) {
        try { ( client as any).close(); } catch (_) {}
        activeClient = null;
      }
    }
  }

  logger.info("Geyser client stopped cleanly");
}

export function stopGeyserClient(): void {
  isGeyserRunning = false;
  if (activeClient !== null) {
    try { (activeClient as any).close(); } catch (_) {}
    activeClient = null;
  }
}

async function snapshotAllProgramAccounts(
  connection: Connection,
  programId:  string,
  handlers:   GeyserHandlers,
): Promise<void> {
  logger.info({ programId }, "Taking program account snapshot via RPC");

  try {
    const currentSlot = BigInt(await connection.getSlot("confirmed"));

    const accounts = await connection.getProgramAccounts(
      new PublicKey(programId),
      { commitment: "confirmed" },
    );

    logger.info(
      { count: accounts.length, slot: currentSlot.toString() },
      "Snapshot fetched — processing accounts",
    );

    const seenPubkeys = new Set<string>();

    for (const { pubkey, account } of accounts) {
      const pubkeyStr = pubkey.toBase58();
      seenPubkeys.add(pubkeyStr);

      handlers.onAccountUpdate(
        pubkeyStr,
        Buffer.from(account.data),
        currentSlot,
        BigInt(account.lamports),
      );
    }

    handlers.onSnapshotComplete(seenPubkeys);
    logger.info({ count: seenPubkeys.size }, "Snapshot complete");

  } catch (err) {
    logger.error(
      { err },
      "Snapshot failed — continuing with existing DB state; next reconnect will retry",
    );
    // Pass empty set: do NOT deactivate vaults on a failed snapshot since we
    // have no evidence they are gone.
    handlers.onSnapshotComplete(new Set());
  }
}

function dispatchUpdate(update: SubscribeUpdate, handlers: GeyserHandlers): void {
  if (update.account) {
    dispatchAccountUpdate(update.account, handlers);
  } else if (update.slot) {
    dispatchSlotUpdate(update.slot, handlers);
  }
}

function dispatchAccountUpdate(
  update:   SubscribeUpdateAccount,
  handlers: GeyserHandlers,
): void {
  const account = update.account;
  if (!account) return;

  const pubkey   = new PublicKey(account.pubkey).toBase58();
  const slot     = BigInt(update.slot ?? 0n);
  const lamports = BigInt(account.lamports ?? 0n);

  const data =
    account.data && account.data.length > 0
      ? Buffer.from(account.data)
      : null;

  handlers.onAccountUpdate(pubkey, data, slot, lamports);
}

function dispatchSlotUpdate(
  update:   SubscribeUpdateSlot,
  handlers: GeyserHandlers,
): void {
  if (update.slot) {
    handlers.onSlot(BigInt(update.slot));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

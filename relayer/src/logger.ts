// relayer/src/logger.ts
//
// Identical in structure to watcher/src/logger.ts. Each service carries its
// own logger instance so they can be configured independently (e.g., different
// log levels for watcher vs relayer) and so there is no import dependency
// between the two services.

import pino from "pino";

/**
 * Singleton pino logger for the relayer service.
 * Level is controlled by LOG_LEVEL environment variable.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",

  timestamp: pino.stdTimeFunctions.isoTime,

  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target:  "pino-pretty",
          options: {
            colorize:      true,
            translateTime: "SYS:standard",
            ignore:        "pid,hostname",
            messageFormat: "{msg}",
          },
        }
      : undefined,
});

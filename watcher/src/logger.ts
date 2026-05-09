// watcher/src/logger.ts
//
// Centralised structured logger for the entire watcher service.

import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target:  "pino-pretty",
          options: {
            colorize:        true,
            translateTime:   "SYS:standard",
            ignore:          "pid,hostname",
            messageFormat:   "{msg}",
          },
        }
      : undefined,
});

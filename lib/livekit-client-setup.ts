"use client";

import { getLogger, LoggerNames } from "livekit-client";

let configured = false;

type LiveKitLogger = ReturnType<typeof getLogger>;

function downgradeTransientConnectionErrors(logger: LiveKitLogger) {
  const originalError = logger.error.bind(logger);

  logger.error = (msg: string, context?: object) => {
    const rawMessage = msg as unknown;
    const nestedError = (context as { error?: unknown } | undefined)?.error;
    const text =
      rawMessage instanceof Error
        ? rawMessage.message
        : nestedError instanceof Error
          ? nestedError.message
          : typeof rawMessage === "string"
            ? rawMessage
            : String(rawMessage);

    if (text.toLowerCase().includes("failed to fetch")) {
      logger.warn(text, context);
      return;
    }

    originalError(msg, context);
  };
}

/**
 * LiveKit RTCEngine logs transient negotiation failures via console.error.
 * Next.js dev overlay treats that as a fatal console error.
 */
export function ensureLiveKitClientSetup() {
  if (configured || typeof window === "undefined") {
    return;
  }

  configured = true;

  if (process.env.NODE_ENV !== "development") {
    return;
  }

  downgradeTransientConnectionErrors(getLogger(LoggerNames.Engine));
}

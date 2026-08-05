import { validateEmailMessageId } from "@/lib/email/canary";

export class EmailOperationalCliArgumentError extends Error {
  constructor(
    public readonly code:
      | "CANARY_MESSAGE_ID_REQUIRED"
      | "CANARY_ARGUMENT_INVALID"
      | "QUARANTINE_ARGUMENT_INVALID"
      | "QUARANTINE_BATCH_SIZE_INVALID",
  ) {
    super(code);
    this.name = "EmailOperationalCliArgumentError";
  }
}

export function parseEmailCanaryArguments(args: string[]): {
  messageId: string;
} {
  let messageId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--message-id") {
      if (messageId !== undefined || index + 1 >= args.length) {
        throw new EmailOperationalCliArgumentError(
          "CANARY_ARGUMENT_INVALID",
        );
      }
      messageId = args[index + 1]!;
      index += 1;
    } else if (argument.startsWith("--message-id=")) {
      if (messageId !== undefined) {
        throw new EmailOperationalCliArgumentError(
          "CANARY_ARGUMENT_INVALID",
        );
      }
      messageId = argument.slice("--message-id=".length);
    } else {
      throw new EmailOperationalCliArgumentError("CANARY_ARGUMENT_INVALID");
    }
  }
  if (messageId === undefined) {
    throw new EmailOperationalCliArgumentError(
      "CANARY_MESSAGE_ID_REQUIRED",
    );
  }
  try {
    return { messageId: validateEmailMessageId(messageId) };
  } catch {
    throw new EmailOperationalCliArgumentError("CANARY_ARGUMENT_INVALID");
  }
}

export function parsePasswordResetQuarantineArguments(args: string[]): {
  apply: boolean;
  limit: number;
} {
  let apply = false;
  let batchSize: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--apply") {
      if (apply) {
        throw new EmailOperationalCliArgumentError(
          "QUARANTINE_ARGUMENT_INVALID",
        );
      }
      apply = true;
    } else if (argument === "--batch-size") {
      if (batchSize !== undefined || index + 1 >= args.length) {
        throw new EmailOperationalCliArgumentError(
          "QUARANTINE_ARGUMENT_INVALID",
        );
      }
      batchSize = args[index + 1]!;
      index += 1;
    } else if (argument.startsWith("--batch-size=")) {
      if (batchSize !== undefined) {
        throw new EmailOperationalCliArgumentError(
          "QUARANTINE_ARGUMENT_INVALID",
        );
      }
      batchSize = argument.slice("--batch-size=".length);
    } else {
      throw new EmailOperationalCliArgumentError(
        "QUARANTINE_ARGUMENT_INVALID",
      );
    }
  }

  const limit = batchSize === undefined ? 100 : Number(batchSize);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new EmailOperationalCliArgumentError(
      "QUARANTINE_BATCH_SIZE_INVALID",
    );
  }
  return { apply, limit };
}

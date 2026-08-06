import {
  EmailProviderEventType,
  EmailSuppressionReason,
} from "@/app/generated/prisma/client";
import type { NormalizedProviderEventInput } from "@/lib/email/types";

export class YandexPostboxProviderEventParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type JsonObject = Record<string, unknown>;

const MAX_STRING_LENGTH = 1024;
const MAX_ARRAY_LENGTH = 50;

function asObject(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new YandexPostboxProviderEventParseError(
      "INVALID_OBJECT",
      `${field} must be an object.`,
    );
  }
  return value as JsonObject;
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new YandexPostboxProviderEventParseError(
      "INVALID_STRING",
      `${field} must be a string.`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_STRING_LENGTH) {
    throw new YandexPostboxProviderEventParseError(
      "INVALID_STRING",
      `${field} must be a non-empty bounded string.`,
    );
  }
  return trimmed;
}

function boundedOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_STRING_LENGTH);
}

function boundedStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, MAX_ARRAY_LENGTH)
    .map((item) => boundedOptionalString(item))
    .filter((item): item is string => Boolean(item));
}

function parseEventTime(value: unknown): Date {
  const raw = boundedString(value, "mail.timestamp");
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new YandexPostboxProviderEventParseError(
      "INVALID_TIMESTAMP",
      "mail.timestamp must be a valid timestamp.",
    );
  }
  return parsed;
}

function parseJsonPayload(payload: string | Uint8Array, maxPayloadBytes: number): JsonObject {
  const bytes =
    typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.byteLength;
  if (bytes > maxPayloadBytes) {
    throw new YandexPostboxProviderEventParseError(
      "PAYLOAD_TOO_LARGE",
      "Provider event payload exceeds the configured size limit.",
    );
  }

  const text =
    typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new YandexPostboxProviderEventParseError(
      "MALFORMED_JSON",
      "Provider event payload is not valid JSON.",
    );
  }
  return asObject(parsed, "root");
}

function requireObject(root: JsonObject, key: string): JsonObject {
  return asObject(root[key], key);
}

function classifyBounce(bounce: JsonObject): {
  suppressionReason: EmailSuppressionReason | null;
  bounceClass: "permanent" | "transient" | "unknown";
} {
  const rawType = boundedOptionalString(bounce.bounceType)?.toLowerCase();
  const rawSubType = boundedOptionalString(bounce.bounceSubType)?.toLowerCase();
  if (
    rawType === "permanent" ||
    rawType === "hard" ||
    rawSubType === "general" ||
    rawSubType === "noemail"
  ) {
    return {
      suppressionReason: EmailSuppressionReason.HARD_BOUNCE,
      bounceClass: "permanent",
    };
  }
  if (
    rawType === "transient" ||
    rawType === "soft" ||
    rawSubType === "mailboxfull" ||
    rawSubType === "messagecontentrejected" ||
    rawSubType === "attachmentrejected"
  ) {
    return { suppressionReason: null, bounceClass: "transient" };
  }
  return { suppressionReason: null, bounceClass: "unknown" };
}

export function parseYandexPostboxProviderEvent(
  payload: string | Uint8Array,
  options: { maxPayloadBytes: number },
): NormalizedProviderEventInput {
  const root = parseJsonPayload(payload, options.maxPayloadBytes);
  const providerEventId = boundedString(root.eventId, "eventId");
  const eventTypeRaw = boundedString(root.eventType, "eventType");
  const mail = requireObject(root, "mail");
  const providerMessageId = boundedString(mail.messageId, "mail.messageId");
  const eventTime = parseEventTime(mail.timestamp);

  const metadata: Record<string, unknown> = {
    yandexEventType: eventTypeRaw.slice(0, MAX_STRING_LENGTH),
  };
  let eventType: EmailProviderEventType;
  let suppressionReason: EmailSuppressionReason | null | undefined;

  switch (eventTypeRaw) {
    case "Send":
      requireObject(root, "send");
      eventType = EmailProviderEventType.ACCEPTED;
      break;
    case "Delivery":
      requireObject(root, "delivery");
      eventType = EmailProviderEventType.DELIVERED;
      break;
    case "DeliveryDelay":
      requireObject(root, "deliveryDelay");
      eventType = EmailProviderEventType.DELAYED;
      break;
    case "Bounce": {
      const bounce = requireObject(root, "bounce");
      const bounceClass = classifyBounce(bounce);
      eventType = EmailProviderEventType.BOUNCED;
      suppressionReason = bounceClass.suppressionReason;
      metadata.bounceClass = bounceClass.bounceClass;
      metadata.bounceType = boundedOptionalString(bounce.bounceType);
      metadata.bounceSubType = boundedOptionalString(bounce.bounceSubType);
      metadata.diagnosticCodes = boundedStringArray(bounce.diagnosticCodes);
      break;
    }
    case "Complaint": {
      const complaint = requireObject(root, "complaint");
      eventType = EmailProviderEventType.COMPLAINED;
      suppressionReason = EmailSuppressionReason.COMPLAINT;
      metadata.complaintFeedbackType = boundedOptionalString(
        complaint.complaintFeedbackType,
      );
      break;
    }
    case "Rendering Failure":
    case "RenderingFailure":
      requireObject(root, "failure");
      eventType = EmailProviderEventType.RENDERING_FAILED;
      break;
    default:
      eventType = EmailProviderEventType.UNKNOWN;
      metadata.disposition = "unsupported_event_type";
      break;
  }

  return {
    provider: "yandex_postbox",
    providerEventId,
    providerMessageId,
    eventType,
    eventTime,
    metadata,
    ...(suppressionReason !== undefined ? { suppressionReason } : {}),
  };
}

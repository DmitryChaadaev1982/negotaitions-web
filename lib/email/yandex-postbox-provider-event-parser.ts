import {
  EmailProviderEventSuppressionDisposition,
  EmailProviderEventType,
} from "@/app/generated/prisma/client";
import type { NormalizedProviderEventInput } from "@/lib/email/types";

export class YandexPostboxProviderEventParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "YandexPostboxProviderEventParseError";
  }
}

type JsonObject = Record<string, unknown>;

const MAX_STRING_LENGTH = 1024;

/**
 * Provider-controlled strings are never persisted verbatim. Each provider field
 * is reduced to one of these allowlisted tokens so recipient addresses, SMTP
 * response text, and other attacker-influenced content cannot reach metadata.
 */
const BOUNCE_TYPE_TOKENS = ["permanent", "transient", "undetermined"] as const;

const BOUNCE_SUBTYPE_TOKENS = [
  "undetermined",
  "general",
  "noemail",
  "suppressed",
  "onaccountsuppressionlist",
  "mailboxfull",
  "messagetoolarge",
  "contentrejected",
  "messagecontentrejected",
  "attachmentrejected",
] as const;

const COMPLAINT_FEEDBACK_TOKENS = [
  "abuse",
  "auth-failure",
  "fraud",
  "not-spam",
  "other",
  "virus",
] as const;

const SUPPORTED_EVENT_TYPES = [
  "Send",
  "Delivery",
  "DeliveryDelay",
  "Bounce",
  "Complaint",
  "Rendering Failure",
  "RenderingFailure",
] as const;

const OTHER_TOKEN = "other";
const UNSUPPORTED_EVENT_TOKEN = "unsupported";

function allowlistToken(
  value: string | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : OTHER_TOKEN;
}

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

function optionalRawString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_STRING_LENGTH) : undefined;
}

function boundedCount(value: unknown, max = 50): number {
  if (!Array.isArray(value)) return 0;
  return Math.min(value.length, max);
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

function decodeUtf8Strict(payload: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    throw new YandexPostboxProviderEventParseError(
      "INVALID_ENCODING",
      "Provider event payload is not valid UTF-8.",
    );
  }
}

function parseJsonPayload(
  payload: string | Uint8Array,
  maxPayloadBytes: number,
): JsonObject {
  const bytes =
    typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.byteLength;
  if (bytes > maxPayloadBytes) {
    throw new YandexPostboxProviderEventParseError(
      "PAYLOAD_TOO_LARGE",
      "Provider event payload exceeds the configured size limit.",
    );
  }

  const text = typeof payload === "string" ? payload : decodeUtf8Strict(payload);
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

export type BounceClassification = {
  bounceClass: "permanent" | "transient" | "undetermined";
  disposition: EmailProviderEventSuppressionDisposition;
  bounceTypeToken: string;
  bounceSubTypeToken: string;
};

/**
 * bounceType is authoritative. bounceSubType is recorded for diagnostics only
 * and can never upgrade a bounce to permanent: `General`, `MailboxFull`,
 * `MessageTooLarge`, and `ContentRejected` all occur on transient bounces.
 */
export function classifyBounce(bounce: JsonObject): BounceClassification {
  const rawType = optionalRawString(bounce.bounceType)?.toLowerCase();
  const bounceTypeToken = allowlistToken(rawType, BOUNCE_TYPE_TOKENS, "undetermined");
  const bounceSubTypeToken = allowlistToken(
    optionalRawString(bounce.bounceSubType)?.toLowerCase(),
    BOUNCE_SUBTYPE_TOKENS,
    "undetermined",
  );

  if (rawType === "permanent" || rawType === "hard") {
    return {
      bounceClass: "permanent",
      disposition: EmailProviderEventSuppressionDisposition.HARD_BOUNCE,
      bounceTypeToken: "permanent",
      bounceSubTypeToken,
    };
  }

  if (rawType === "transient" || rawType === "soft") {
    return {
      bounceClass: "transient",
      disposition: EmailProviderEventSuppressionDisposition.NONE,
      bounceTypeToken: "transient",
      bounceSubTypeToken,
    };
  }

  // Undetermined or missing bounceType: no permanent suppression without
  // explicit durable provider evidence.
  return {
    bounceClass: "undetermined",
    disposition: EmailProviderEventSuppressionDisposition.NONE,
    bounceTypeToken,
    bounceSubTypeToken,
  };
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
    yandexEventType: (
      SUPPORTED_EVENT_TYPES as readonly string[]
    ).includes(eventTypeRaw)
      ? eventTypeRaw
      : UNSUPPORTED_EVENT_TOKEN,
  };

  let eventType: EmailProviderEventType;
  let suppressionDisposition: EmailProviderEventSuppressionDisposition =
    EmailProviderEventSuppressionDisposition.NONE;

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
      const classification = classifyBounce(bounce);
      eventType = EmailProviderEventType.BOUNCED;
      suppressionDisposition = classification.disposition;
      metadata.bounceClass = classification.bounceClass;
      metadata.bounceTypeToken = classification.bounceTypeToken;
      metadata.bounceSubTypeToken = classification.bounceSubTypeToken;
      // Only the count survives. Diagnostic codes routinely embed recipient
      // addresses and raw SMTP responses and are never persisted.
      metadata.diagnosticCodeCount = boundedCount(bounce.diagnosticCodes);
      break;
    }
    case "Complaint": {
      const complaint = requireObject(root, "complaint");
      eventType = EmailProviderEventType.COMPLAINED;
      suppressionDisposition =
        EmailProviderEventSuppressionDisposition.COMPLAINT;
      metadata.complaintFeedbackTypeToken = allowlistToken(
        optionalRawString(complaint.complaintFeedbackType),
        COMPLAINT_FEEDBACK_TOKENS,
        "undetermined",
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
    suppressionDisposition,
  };
}

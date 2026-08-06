import assert from "node:assert/strict";
import test from "node:test";

import {
  EmailProviderEventType,
  EmailSuppressionReason,
} from "@/app/generated/prisma/client";
import {
  parseYandexPostboxProviderEvent,
  YandexPostboxProviderEventParseError,
} from "@/lib/email/yandex-postbox-provider-event-parser";

const base = {
  eventId: "evt-1",
  mail: {
    messageId: "provider-message-1",
    timestamp: "2026-08-06T08:00:00.000Z",
  },
};

function parse(event: Record<string, unknown>) {
  return parseYandexPostboxProviderEvent(JSON.stringify(event), {
    maxPayloadBytes: 4096,
  });
}

test("maps supported Yandex Postbox events", () => {
  const cases = [
    [{ ...base, eventType: "Send", send: {} }, EmailProviderEventType.ACCEPTED],
    [
      { ...base, eventType: "Delivery", delivery: {} },
      EmailProviderEventType.DELIVERED,
    ],
    [
      { ...base, eventType: "DeliveryDelay", deliveryDelay: {} },
      EmailProviderEventType.DELAYED,
    ],
    [
      { ...base, eventType: "Complaint", complaint: {} },
      EmailProviderEventType.COMPLAINED,
    ],
    [
      { ...base, eventType: "Rendering Failure", failure: {} },
      EmailProviderEventType.RENDERING_FAILED,
    ],
  ] as const;

  for (const [input, expected] of cases) {
    const normalized = parse(input);
    assert.equal(normalized.provider, "yandex_postbox");
    assert.equal(normalized.providerEventId, "evt-1");
    assert.equal(normalized.providerMessageId, "provider-message-1");
    assert.equal(normalized.eventType, expected);
  }
});

test("distinguishes permanent and transient bounces", () => {
  const permanent = parse({
    ...base,
    eventType: "Bounce",
    bounce: { bounceType: "Permanent", bounceSubType: "General" },
  });
  assert.equal(permanent.eventType, EmailProviderEventType.BOUNCED);
  assert.equal(permanent.suppressionReason, EmailSuppressionReason.HARD_BOUNCE);
  assert.equal(permanent.metadata?.bounceClass, "permanent");

  const transient = parse({
    ...base,
    eventType: "Bounce",
    bounce: { bounceType: "Transient", bounceSubType: "MailboxFull" },
  });
  assert.equal(transient.eventType, EmailProviderEventType.BOUNCED);
  assert.equal(transient.suppressionReason, null);
  assert.equal(transient.metadata?.bounceClass, "transient");
});

test("unknown events are stable UNKNOWN records without mutation semantics", () => {
  const normalized = parse({
    ...base,
    eventType: "Open",
    open: { ipAddress: "192.0.2.1" },
  });
  assert.equal(normalized.eventType, EmailProviderEventType.UNKNOWN);
  assert.equal(normalized.metadata?.disposition, "unsupported_event_type");
});

test("rejects malformed, missing, invalid, and oversized payloads without leaking PII", () => {
  const cases: Array<[unknown, string]> = [
    [{ ...base, eventId: "", eventType: "Send", send: {} }, "INVALID_STRING"],
    [
      { ...base, mail: { timestamp: "2026-08-06T08:00:00.000Z" }, eventType: "Send", send: {} },
      "INVALID_STRING",
    ],
    [
      { ...base, mail: { messageId: "provider-message-1", timestamp: "not-a-date" }, eventType: "Send", send: {} },
      "INVALID_TIMESTAMP",
    ],
  ];

  for (const [input, code] of cases) {
    assert.throws(
      () => parse(input as Record<string, unknown>),
      (error: unknown) =>
        error instanceof YandexPostboxProviderEventParseError &&
        error.code === code &&
        !error.message.includes("user@example.com"),
    );
  }

  assert.throws(
    () =>
      parseYandexPostboxProviderEvent("{", {
        maxPayloadBytes: 4096,
      }),
    (error: unknown) =>
      error instanceof YandexPostboxProviderEventParseError &&
      error.code === "MALFORMED_JSON",
  );
  assert.throws(
    () =>
      parseYandexPostboxProviderEvent(
        JSON.stringify({
          ...base,
          eventType: "Delivery",
          delivery: {},
          destination: ["user@example.com"],
        }),
        { maxPayloadBytes: 10 },
      ),
    (error: unknown) =>
      error instanceof YandexPostboxProviderEventParseError &&
      error.code === "PAYLOAD_TOO_LARGE" &&
      !error.message.includes("user@example.com"),
  );
});

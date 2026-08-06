import assert from "node:assert/strict";
import test from "node:test";

import {
  EmailProviderEventSuppressionDisposition,
  EmailProviderEventType,
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

function parse(event: Record<string, unknown>, maxPayloadBytes = 4096) {
  return parseYandexPostboxProviderEvent(JSON.stringify(event), {
    maxPayloadBytes,
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

test("bounceType is authoritative and bounceSubType never proves permanence", () => {
  const cases: Array<[
    Record<string, unknown>,
    EmailProviderEventSuppressionDisposition,
    string,
  ]> = [
    [
      { bounceType: "Permanent", bounceSubType: "General" },
      EmailProviderEventSuppressionDisposition.HARD_BOUNCE,
      "permanent",
    ],
    [
      { bounceType: "Permanent", bounceSubType: "NoEmail" },
      EmailProviderEventSuppressionDisposition.HARD_BOUNCE,
      "permanent",
    ],
    // Every transient subtype below is treated as permanent by the pre-fix
    // classifier; none of them may create a hard-bounce suppression.
    [
      { bounceType: "Transient", bounceSubType: "General" },
      EmailProviderEventSuppressionDisposition.NONE,
      "transient",
    ],
    [
      { bounceType: "Transient", bounceSubType: "MailboxFull" },
      EmailProviderEventSuppressionDisposition.NONE,
      "transient",
    ],
    [
      { bounceType: "Transient", bounceSubType: "MessageTooLarge" },
      EmailProviderEventSuppressionDisposition.NONE,
      "transient",
    ],
    [
      { bounceType: "Transient", bounceSubType: "ContentRejected" },
      EmailProviderEventSuppressionDisposition.NONE,
      "transient",
    ],
    [
      { bounceType: "Undetermined", bounceSubType: "General" },
      EmailProviderEventSuppressionDisposition.NONE,
      "undetermined",
    ],
    // Missing bounceType must not be upgraded by the subtype alone.
    [
      { bounceSubType: "General" },
      EmailProviderEventSuppressionDisposition.NONE,
      "undetermined",
    ],
    [{}, EmailProviderEventSuppressionDisposition.NONE, "undetermined"],
  ];

  for (const [bounce, expectedDisposition, expectedClass] of cases) {
    const normalized = parse({ ...base, eventType: "Bounce", bounce });
    assert.equal(normalized.eventType, EmailProviderEventType.BOUNCED);
    assert.equal(
      normalized.suppressionDisposition,
      expectedDisposition,
      `bounce ${JSON.stringify(bounce)} produced the wrong disposition`,
    );
    assert.equal(normalized.metadata?.bounceClass, expectedClass);
  }
});

test("complaints keep complaint suppression with an allowlisted feedback token", () => {
  const normalized = parse({
    ...base,
    eventType: "Complaint",
    complaint: { complaintFeedbackType: "abuse" },
  });
  assert.equal(
    normalized.suppressionDisposition,
    EmailProviderEventSuppressionDisposition.COMPLAINT,
  );
  assert.equal(normalized.metadata?.complaintFeedbackTypeToken, "abuse");

  const hostile = parse({
    ...base,
    eventType: "Complaint",
    complaint: { complaintFeedbackType: "victim@example.com\r\nInjected: 1" },
  });
  assert.equal(hostile.metadata?.complaintFeedbackTypeToken, "other");
});

test("provider-controlled bounce diagnostics never reach metadata", () => {
  const hostile = parse(
    {
      ...base,
      eventType: "Bounce",
      bounce: {
        bounceType: "Transient",
        bounceSubType: "General",
        diagnosticCodes: [
          "smtp; 550 5.1.1 <victim@example.com>: Recipient address rejected",
          "smtp; 452 4.2.2 mailbox full\r\nX-Injected: yes",
          `smtp; 550 ${"A".repeat(20000)}`,
          "smtp; 550 \u0000\u0007\u001b[31mcontrol\u001b[0m",
        ],
      },
    },
    100_000,
  );

  const serialized = JSON.stringify(hostile.metadata);
  assert.equal(hostile.metadata?.diagnosticCodeCount, 4);
  assert.equal("diagnosticCodes" in (hostile.metadata ?? {}), false);
  assert.doesNotMatch(serialized, /victim@example\.com/);
  assert.doesNotMatch(serialized, /Recipient address rejected/);
  assert.doesNotMatch(serialized, /X-Injected/);
  assert.doesNotMatch(serialized, /AAAA/);
  assert.doesNotMatch(serialized, /\u001b/);
  assert.ok(serialized.length < 512);
});

test("provider event type and bounce tokens are allowlisted, not echoed", () => {
  const normalized = parse({
    ...base,
    eventType: "Bounce",
    bounce: {
      bounceType: "victim@example.com",
      bounceSubType: "\r\nInjected-Header: 1",
    },
  });
  assert.equal(normalized.metadata?.yandexEventType, "Bounce");
  assert.equal(normalized.metadata?.bounceTypeToken, "other");
  assert.equal(normalized.metadata?.bounceSubTypeToken, "other");

  const unsupported = parse({
    ...base,
    eventType: "Open victim@example.com",
    open: {},
  });
  assert.equal(unsupported.metadata?.yandexEventType, "unsupported");
  assert.doesNotMatch(JSON.stringify(unsupported.metadata), /victim@example\.com/);
});

test("non-UTF-8 payloads are deterministic encoding failures", () => {
  assert.throws(
    () =>
      parseYandexPostboxProviderEvent(Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]), {
        maxPayloadBytes: 4096,
      }),
    (error: unknown) =>
      error instanceof YandexPostboxProviderEventParseError &&
      error.code === "INVALID_ENCODING",
  );
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

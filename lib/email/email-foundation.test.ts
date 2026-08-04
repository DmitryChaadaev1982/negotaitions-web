import test from "node:test";
import assert from "node:assert/strict";

import {
  EmailMessageStatus,
  EmailMessageCategory,
  EmailProviderEventType,
  EmailSuppressionReason,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { classifyProviderError } from "@/lib/email/provider-error-classification";
import { evaluateProviderEventTransition } from "@/lib/email/provider-event-policy";
import { renderEmailTemplate } from "@/lib/email/renderer";
import { doesSuppressionApply } from "@/lib/email/suppression";
import { getTemplateKeys, getTemplateLocales, loadTemplate, validateTemplateRegistry } from "@/lib/email/templates";
import { calculateRetryAt } from "@/lib/email/worker";

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("email template registry loads all RU/EN templates", () => {
  const issues = validateTemplateRegistry();
  assert.deepEqual(issues, []);
  for (const locale of getTemplateLocales()) {
    for (const key of getTemplateKeys()) {
      const template = loadTemplate(key, locale);
      assert.equal(template.metadata.key, key);
      assert.equal(template.metadata.locale, locale);
      assert.match(template.metadata.version, /^\d+\.\d+\.\d+$/);
      if (key === "system-test") {
        assert.equal(template.metadata.runtimeEnabled, true);
      } else {
        assert.equal(template.metadata.runtimeEnabled, false);
      }
    }
  }
});

test("renderer escapes HTML variables and includes footer", () => {
  const rendered = renderEmailTemplate({
    key: "system-test",
    locale: "en",
    variables: {
      adminName: "<Admin>",
      generatedAt: "2026-08-04T08:00:00.000Z",
      canonicalBaseUrl: "https://negotaitions.ru",
      supportEmail: "support@negotaitions.ru",
      operatorName: "Operator <Name>",
      reason: "test",
    },
  });
  assert.match(rendered.htmlBody, /&lt;Admin&gt;/);
  assert.match(rendered.htmlBody, /Operator &lt;Name&gt;/);
  assert.match(rendered.textBody, /automated NegotAItions message/);
  assert.doesNotMatch(rendered.subject, /[\r\n]/);
});

test("renderer rejects missing, unknown, and unsafe URL variables", () => {
  const base = {
    adminName: "Admin",
    generatedAt: "2026-08-04T08:00:00.000Z",
    canonicalBaseUrl: "https://negotaitions.ru",
    supportEmail: "support@negotaitions.ru",
    operatorName: "Operator",
    reason: "test",
  };
  assert.throws(() =>
    renderEmailTemplate({
      key: "system-test",
      locale: "en",
      variables: { ...base, extra: "nope" },
    }),
  );
  assert.throws(() =>
    renderEmailTemplate({
      key: "system-test",
      locale: "en",
      variables: { ...base, canonicalBaseUrl: "javascript:alert(1)" },
    }),
  );
  assert.throws(() =>
    renderEmailTemplate({
      key: "system-test",
      locale: "en",
      variables: { ...base, supportEmail: "" },
    }),
  );
});

test("email config defaults are disabled and validates bounds", () => {
  const config = withEnv(
    {
      EMAIL_DELIVERY_ENABLED: undefined,
      EMAIL_PROVIDER: undefined,
      EMAIL_CANONICAL_BASE_URL: undefined,
      EMAIL_MAX_ATTEMPTS: undefined,
    },
    () => getEmailConfig(),
  );
  assert.equal(config.deliveryEnabled, false);
  assert.equal(config.provider, "disabled");
  assert.equal(config.maxAttempts, 5);

  assert.throws(() =>
    withEnv({ EMAIL_MAX_ATTEMPTS: "0" }, () => getEmailConfig()),
  );
  assert.throws(() =>
    withEnv({ EMAIL_CANONICAL_BASE_URL: "javascript:alert(1)" }, () =>
      getEmailConfig(),
    ),
  );
  assert.throws(() =>
    withEnv(
      {
        EMAIL_PROCESSING_LEASE_SECONDS: "60",
        EMAIL_PROVIDER_REQUEST_TIMEOUT_MS: "55000",
        EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS: "5",
      },
      () => getEmailConfig(),
    ),
  );
  assert.throws(() =>
    withEnv(
      {
        EMAIL_DELIVERY_ENABLED: "true",
        EMAIL_PROVIDER: "yandex_postbox",
        YANDEX_POSTBOX_ACCESS_KEY_ID: undefined,
        YANDEX_POSTBOX_SECRET_ACCESS_KEY: undefined,
      },
      () => getEmailConfig(),
    ),
  );
});

test("suppression policy is category-aware", () => {
  assert.equal(
    doesSuppressionApply(
      EmailSuppressionReason.HARD_BOUNCE,
      EmailMessageCategory.TRANSACTIONAL,
      null,
    ),
    true,
  );
  assert.equal(
    doesSuppressionApply(
      EmailSuppressionReason.HARD_BOUNCE,
      EmailMessageCategory.SECURITY,
      null,
    ),
    false,
  );
  assert.equal(
    doesSuppressionApply(
      EmailSuppressionReason.UNSUBSCRIBE,
      EmailMessageCategory.TRANSACTIONAL,
      null,
    ),
    false,
  );
  assert.equal(
    doesSuppressionApply(
      EmailSuppressionReason.UNSUBSCRIBE,
      EmailMessageCategory.MARKETING,
      null,
    ),
    true,
  );
});

test("retry calculation grows and remains bounded", () => {
  const now = new Date("2026-08-04T08:00:00.000Z");
  const config = withEnv(
    {
      EMAIL_RETRY_BASE_SECONDS: "60",
      EMAIL_RETRY_MAX_SECONDS: "43200",
    },
    () => getEmailConfig(),
  );
  const first = calculateRetryAt(1, now, config).getTime();
  const fifth = calculateRetryAt(5, now, config).getTime();
  const large = calculateRetryAt(20, now, config).getTime();
  assert.ok(first > now.getTime());
  assert.ok(fifth > first);
  assert.ok(large - now.getTime() <= 43200 * 1000 * 1.15);
});

test("provider error classifier uses structured fields and controlled messages", () => {
  const throttle = classifyProviderError(
    { name: "ThrottlingException", $metadata: { httpStatusCode: 429 }, $retryable: { throttling: true } },
    { requestDispatched: false },
  );
  assert.equal(throttle.category, "RETRYABLE_THROTTLE");
  assert.equal(throttle.retryable, true);
  assert.equal(throttle.acceptanceUnknown, false);
  assert.equal(throttle.normalizedCode, "PROVIDER_RETRYABLE_THROTTLE");

  const serverAfterDispatch = classifyProviderError(
    { name: "InternalFailure", $metadata: { httpStatusCode: 500 } },
    { requestDispatched: true },
  );
  assert.equal(serverAfterDispatch.category, "ACCEPTANCE_UNKNOWN");
  assert.equal(serverAfterDispatch.retryable, false);
  assert.equal(serverAfterDispatch.acceptanceUnknown, true);
  assert.equal(serverAfterDispatch.normalizedCode, "PROVIDER_ACCEPTANCE_UNKNOWN");

  const accessDenied = classifyProviderError(
    { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 }, message: "secret detail" },
    { requestDispatched: true },
  );
  assert.equal(accessDenied.category, "ACCESS_DENIED");
  assert.equal(accessDenied.sanitizedMessage, "Provider denied email sending authorization.");
  assert.doesNotMatch(accessDenied.sanitizedMessage, /secret detail/);
});

test("provider event policy prevents weaker and older downgrades", () => {
  const deliveredAt = new Date("2026-08-04T10:00:00.000Z");
  const later = new Date("2026-08-04T10:05:00.000Z");
  const older = new Date("2026-08-04T09:59:00.000Z");

  assert.deepEqual(
    evaluateProviderEventTransition({
      currentStatus: EmailMessageStatus.DELIVERED,
      lastProviderEventTime: deliveredAt,
      eventType: EmailProviderEventType.DELAYED,
      eventTime: later,
    }),
    {
      apply: false,
      resultCode: "WEAKER_EVENT_IGNORED",
      resultMessage: "Provider event would downgrade the message state.",
    },
  );

  assert.deepEqual(
    evaluateProviderEventTransition({
      currentStatus: EmailMessageStatus.DELIVERED,
      lastProviderEventTime: deliveredAt,
      eventType: EmailProviderEventType.BOUNCED,
      eventTime: later,
    }),
    {
      apply: true,
      nextStatus: EmailMessageStatus.BOUNCED,
      resultCode: "APPLIED",
      resultMessage: "Provider event transition applied.",
    },
  );

  assert.deepEqual(
    evaluateProviderEventTransition({
      currentStatus: EmailMessageStatus.BOUNCED,
      lastProviderEventTime: deliveredAt,
      eventType: EmailProviderEventType.DELIVERED,
      eventTime: later,
    }),
    {
      apply: false,
      resultCode: "WEAKER_EVENT_IGNORED",
      resultMessage: "Provider event would downgrade the message state.",
    },
  );

  assert.equal(
    evaluateProviderEventTransition({
      currentStatus: EmailMessageStatus.ACCEPTANCE_UNKNOWN,
      lastProviderEventTime: deliveredAt,
      eventType: EmailProviderEventType.ACCEPTED,
      eventTime: later,
    }).apply,
    true,
  );

  assert.equal(
    evaluateProviderEventTransition({
      currentStatus: EmailMessageStatus.ACCEPTED_BY_PROVIDER,
      lastProviderEventTime: deliveredAt,
      eventType: EmailProviderEventType.DELIVERED,
      eventTime: older,
    }).resultCode,
    "OLDER_EVENT_IGNORED",
  );

  assert.equal(
    evaluateProviderEventTransition({
      currentStatus: EmailMessageStatus.COMPLAINED,
      lastProviderEventTime: deliveredAt,
      eventType: EmailProviderEventType.DELIVERED,
      eventTime: later,
    }).resultCode,
    "TERMINAL_STATE_IGNORED",
  );
});

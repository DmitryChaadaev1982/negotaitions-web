import test from "node:test";
import assert from "node:assert/strict";

import {
  EmailMessageCategory,
  EmailSuppressionReason,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
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

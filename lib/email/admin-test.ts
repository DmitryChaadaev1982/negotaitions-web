import {
  EmailMessageCategory,
  EmailMessageType,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { enqueueEmail } from "@/lib/email/outbox";
import { renderEmailTemplate } from "@/lib/email/renderer";
import type { EmailLocale } from "@/lib/email/types";
import type { AuthUser } from "@/lib/auth";

function buildSystemTestVariables(user: AuthUser, locale: EmailLocale) {
  const config = getEmailConfig();
  return {
    adminName: user.name ?? user.email,
    generatedAt: new Date().toISOString(),
    canonicalBaseUrl: config.canonicalBaseUrl,
    supportEmail: config.replyTo.support,
    operatorName: config.operatorName,
    reason:
      locale === "ru"
        ? "административная проверка email foundation"
        : "administrative email foundation test",
  };
}

export function getAdminEmailTestPreview(user: AuthUser) {
  const config = getEmailConfig();
  const previews = (["ru", "en"] as EmailLocale[]).map((locale) => ({
    locale,
    ...renderEmailTemplate({
      key: "system-test",
      locale,
      variables: buildSystemTestVariables(user, locale),
    }),
  }));
  return {
    adminTestEnabled: config.adminTestEnabled,
    deliveryEnabled: config.deliveryEnabled,
    provider: config.provider,
    recipient: user.email,
    previews,
  };
}

export async function enqueueAdminEmailTest(user: AuthUser, locale: EmailLocale) {
  const config = getEmailConfig();
  if (!config.adminTestEnabled) {
    throw new Error("EMAIL_ADMIN_TEST_ENABLED is false.");
  }
  const requestKey = crypto.randomUUID();
  return enqueueEmail({
    messageType: EmailMessageType.SYSTEM_TEST,
    category: EmailMessageCategory.ADMIN_TEST,
    recipientEmail: user.email,
    userId: user.id,
    locale,
    templateKey: "system-test",
    variables: buildSystemTestVariables(user, locale),
    idempotencyKey: `admin-system-test:${user.id}:${requestKey}`,
    metadata: {
      source: "admin_email_foundation_test",
      requestKey,
      locale,
    },
  });
}

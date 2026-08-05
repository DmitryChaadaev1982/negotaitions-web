import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader } from "@/components/card";
import { EmailJournalRevealPanel } from "@/components/email-journal-reveal-panel";
import { requireActiveAdminUser } from "@/lib/auth";
import { getEmailJournalDetail } from "@/lib/email/admin-journal";
import { getServerDictionary, getServerLocale } from "@/lib/i18n/server";
import { translate, type TranslationKey } from "@/lib/i18n/translate";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function formatDateTime(locale: string, value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

export default async function AdminEmailJournalDetailPage({ params }: PageProps) {
  await requireActiveAdminUser("/admin/email");
  const { dictionary } = await getServerDictionary();
  const locale = await getServerLocale();
  const localeCode = locale === "ru" ? "ru-RU" : "en-US";
  const t = (key: TranslationKey) => translate(dictionary, key);
  const { id } = await params;
  const detail = await getEmailJournalDetail(id);
  if (!detail) notFound();

  return (
    <div className="space-y-6" data-testid="email-journal-detail">
      <Link
        href="/admin/email"
        className="text-sm text-cyan-300 hover:underline"
      >
        {t("admin.emailJournalBackToList")}
      </Link>

      <Card>
        <CardHeader>
          <h1 className="text-lg font-semibold text-slate-50">
            {detail.messageType}
          </h1>
          <p className="text-xs text-slate-500">{detail.id}</p>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-300 md:grid-cols-2">
          <div>
            {t("admin.emailJournalStatus")}: {detail.status}
          </div>
          <div>
            {t("admin.emailJournalProvider")}: {detail.provider}
          </div>
          <div>
            {t("admin.emailJournalRecipient")}: {detail.recipientMasked}
          </div>
          <div>
            {t("admin.emailJournalLocale")}: {detail.locale}
          </div>
          <div>
            {t("admin.emailJournalTemplateVersion")}: {detail.templateVersion}
          </div>
          <div>
            {t("admin.emailJournalAttempts")}: {detail.attemptCount}
          </div>
          <div>
            {t("admin.emailJournalCreated")}:{" "}
            {formatDateTime(localeCode, detail.createdAt)}
          </div>
          <div>
            {t("admin.emailJournalUpdated")}:{" "}
            {formatDateTime(localeCode, detail.updatedAt)}
          </div>
          <div>
            {t("admin.emailJournalLastAttempt")}:{" "}
            {formatDateTime(localeCode, detail.sentAt)}
          </div>
          <div>
            {t("admin.emailJournalNextRetry")}:{" "}
            {formatDateTime(localeCode, detail.nextAttemptAt)}
          </div>
          <div>
            {t("admin.emailJournalProviderMessageId")}:{" "}
            {detail.providerMessageIdMasked ?? "—"}
          </div>
          <div>
            {t("admin.emailJournalSuppressed")}:{" "}
            {detail.suppressed ? "yes" : "no"}
          </div>
          <div className="md:col-span-2">
            {t("admin.emailJournalFailure")}: {detail.failureSummary ?? "—"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("admin.emailJournalAttempts")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          {detail.attempts.length === 0 ? (
            <p className="text-slate-500">—</p>
          ) : (
            detail.attempts.map((attempt) => (
              <div
                key={attempt.attemptNumber}
                className="rounded-lg border border-slate-800 px-3 py-2"
              >
                #{attempt.attemptNumber} · {attempt.status} · {attempt.provider}
                {attempt.errorCode ? ` · ${attempt.errorCode}` : ""}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {detail.contentAvailable ? (
        <EmailJournalRevealPanel
          messageId={detail.id}
          revealLabel={t("admin.emailJournalReveal")}
          revealedLabel={t("admin.emailJournalRevealed")}
          unavailableLabel={t("admin.emailJournalContentUnavailable")}
          clearedLabel={t("admin.emailJournalContentCleared")}
          redactedNotice={t("admin.emailJournalRedactedNotice")}
        />
      ) : (
        <p className="text-sm text-slate-400">
          {detail.contentClearedAt
            ? t("admin.emailJournalContentCleared")
            : t("admin.emailJournalContentUnavailable")}
        </p>
      )}
    </div>
  );
}

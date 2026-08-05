import Link from "next/link";

import { EmailJournalRecipientSearch } from "@/components/email-journal-recipient-search";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableElement,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { requireActiveAdminUser } from "@/lib/auth";
import {
  EMAIL_JOURNAL_CURRENT_STATUSES,
  EMAIL_JOURNAL_DEFAULT_PAGE_SIZE,
  EMAIL_JOURNAL_PAGE_SIZES,
  listEmailJournal,
  parseEmailJournalListQuery,
} from "@/lib/email/admin-journal";
import { EmailMessageType } from "@/app/generated/prisma/client";
import { getServerDictionary, getServerLocale } from "@/lib/i18n/server";
import { translate, type TranslationKey } from "@/lib/i18n/translate";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatDateTime(locale: string, value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function buildHref(
  current: URLSearchParams,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/admin/email?${query}` : "/admin/email";
}

export default async function AdminEmailJournalPage({ searchParams }: PageProps) {
  await requireActiveAdminUser("/admin/email");
  const { dictionary } = await getServerDictionary();
  const locale = await getServerLocale();
  const localeCode = locale === "ru" ? "ru-RU" : "en-US";
  const t = (key: TranslationKey) => translate(dictionary, key);

  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const key of Object.keys(raw)) {
    const value = first(raw[key]);
    if (value != null && value !== "") params.set(key, value);
  }

  let list;
  let parseError: string | null = null;
  try {
    list = await listEmailJournal(parseEmailJournalListQuery(params));
  } catch (error) {
    parseError =
      error instanceof Error ? error.message : "Unable to load email journal.";
    list = {
      items: [],
      page: 1,
      pageSize: EMAIL_JOURNAL_DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 1,
    };
  }

  const adminNavClassName = (active: boolean) =>
    active
      ? "rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
      : "rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100";

  return (
    <div className="space-y-6" data-testid="email-journal-page">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin" className={adminNavClassName(false)}>
          {t("nav.admin")}
        </Link>
        <Link href="/admin/users" className={adminNavClassName(false)}>
          {t("admin.userManagement")}
        </Link>
        <Link href="/admin/email" className={adminNavClassName(true)}>
          {t("nav.adminEmail")}
        </Link>
        <Link href="/admin/counters" className={adminNavClassName(false)}>
          {t("admin.usageCounters")}
        </Link>
        <Link href="/admin/log" className={adminNavClassName(false)}>
          {t("admin.recentServiceEvents")}
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-slate-50">
          {t("admin.emailJournalTitle")}
        </h1>
      </div>

      <EmailJournalRecipientSearch
        labels={{
          search: t("admin.emailJournalSearch"),
          submit: t("common.view"),
          empty: t("admin.emailJournalEmpty"),
          error: t("admin.emailJournalEmpty"),
        }}
      />

      <form method="get" className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 md:grid-cols-4">
        <label className="md:col-span-2 text-sm text-slate-300">
          <span className="mb-1 block">{t("admin.emailJournalSearch")} (id)</span>
          <input
            name="q"
            defaultValue={params.get("q") ?? ""}
            maxLength={320}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1 block">{t("admin.emailJournalType")}</span>
          <select
            name="messageType"
            defaultValue={params.get("messageType") ?? ""}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          >
            <option value="">—</option>
            {Object.values(EmailMessageType).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1 block">{t("admin.emailJournalStatus")}</span>
          <select
            name="status"
            defaultValue={params.get("status") ?? ""}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          >
            <option value="">—</option>
            {EMAIL_JOURNAL_CURRENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1 block">{t("admin.emailJournalProvider")}</span>
          <input
            name="provider"
            defaultValue={params.get("provider") ?? ""}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1 block">{t("admin.emailJournalLocale")}</span>
          <select
            name="locale"
            defaultValue={params.get("locale") ?? ""}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          >
            <option value="">—</option>
            <option value="ru">ru</option>
            <option value="en">en</option>
          </select>
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1 block">pageSize</span>
          <select
            name="pageSize"
            defaultValue={params.get("pageSize") ?? String(EMAIL_JOURNAL_DEFAULT_PAGE_SIZE)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          >
            {EMAIL_JOURNAL_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100"
          >
            {t("common.view")}
          </button>
        </div>
      </form>

      {parseError ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {parseError}
        </p>
      ) : null}

      {list.items.length === 0 ? (
        <p className="text-sm text-slate-400" data-testid="email-journal-empty">
          {t("admin.emailJournalEmpty")}
        </p>
      ) : (
        <DataTable>
          <DataTableElement>
            <DataTableHead>
              <DataTableHeaderCell>{t("admin.emailJournalCreated")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("admin.emailJournalType")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("admin.emailJournalRecipient")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("admin.emailJournalStatus")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("admin.emailJournalProvider")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("admin.emailJournalAttempts")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("admin.emailJournalFailure")}</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {list.items.map((item) => (
                <DataTableRow key={item.id}>
                  <DataTableCell>
                    <Link
                      href={`/admin/email/${item.id}`}
                      className="text-cyan-300 hover:underline"
                      data-testid={`email-journal-row-${item.id}`}
                    >
                      {formatDateTime(localeCode, item.createdAt)}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    <div className="text-sm text-slate-200">{item.messageType}</div>
                    <div className="text-xs text-slate-500">
                      v{item.templateVersion} · {item.locale}
                    </div>
                  </DataTableCell>
                  <DataTableCell>{item.recipientMasked}</DataTableCell>
                  <DataTableCell>
                    <div>{item.status}</div>
                    {item.suppressed ? (
                      <div className="text-xs text-amber-300">
                        {t("admin.emailJournalSuppressed")}
                      </div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    <div>{item.provider}</div>
                    <div className="text-xs text-slate-500">
                      {item.providerMessageIdMasked ?? "—"}
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <div>{item.attemptCount}</div>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(localeCode, item.lastAttemptAt)}
                    </div>
                  </DataTableCell>
                  <DataTableCell className="max-w-[12rem] truncate text-xs text-slate-400">
                    {item.failureSummary ?? "—"}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableElement>
        </DataTable>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
        <span>
          {t("admin.emailJournalPage")} {list.page} / {list.totalPages}
        </span>
        {list.page > 1 ? (
          <Link
            href={buildHref(params, { page: String(list.page - 1) })}
            className="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800"
          >
            {t("admin.emailJournalPrevious")}
          </Link>
        ) : null}
        {list.page < list.totalPages ? (
          <Link
            href={buildHref(params, { page: String(list.page + 1) })}
            className="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800"
          >
            {t("admin.emailJournalNext")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

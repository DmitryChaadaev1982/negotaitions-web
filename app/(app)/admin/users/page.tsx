import Link from "next/link";

import { CompactAdminUserRowActions } from "@/components/admin-user-row-actions";
import { StatusBadge } from "@/components/badge";
import { DataTable, DataTableBody, DataTableCell, DataTableElement, DataTableHead, DataTableHeaderCell, DataTableRow } from "@/components/ui/data-table";
import { getServerDictionary, getServerLocale } from "@/lib/i18n/server";
import { translate, type TranslationKey } from "@/lib/i18n/translate";
import { parseAdminEmails } from "@/lib/auth/admin";
import { requireAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type FilterKey = "all" | "pending" | "active" | "rejected" | "blocked" | "admins";

type AdminUsersPageProps = {
  searchParams: Promise<{
    q?: string;
    filter?: string;
  }>;
};

function formatDateCompact(locale: string, value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(value);
}

function getFilter(value?: string): FilterKey {
  if (value === "pending") return "pending";
  if (value === "active") return "active";
  if (value === "rejected") return "rejected";
  if (value === "blocked") return "blocked";
  if (value === "admins") return "admins";
  return "all";
}

function getStatusBadgeVariant(status: string): "default" | "warning" | "success" | "danger" {
  if (status === "ACTIVE") return "success";
  if (status === "PENDING_APPROVAL") return "warning";
  if (status === "REJECTED" || status === "BLOCKED") return "danger";
  return "default";
}

function getStatusLabel(t: (key: TranslationKey) => string, status: string): string {
  if (status === "PENDING_APPROVAL") return t("admin.pendingApproval");
  if (status === "ACTIVE") return t("admin.active");
  if (status === "REJECTED") return t("admin.rejected");
  if (status === "BLOCKED") return t("admin.blocked");
  return status;
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const adminUser = await requireAdminUser("/admin/users");
  const { dictionary } = await getServerDictionary();
  const locale = await getServerLocale();
  const localeCode = locale === "ru" ? "ru-RU" : "en-US";
  const t = (key: TranslationKey) => translate(dictionary, key);

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const filter = getFilter(params.filter);
  const adminEmails = parseAdminEmails();

  const users = await prisma.user.findMany({
    where: {
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filter === "pending" ? { status: "PENDING_APPROVAL" } : {}),
      ...(filter === "active" ? { status: "ACTIVE" } : {}),
      ...(filter === "rejected" ? { status: "REJECTED" } : {}),
      ...(filter === "blocked" ? { status: "BLOCKED" } : {}),
      ...(filter === "admins" ? { globalRole: "ADMIN" } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      globalRole: true,
      createdAt: true,
      lastLoginAt: true,
      approvedAt: true,
    },
  });

  const effectiveAdminCount = (
    await prisma.user.findMany({
      select: { email: true, globalRole: true, status: true },
    })
  ).filter((user) => {
    const isBootstrap = adminEmails.includes(user.email.toLowerCase());
    const isRoleAdmin = user.globalRole === "ADMIN";
    const statusAllowed = user.status !== "BLOCKED" && user.status !== "REJECTED";
    return (isBootstrap || isRoleAdmin) && statusAllowed;
  }).length;

  const baseFilters: Array<{ key: FilterKey; label: string }> = [
    { key: "all", label: t("admin.allUsers") },
    { key: "pending", label: t("admin.pendingApproval") },
    { key: "active", label: t("admin.active") },
    { key: "rejected", label: t("admin.rejected") },
    { key: "blocked", label: t("admin.blocked") },
    { key: "admins", label: t("admin.admins") },
  ];

  return (
    <div className="space-y-6">
      {/* Admin private-data warning label */}
      <div
        data-testid="admin-private-data-warning"
        className="rounded-lg border border-amber-500/30 bg-amber-900/15 px-4 py-2.5 flex items-center gap-2"
      >
        <span className="text-amber-400 text-sm">⚠️</span>
        <p className="text-xs font-medium text-amber-200">{t("legal.privateRoleDataWarning")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">{t("admin.userManagement")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("admin.users")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            {t("nav.admin")}
          </Link>
          <Link
            href="/admin/users"
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
          >
            {t("admin.userManagement")}
          </Link>
        </div>
      </div>

      <form className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder={t("admin.searchUsers")}
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/40 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700"
          >
            {t("common.view")}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {baseFilters.map((item) => {
            const active = filter === item.key;
            const href = `/admin/users?filter=${item.key}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
            return (
              <Link
                key={item.key}
                href={href}
                className={
                  active
                    ? "rounded-full border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200"
                    : "rounded-full border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </form>

      {/* Compact table: name+email | status | role | created | actions */}
      <DataTable>
        <DataTableElement>
          <DataTableHead>
            <DataTableHeaderCell>{t("common.name")} / {t("auth.email")}</DataTableHeaderCell>
            <DataTableHeaderCell>{t("common.status")}</DataTableHeaderCell>
            <DataTableHeaderCell>{t("admin.systemRole")}</DataTableHeaderCell>
            <DataTableHeaderCell>{t("admin.created")}</DataTableHeaderCell>
            <DataTableHeaderCell>{t("common.actions")}</DataTableHeaderCell>
          </DataTableHead>
          <DataTableBody>
            {users.length === 0 ? (
              <DataTableRow>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-400">
                  {t("admin.noUsersFound")}
                </td>
              </DataTableRow>
            ) : (
              users.map((user) => {
                const isSelf = user.id === adminUser.id;
                const isBootstrapAdmin = adminEmails.includes(user.email.toLowerCase());
                const isEffectiveAdmin =
                  (user.globalRole === "ADMIN" || isBootstrapAdmin) &&
                  user.status !== "BLOCKED" &&
                  user.status !== "REJECTED";
                const wouldLeaveNoAdmin = isEffectiveAdmin && effectiveAdminCount <= 1;
                const isCurrentAdmin = user.globalRole === "ADMIN" || isBootstrapAdmin;

                const canReject = !isSelf && !wouldLeaveNoAdmin;
                const canBlock = !isSelf && !wouldLeaveNoAdmin;

                return (
                  <DataTableRow key={user.id}>
                    {/* Compact name + email cell */}
                    <DataTableCell>
                      <div className="font-medium text-slate-100 truncate max-w-[180px]">
                        {user.name?.trim() || <span className="text-slate-500 italic">—</span>}
                      </div>
                      <div className="text-xs text-slate-400 truncate max-w-[180px]">{user.email}</div>
                      {isBootstrapAdmin && (
                        <div className="mt-0.5 text-xs text-cyan-300">{t("admin.bootstrapAdmin")}</div>
                      )}
                    </DataTableCell>

                    <DataTableCell>
                      <StatusBadge variant={getStatusBadgeVariant(user.status)}>
                        {getStatusLabel(t, user.status)}
                      </StatusBadge>
                      {/* Secondary date info on hover / as subtext */}
                      {user.approvedAt && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          ✓ {formatDateCompact(localeCode, user.approvedAt)}
                        </div>
                      )}
                      {user.lastLoginAt && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          ↩ {formatDateCompact(localeCode, user.lastLoginAt)}
                        </div>
                      )}
                    </DataTableCell>

                    <DataTableCell>
                      <StatusBadge variant={isCurrentAdmin ? "info" : "default"}>
                        {isCurrentAdmin ? t("admin.administrator") : t("admin.user")}
                      </StatusBadge>
                    </DataTableCell>

                    <DataTableCell>
                      <span className="text-xs text-slate-400">
                        {formatDateCompact(localeCode, user.createdAt)}
                      </span>
                    </DataTableCell>

                    <DataTableCell>
                      <CompactAdminUserRowActions
                        userId={user.id}
                        userStatus={user.status}
                        isCurrentAdmin={isCurrentAdmin}
                        isBootstrapAdmin={isBootstrapAdmin}
                        isSelf={isSelf}
                        canReject={canReject}
                        canBlock={canBlock}
                        wouldLeaveNoAdmin={wouldLeaveNoAdmin}
                        labels={{
                          approve: t("admin.approve"),
                          reject: t("admin.reject"),
                          block: t("admin.block"),
                          unblock: t("admin.unblock"),
                          makeAdmin: t("admin.makeAdmin"),
                          removeAdmin: t("admin.removeAdmin"),
                          approvalComment: t("admin.approvalComment"),
                          confirmAction: t("admin.confirmAction"),
                          confirmUndoWarning: t("admin.actionCannotBeUndone"),
                          administrator: t("admin.administrator"),
                        }}
                      />
                    </DataTableCell>
                  </DataTableRow>
                );
              })
            )}
          </DataTableBody>
        </DataTableElement>
      </DataTable>
    </div>
  );
}

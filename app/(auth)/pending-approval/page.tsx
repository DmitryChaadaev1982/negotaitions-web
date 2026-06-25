import { redirect } from "next/navigation";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { BrandLogo } from "@/components/ui/brand-logo";
import { StatusPageNav } from "@/components/status-page-nav";
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function PendingApprovalPage() {
  const user = await getOptionalCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.status === "ACTIVE" || isAdmin(user)) {
    redirect("/dashboard");
  }

  if (user.status === "REJECTED") {
    redirect("/account/rejected");
  }

  if (user.status === "BLOCKED") {
    redirect("/account/blocked");
  }

  const locale = await getServerLocale();
  const d = getDictionary(locale);

  return (
    <div className="min-h-full flex flex-col">
      <header className="glass-header sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <BrandLogo size="md" href="/" />
          <StatusPageNav email={user.email} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/20">
            <svg
              className="h-8 w-8 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-50 mb-3">
            {d.auth.pendingTitle}
          </h1>
          <p className="text-slate-400 mb-8">
            {d.auth.pendingMessage}
          </p>

          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 text-left space-y-3 mb-8">
            {user.name && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{d.auth.pendingName}</span>
                <span className="text-slate-200 font-medium">{user.name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{d.auth.pendingEmail}</span>
              <span className="text-slate-200 font-medium">{user.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{d.auth.pendingStatus}</span>
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {d.auth.pendingStatusLabel}
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

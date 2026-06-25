import { redirect } from "next/navigation";

import { logoutUser } from "@/app/actions/auth";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { BrandLogo } from "@/components/ui/brand-logo";

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

  return (
    <div className="min-h-full flex flex-col">
      <header className="glass-header sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <BrandLogo size="md" href="/" />
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>{user.email}</span>
            <form action={logoutUser}>
              <button
                type="submit"
                className="text-slate-400 hover:text-slate-100 transition-colors"
              >
                Log out
              </button>
            </form>
          </div>
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
            Account pending approval
          </h1>
          <p className="text-slate-400 mb-8">
            Your account is waiting for administrator approval.
            <br />
            You will be able to use NegotAItions after approval.
          </p>

          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 text-left space-y-3 mb-8">
            {user.name && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Name</span>
                <span className="text-slate-200 font-medium">{user.name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Email</span>
              <span className="text-slate-200 font-medium">{user.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Status</span>
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Pending approval
              </span>
            </div>
          </div>

          <form action={logoutUser}>
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 transition-colors"
            >
              Log out
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

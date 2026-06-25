import { redirect } from "next/navigation";

import { logoutUser } from "@/app/actions/auth";
import { getOptionalCurrentUser } from "@/lib/auth";
import { BrandLogo } from "@/components/ui/brand-logo";

export const dynamic = "force-dynamic";

export default async function AccountRejectedPage() {
  const user = await getOptionalCurrentUser();

  if (!user) {
    redirect("/login");
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
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
            <svg
              className="h-8 w-8 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-50 mb-3">
            Account not approved
          </h1>
          <p className="text-slate-400 mb-8">
            Your account registration was not approved.
            <br />
            Please contact an administrator if you believe this is an error.
          </p>

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

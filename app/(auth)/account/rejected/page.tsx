import { redirect } from "next/navigation";

import { getOptionalCurrentUser } from "@/lib/auth";
import { BrandLogo } from "@/components/ui/brand-logo";
import { StatusPageNav } from "@/components/status-page-nav";
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function AccountRejectedPage() {
  const user = await getOptionalCurrentUser();

  if (!user) {
    redirect("/login");
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
            {d.auth.rejectedTitle}
          </h1>
          <p className="text-slate-400 mb-8">
            {d.auth.rejectedMessage}
          </p>
        </div>
      </main>
    </div>
  );
}

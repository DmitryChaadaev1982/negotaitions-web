import Link from "next/link";

import { logoutUser } from "@/app/actions/auth";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { getServerDictionary } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { AccountMenu } from "@/components/account-menu";

export async function AuthNav() {
  const user = await getOptionalCurrentUser();
  const { dictionary } = await getServerDictionary();
  const t = (key: Parameters<typeof translate>[1]) => translate(dictionary, key);

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
        >
          {t("auth.login")}
        </Link>
        <Link
          href="/register"
          className="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
        >
          {t("auth.register")}
        </Link>
      </div>
    );
  }

  const admin = isAdmin(user);
  const displayName = user.name?.trim() || user.email;

  if (user.status !== "ACTIVE" && !admin) {
    // Status pages (pending/rejected/blocked) — just show logout, no full menu
    return (
      <form action={logoutUser}>
        <button
          type="submit"
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
        >
          {t("auth.logout")}
        </button>
      </form>
    );
  }

  return <AccountMenu displayName={displayName} />;
}

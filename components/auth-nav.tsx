import Link from "next/link";

import { logoutUser } from "@/app/actions/auth";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export async function AuthNav() {
  const user = await getOptionalCurrentUser();

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
        >
          Log in
        </Link>
        <Link
          href="/register"
          className="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
        >
          Register
        </Link>
      </div>
    );
  }

  const admin = isAdmin(user);

  return (
    <div className="flex items-center gap-3">
      {(user.status === "ACTIVE" || admin) && (
        <span className="hidden sm:block text-sm text-slate-400 truncate max-w-[160px]">
          {user.name ?? user.email}
        </span>
      )}
      <form action={logoutUser}>
        <button
          type="submit"
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
        >
          Log out
        </button>
      </form>
    </div>
  );
}

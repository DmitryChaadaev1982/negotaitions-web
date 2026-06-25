import Link from "next/link";
import { redirect } from "next/navigation";

import { RejoinPageView } from "@/components/rejoin-page-view";
import { getOptionalCurrentUser } from "@/lib/auth";
import { getServerDictionary } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { getAccountRejoinTargets } from "@/lib/rejoin/account";

export const dynamic = "force-dynamic";

export default async function RejoinPage() {
  const user = await getOptionalCurrentUser();
  if (!user) {
    return <RejoinPageView />;
  }

  if (user.status === "PENDING_APPROVAL") {
    redirect("/pending-approval");
  }
  if (user.status === "REJECTED") {
    redirect("/account/rejected");
  }
  if (user.status === "BLOCKED") {
    redirect("/account/blocked");
  }

  const targets = await getAccountRejoinTargets(user);
  if (targets.length === 0) {
    redirect("/dashboard");
  }

  const roomTargets = targets.filter((target) => target.type === "room");
  if (roomTargets.length > 1) {
    const { dictionary } = await getServerDictionary();
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-100">
          {translate(dictionary, "dashboard.multipleActiveSessionsFound")}
        </h1>
        <p className="text-slate-400">{translate(dictionary, "dashboard.chooseWhereToContinue")}</p>
        <div className="space-y-3">
          {roomTargets.map((target) => (
            <Link
              key={target.href}
              href={target.href}
              className="block rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 hover:border-cyan-500/40"
            >
              <p className="font-semibold text-slate-100">{target.title}</p>
              <p className="text-sm text-slate-400">{target.subtitle}</p>
              <p className="text-xs text-slate-500">{`${target.role} · ${target.status}`}</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const primaryTarget =
    targets.find((target) => target.type === "room") ??
    targets.find((target) => target.type === "lobby") ??
    targets.find((target) => target.type === "materials");

  if (primaryTarget) {
    redirect(primaryTarget.href);
  }

  redirect("/dashboard");
}

import { AccountSettingsView } from "@/components/account-settings-view";
import { getServerDictionary } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const user = await requireActiveUser("/login");
  const { dictionary } = await getServerDictionary();
  const t = (key: Parameters<typeof translate>[1]) => translate(dictionary, key);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">
          {t("auth.accountSettings")}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{user.email}</p>
      </div>

      <AccountSettingsView
        currentName={user.name ?? ""}
        currentLocale={user.preferredLocale}
      />
    </div>
  );
}

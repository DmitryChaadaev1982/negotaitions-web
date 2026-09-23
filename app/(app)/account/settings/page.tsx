import { AccountSettingsView } from "@/components/account-settings-view";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const user = await requireActiveUser("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <AccountSettingsView
        email={user.email}
        currentName={user.name ?? ""}
        currentLocale={user.preferredLocale}
      />
    </div>
  );
}

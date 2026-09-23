import { redirect } from "next/navigation";

import { AccountStatusPanel } from "@/components/account-status-panel";
import { getOptionalCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountRejectedPage() {
  const user = await getOptionalCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return <AccountStatusPanel variant="rejected" email={user.email} />;
}

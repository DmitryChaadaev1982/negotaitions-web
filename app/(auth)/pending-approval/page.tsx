import { redirect } from "next/navigation";

import { AccountStatusPanel } from "@/components/account-status-panel";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

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
    <AccountStatusPanel
      variant="pending"
      email={user.email}
      name={user.name}
    />
  );
}

import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { NewCasePage as NewCasePageClient } from "./new-case-page-client";

export const dynamic = "force-dynamic";

export default async function NewCasePage() {
  const user = await requireActiveUser("/cases/new");
  const canAssignOwner = isAdmin(user);

  const activeUsers = canAssignOwner
    ? await prisma.user.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      })
    : [];

  return (
    <NewCasePageClient
      currentUserId={user.id}
      currentUserEmail={user.email}
      activeUsers={activeUsers}
      canAssignOwner={canAssignOwner}
    />
  );
}

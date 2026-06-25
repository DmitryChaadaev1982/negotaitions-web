import { notFound, redirect } from "next/navigation";

import { requireActiveUser } from "@/lib/auth";
import { resolveJoinTokenForAccountSession } from "@/lib/account-session-access";

type SessionMaterialsAccountPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function SessionMaterialsAccountPage({
  params,
}: SessionMaterialsAccountPageProps) {
  const { id } = await params;
  const user = await requireActiveUser(`/sessions/${id}/materials`);
  const joinToken = await resolveJoinTokenForAccountSession(id, user);

  if (!joinToken) {
    notFound();
  }

  redirect(`/join/${joinToken}`);
}

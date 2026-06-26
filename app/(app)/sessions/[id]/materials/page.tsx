import { notFound } from "next/navigation";

import { AccountSessionMaterialsView } from "@/components/account-session-materials-view";
import { requireActiveUser } from "@/lib/auth";
import { getAccountMaterialsData } from "@/lib/account-session-materials";

type SessionMaterialsAccountPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

/**
 * Account-authorized materials page for /sessions/[id]/materials.
 *
 * Access is validated by userId relation (no joinToken required or exposed).
 * The joinToken is resolved server-side only and never appears in:
 *   - browser URL / history
 *   - HTTP Location / Redirect header
 *   - HTML response body / client props
 *
 * Legacy /join/[joinToken] links now require login, bind once server-side, and
 * redirect here so session materials stay account-authorized.
 */
export default async function SessionMaterialsAccountPage({
  params,
}: SessionMaterialsAccountPageProps) {
  const { id } = await params;
  const user = await requireActiveUser(`/sessions/${id}/materials`);
  const data = await getAccountMaterialsData(id, user);

  if (!data) {
    notFound();
  }

  return <AccountSessionMaterialsView {...data} />;
}

import { notFound } from "next/navigation";

import { ObserverSessionMaterialsView } from "@/components/observer-session-materials-view";
import { requireActiveUser } from "@/lib/auth";
import { getObserverSessionMaterialsData } from "@/lib/observer-session-materials";

type ObserverSessionMaterialsPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function ObserverSessionMaterialsPage({
  params,
}: ObserverSessionMaterialsPageProps) {
  const { id } = await params;
  const user = await requireActiveUser(`/sessions/${id}/observer-materials`);
  const data = await getObserverSessionMaterialsData(id, user);
  if (!data) {
    notFound();
  }
  return <ObserverSessionMaterialsView {...data} />;
}

import { AdminDiagnosticsView } from "@/components/admin-diagnostics-view";
import { requireAdminUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminCountersPage() {
  await requireAdminUser();
  return <AdminDiagnosticsView mode="counters" />;
}

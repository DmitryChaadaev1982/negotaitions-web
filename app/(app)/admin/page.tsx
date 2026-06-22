import { AdminDiagnosticsView } from "@/components/admin-diagnostics-view";
import { getDemoFacilitator } from "@/lib/demo-user";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await getDemoFacilitator();
  return <AdminDiagnosticsView />;
}

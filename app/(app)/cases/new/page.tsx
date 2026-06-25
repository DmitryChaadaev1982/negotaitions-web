import { requireActiveUser } from "@/lib/auth";
import { NewCasePage as NewCasePageClient } from "./new-case-page-client";

export const dynamic = "force-dynamic";

export default async function NewCasePage() {
  await requireActiveUser("/cases/new");
  return <NewCasePageClient />;
}

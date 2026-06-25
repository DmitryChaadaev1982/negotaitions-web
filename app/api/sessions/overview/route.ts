import { NextResponse } from "next/server";

import { getSessionOverviewStats } from "@/lib/session-overview-stats";
import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  // Non-admin users: return empty list until user binding is implemented (Phase C).
  // TODO: Scope to user's own sessions once Session.facilitatorId is user-bound.
  if (!isAdmin(user!)) {
    return NextResponse.json({ sessions: [] });
  }

  const sessions = await getSessionOverviewStats();

  return NextResponse.json({ sessions });
}

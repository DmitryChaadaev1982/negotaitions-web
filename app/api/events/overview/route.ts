import { NextResponse } from "next/server";

import { getEventOverviewStats } from "@/lib/event-overview-stats";
import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  // Non-admin users: return empty list until user binding is implemented (Phase C).
  // TODO: Scope to user's own events once TrainingEvent.hostUserId is added.
  if (!isAdmin(user!)) {
    return NextResponse.json({ events: [] });
  }

  const events = await getEventOverviewStats();

  return NextResponse.json({ events });
}

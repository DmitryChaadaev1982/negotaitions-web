import { NextResponse } from "next/server";

import { getEventOverviewStatsForUser } from "@/lib/event-overview-stats";
import { apiRequireActiveUser } from "@/lib/auth/api-guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  const events = await getEventOverviewStatsForUser(user);

  return NextResponse.json({ events });
}

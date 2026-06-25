import { NextResponse } from "next/server";

import { getSessionOverviewStatsForUser } from "@/lib/session-overview-stats";
import { apiRequireActiveUser } from "@/lib/auth/api-guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  const sessions = await getSessionOverviewStatsForUser(user);

  return NextResponse.json({ sessions });
}

import { NextResponse } from "next/server";

import { getSessionOverviewStats } from "@/lib/session-overview-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await getSessionOverviewStats();

  return NextResponse.json({ sessions });
}

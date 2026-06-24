import { NextResponse } from "next/server";

import { getEventOverviewStats } from "@/lib/event-overview-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await getEventOverviewStats();

  return NextResponse.json({ events });
}

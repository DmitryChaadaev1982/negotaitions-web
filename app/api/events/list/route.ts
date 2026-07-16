import { NextResponse } from "next/server";

import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { getEventsForUser } from "@/lib/event-overview-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  const events = await getEventsForUser(user);
  return NextResponse.json({ events });
}

import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import { hasRecentCriticalServiceErrors } from "@/lib/services/external-service-events";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getDemoFacilitator();
    const hasRecentServiceErrors = await hasRecentCriticalServiceErrors(24);
    return NextResponse.json({ hasRecentServiceErrors });
  } catch {
    return NextResponse.json({ hasRecentServiceErrors: false });
  }
}

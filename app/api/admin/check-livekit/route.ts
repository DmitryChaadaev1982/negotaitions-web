import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import { checkLiveKitHealth } from "@/lib/services/admin-health";

export const runtime = "nodejs";

export async function POST() {
  await getDemoFacilitator();
  const result = await checkLiveKitHealth();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

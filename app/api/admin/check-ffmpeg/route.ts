import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import { checkFfmpegHealth } from "@/lib/audio/compress";

export const runtime = "nodejs";

export async function POST() {
  await getDemoFacilitator();
  const result = await checkFfmpegHealth();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

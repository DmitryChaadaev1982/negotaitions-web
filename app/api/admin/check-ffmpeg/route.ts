import { NextResponse } from "next/server";

import { checkFfmpegHealth } from "@/lib/audio/compress";
import { apiRequireAdminUser } from "@/lib/auth/api-guards";

export const runtime = "nodejs";

export async function POST() {
  const { response: authError } = await apiRequireAdminUser();
  if (authError) return authError;

  const result = await checkFfmpegHealth();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

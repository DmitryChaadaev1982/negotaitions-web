import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import { checkOpenAiHealth } from "@/lib/services/openai-transcription";

export const runtime = "nodejs";

export async function POST() {
  await getDemoFacilitator();
  const result = await checkOpenAiHealth();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

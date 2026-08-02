import { NextResponse } from "next/server";
import { z } from "zod";

import { isExternalServicesMockMode, setVoxProviderFaultMode } from "@/lib/test-mode";
import { VOX_PROVIDER_FAULT_MODES } from "@/lib/voximplant/provider-fault-simulation";

export const runtime = "nodejs";

const voxProviderFaultSchema = z.object({
  mode: z.enum(VOX_PROVIDER_FAULT_MODES),
});

/**
 * Test-only control for the Voximplant transport fault seam. Returns 404
 * outside external-services mock mode, so it does not exist in production.
 */
export async function POST(request: Request) {
  if (!isExternalServicesMockMode()) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = voxProviderFaultSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  setVoxProviderFaultMode(parsed.data.mode);

  return NextResponse.json({ ok: true, mode: parsed.data.mode });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getVoximplantRecordingStorage,
  getVoximplantTestConfig,
  isVoximplantRecordingPanelEnabled,
} from "@/lib/voximplant-test/config";
import { getScenarioControlledRecordingStatus } from "@/lib/voximplant-test/recording-state";

export const runtime = "nodejs";

const bodySchema = z.object({
  conferenceName: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  if (!isVoximplantRecordingPanelEnabled()) {
    return NextResponse.json(
      {
        error:
          "Recording panel is disabled in the video-only baseline. Set VOXIMPLANT_RECORDING_PANEL_ENABLED=true only after video-only smoke test passes.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let config;
  try {
    config = getVoximplantTestConfig();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Voximplant config error.",
      },
      { status: 500 },
    );
  }

  if (!config.enabled) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  if (config.videoProvider !== "voximplant") {
    return NextResponse.json(
      { error: "VIDEO_PROVIDER must be set to voximplant for this endpoint." },
      { status: 400 },
    );
  }

  const conferenceName = parsed.data.conferenceName || config.conferenceName;
  const payload = getScenarioControlledRecordingStatus({
    conferenceName,
    action: "start",
    storage: getVoximplantRecordingStorage(),
  });

  return NextResponse.json(payload);
}

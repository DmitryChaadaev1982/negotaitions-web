import { NextResponse } from "next/server";

import {
  getVoximplantRecordingStorage,
  getVoximplantTestConfig,
  isVoximplantRecordingPanelEnabled,
} from "@/lib/voximplant-test/config";
import { getScenarioControlledRecordingStatus } from "@/lib/voximplant-test/recording-state";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isVoximplantRecordingPanelEnabled()) {
    return NextResponse.json(
      {
        error:
          "Recording panel is disabled in the video-only baseline. Set VOXIMPLANT_RECORDING_PANEL_ENABLED=true only after video-only smoke test passes.",
      },
      { status: 503 },
    );
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

  const url = new URL(request.url);
  const conferenceName =
    url.searchParams.get("conferenceName")?.trim() || config.conferenceName;

  const payload = getScenarioControlledRecordingStatus({
    conferenceName,
    action: "status",
    storage: getVoximplantRecordingStorage(),
  });

  return NextResponse.json(payload);
}

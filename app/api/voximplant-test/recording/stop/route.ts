import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Manual backend recording control is not implemented. " +
        "Use scenario message control in /voximplant-test: " +
        "the Start/Stop buttons send commands directly to the VoxEngine scenario via conference.sendMessage(). " +
        "Check VoxEngine logs for [neg-conf-rec] recording_control and recording_stopped.",
    },
    { status: 501 },
  );
}

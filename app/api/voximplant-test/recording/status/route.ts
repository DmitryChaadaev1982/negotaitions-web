import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Backend recording status is not implemented. " +
        "Recording state is tracked inside the VoxEngine scenario and returned via scenario messages. " +
        "The Recording panel in /voximplant-test updates from scenario replies in real time. " +
        "Use 'Check status' button which sends a status command to the VoxEngine scenario directly.",
    },
    { status: 501 },
  );
}

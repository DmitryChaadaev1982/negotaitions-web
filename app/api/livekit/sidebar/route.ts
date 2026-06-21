import { NextResponse } from "next/server";

import { getRoomSidebarData } from "@/lib/room-sidebar";

export async function GET(request: Request) {
  const joinToken = new URL(request.url).searchParams.get("joinToken")?.trim();

  if (!joinToken) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 400 });
  }

  const sidebar = await getRoomSidebarData(joinToken);

  if (!sidebar) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  return NextResponse.json(sidebar);
}

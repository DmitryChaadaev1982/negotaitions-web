import { NextResponse } from "next/server";

import { isExternalServicesMockMode } from "@/lib/test-mode";

export const runtime = "nodejs";

function parseDatabaseIdentity(rawUrl: string | undefined) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname || null,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: parsed.pathname.replace(/^\//, "").split("?")[0] || null,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!isExternalServicesMockMode()) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    requestOrigin: new URL(request.url).origin,
    appUrl: process.env.APP_URL ?? null,
    baseUrl: process.env.BASE_URL ?? null,
    playwrightBaseUrl: process.env.PLAYWRIGHT_BASE_URL ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    externalServicesMode: process.env.EXTERNAL_SERVICES_MODE ?? null,
    database: parseDatabaseIdentity(process.env.DATABASE_URL),
  });
}

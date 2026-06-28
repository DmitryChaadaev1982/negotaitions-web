import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getVoximplantTestConfig,
  type VoximplantTestRole,
} from "@/lib/voximplant-test/config";

export const runtime = "nodejs";

const bodySchema = z.object({
  role: z.enum(["participant_a", "participant_b", "facilitator"]),
});

function buildUsername(shortUser: string, userDomain: string): string {
  return `${shortUser}@${userDomain}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
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

  const role = parsed.data.role as VoximplantTestRole;
  const roleConfig = config.roleCredentials[role];

  /**
   * Local PoC security note:
   * This endpoint returns static Voximplant test credentials for browser login.
   * This is intentionally limited to local/dev and must be replaced with
   * one-time key login for production usage.
   */
  return NextResponse.json({
    role,
    roleLabel: roleConfig.label,
    username: buildUsername(roleConfig.usernameShort, config.userDomain),
    password: roleConfig.password,
    connectionNode: config.connectionNode,
    conferenceName: config.conferenceName,
    applicationName: config.applicationName,
    accountName: config.accountName,
    scenarioName: config.scenarioName,
    ruleName: config.ruleName,
    isProductionSafe: false,
    loginMode: "password",
  });
}

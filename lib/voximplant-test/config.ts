import { getEnvBoolean } from "@/lib/env";

export type VoximplantTestRole = "participant_a" | "participant_b" | "facilitator";

type RoleCredentials = {
  role: VoximplantTestRole;
  label: string;
  usernameShort: string;
  password: string;
};

type VoximplantTestConfig = {
  enabled: boolean;
  videoProvider: string;
  applicationName: string;
  accountName: string;
  userDomain: string;
  scenarioName: string;
  ruleName: string;
  conferenceName: string;
  connectionNode: string;
  roleCredentials: Record<VoximplantTestRole, RoleCredentials>;
};

const DEFAULT_CONNECTION_NODE = "NODE_1";
const DEFAULT_CONFERENCE_NAME = "negotiations-smoke-poc";

function getRequiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function buildRoleCredentials(
  role: VoximplantTestRole,
  label: string,
  usernameEnvKey: string,
  passwordEnvKey: string,
): RoleCredentials {
  return {
    role,
    label,
    usernameShort: getRequiredEnv(usernameEnvKey),
    password: getRequiredEnv(passwordEnvKey),
  };
}

export function getVoximplantTestConfig(): VoximplantTestConfig {
  const isDevMode = process.env.NODE_ENV !== "production";
  return {
    enabled: isDevMode,
    videoProvider: process.env.VIDEO_PROVIDER?.trim().toLowerCase() ?? "",
    applicationName: getRequiredEnv("VOXIMPLANT_APPLICATION_NAME"),
    accountName: getRequiredEnv("VOXIMPLANT_ACCOUNT_NAME"),
    userDomain: getRequiredEnv("VOXIMPLANT_USER_DOMAIN"),
    scenarioName: getRequiredEnv("VOXIMPLANT_SCENARIO_NAME"),
    ruleName: getRequiredEnv("VOXIMPLANT_RULE_NAME"),
    conferenceName:
      process.env.VOXIMPLANT_TEST_CONFERENCE_NAME?.trim() ||
      DEFAULT_CONFERENCE_NAME,
    connectionNode:
      process.env.VOXIMPLANT_CONNECTION_NODE?.trim() || DEFAULT_CONNECTION_NODE,
    roleCredentials: {
      participant_a: buildRoleCredentials(
        "participant_a",
        "Participant A",
        "VOXIMPLANT_PARTICIPANT_A_USER",
        "VOXIMPLANT_PARTICIPANT_A_PASSWORD",
      ),
      participant_b: buildRoleCredentials(
        "participant_b",
        "Participant B",
        "VOXIMPLANT_PARTICIPANT_B_USER",
        "VOXIMPLANT_PARTICIPANT_B_PASSWORD",
      ),
      facilitator: buildRoleCredentials(
        "facilitator",
        "Facilitator",
        "VOXIMPLANT_FACILITATOR_USER",
        "VOXIMPLANT_FACILITATOR_PASSWORD",
      ),
    },
  };
}

export function isVoximplantRecordingEnabled(): boolean {
  return getEnvBoolean("VOXIMPLANT_RECORDING_ENABLED", true);
}

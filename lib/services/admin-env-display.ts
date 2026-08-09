import {
  parseServerRuntimeSetting,
  readServerRuntimeSettingRaw,
  runtimeSettingConditionMatches,
  SERVER_RUNTIME_SETTING_KEYS,
  SERVER_RUNTIME_SETTINGS,
  type ServerRuntimeSetting,
} from "@/lib/config/server-runtime-settings";
import { getEmailConfig } from "@/lib/email/config";

export type AdminEnvDisplayItem = {
  key: string;
  area: string;
  status:
    | "configured"
    | "using_intrinsic_default"
    | "disabled_by_design"
    | "not_applicable"
    | "unconfigured_optional"
    | "missing_required"
    | "invalid";
  valueSource:
    | "environment"
    | "missing"
    | "intrinsic"
    | "derived"
    | "not_applicable";
  configured: boolean;
  isSecret: boolean;
  value: string | null;
  applicable: boolean;
  required: boolean;
  consumer: string;
  explanation: string;
};

export type AdminEnvDisplayGroup = {
  group: string | null;
  items: AdminEnvDisplayItem[];
};

export type AdminEnvDescriptor = {
  key: string;
  group: string | null;
  area: string;
  isSecret: boolean;
  consumer: string;
  explanation: string;
  status: AdminEnvDisplayItem["status"];
  valueSource: AdminEnvDisplayItem["valueSource"];
  value?: string | number | boolean | null;
  applicable?: boolean;
  required?: boolean;
};

function safeParse(key: (typeof SERVER_RUNTIME_SETTING_KEYS)[number]): {
  ok: boolean;
  value: string | number | boolean | null;
} {
  try {
    return { ok: true, value: parseServerRuntimeSetting(key) };
  } catch {
    return { ok: false, value: null };
  }
}

function featureDisabled(
  key: string,
  value: string | number | boolean | null,
): boolean {
  return (
    (key === "EMAIL_DELIVERY_ENABLED" ||
      key === "EMAIL_LOCAL_PREVIEW_ENABLED" ||
      key === "EMAIL_ADMIN_TEST_ENABLED" ||
      key === "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED") &&
    value === false
  ) || (key === "EMAIL_PROVIDER" && value === "disabled");
}

function descriptorFor(
  definition: ServerRuntimeSetting,
  emailConfigValid: boolean,
): AdminEnvDescriptor {
  const key = definition.key as (typeof SERVER_RUNTIME_SETTING_KEYS)[number];
  const raw = readServerRuntimeSettingRaw(key);
  const parsed = safeParse(key);
  const applicable = runtimeSettingConditionMatches(definition.applicability);
  const required = runtimeSettingConditionMatches(definition.required);
  const emailOwned = definition.ownerModules.includes("lib/email/config.ts");
  const customRuntimeValid = !emailOwned || emailConfigValid;

  let status: AdminEnvDisplayItem["status"];
  let valueSource: AdminEnvDisplayItem["valueSource"];
  if (!applicable) {
    status = "not_applicable";
    valueSource = "not_applicable";
  } else if (required && !raw) {
    status = "missing_required";
    valueSource = "missing";
  } else if (!parsed.ok || !customRuntimeValid) {
    status = "invalid";
    valueSource = raw ? "environment" : "missing";
  } else if (featureDisabled(key, parsed.value)) {
    status = "disabled_by_design";
    valueSource = "environment";
  } else if (!raw && definition.classification === "intrinsic") {
    status = "using_intrinsic_default";
    valueSource = "intrinsic";
  } else if (!raw) {
    status = "unconfigured_optional";
    valueSource = "missing";
  } else {
    status = "configured";
    valueSource = "environment";
  }

  let value: string | number | boolean | null = parsed.value;
  if (
    definition.secret ||
    definition.diagnostics.representation === "presence"
  ) {
    value = null;
  } else if (definition.diagnostics.representation === "configured_list") {
    value = raw ? "configured list" : "empty list";
  }

  return {
    key,
    group: definition.diagnostics.group,
    area: definition.featureArea,
    isSecret: definition.secret,
    consumer: definition.ownerModules.join(", "),
    explanation:
      status === "invalid"
        ? "INVALID_RUNTIME_CONFIGURATION"
        : definition.diagnostics.description,
    status,
    valueSource,
    value,
    applicable,
    required,
  };
}

/**
 * Administrative descriptors are a projection of the typed runtime registry.
 * There is no second key, secret, default, bounds, enum, or ownership list.
 */
export function buildAdminEnvDescriptors(): AdminEnvDescriptor[] {
  let emailConfigValid = true;
  try {
    getEmailConfig();
  } catch {
    emailConfigValid = false;
  }

  return SERVER_RUNTIME_SETTING_KEYS.map((key) =>
    descriptorFor(SERVER_RUNTIME_SETTINGS[key], emailConfigValid),
  );
}

function toItem(descriptor: AdminEnvDescriptor): AdminEnvDisplayItem {
  return {
    key: descriptor.key,
    area: descriptor.area,
    status: descriptor.status,
    valueSource: descriptor.valueSource,
    configured: descriptor.valueSource === "environment",
    isSecret: descriptor.isSecret,
    value: descriptor.isSecret
      ? null
      : descriptor.value === undefined || descriptor.value === null
        ? null
        : String(descriptor.value),
    applicable: descriptor.applicable ?? true,
    required: descriptor.required ?? false,
    consumer: descriptor.consumer,
    explanation: descriptor.explanation,
  };
}

export function getAdminEnvironmentDisplayGroups(): AdminEnvDisplayGroup[] {
  const groups: AdminEnvDisplayGroup[] = [];
  const byGroup = new Map<string | null, AdminEnvDisplayItem[]>();

  for (const descriptor of buildAdminEnvDescriptors()) {
    let items = byGroup.get(descriptor.group);
    if (!items) {
      items = [];
      byGroup.set(descriptor.group, items);
      groups.push({ group: descriptor.group, items });
    }
    items.push(toItem(descriptor));
  }

  return groups;
}

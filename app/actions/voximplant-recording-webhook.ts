"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/auth";
import {
  clearVoximplantRecordingWebhookBaseUrlOverride,
  getVoximplantRecordingWebhookUrlState,
  isVoximplantRecordingWebhookOverrideEnabled,
  setVoximplantRecordingWebhookBaseUrlOverride,
  type VoximplantRecordingWebhookUrlState,
} from "@/lib/voximplant/recording-webhook-url";

const ADMIN_PAGE_PATH = "/admin";

async function requireVoximplantRecordingWebhookAdmin() {
  await requireAdminUser(ADMIN_PAGE_PATH);
  if (!isVoximplantRecordingWebhookOverrideEnabled()) {
    redirect("/admin?error=voximplant_webhook_override_disabled");
  }
}

export async function getVoximplantRecordingWebhookSettingsAction(): Promise<
  | { ok: true; state: VoximplantRecordingWebhookUrlState }
  | { ok: false; error: string }
> {
  await requireVoximplantRecordingWebhookAdmin();

  try {
    const state = await getVoximplantRecordingWebhookUrlState();
    return { ok: true, state };
  } catch {
    return { ok: false, error: "Unable to load webhook URL settings." };
  }
}

export async function saveVoximplantRecordingWebhookOverrideAction(
  url: string,
): Promise<
  | { ok: true; state: VoximplantRecordingWebhookUrlState }
  | { ok: false; error: string }
> {
  await requireVoximplantRecordingWebhookAdmin();

  const result = await setVoximplantRecordingWebhookBaseUrlOverride(url);
  if (!result.ok) {
    return result;
  }

  revalidatePath(ADMIN_PAGE_PATH);
  const state = await getVoximplantRecordingWebhookUrlState();
  return { ok: true, state };
}

export async function clearVoximplantRecordingWebhookOverrideAction(): Promise<
  | { ok: true; state: VoximplantRecordingWebhookUrlState }
  | { ok: false; error: string }
> {
  await requireVoximplantRecordingWebhookAdmin();

  try {
    await clearVoximplantRecordingWebhookBaseUrlOverride();
    revalidatePath(ADMIN_PAGE_PATH);
    const state = await getVoximplantRecordingWebhookUrlState();
    return { ok: true, state };
  } catch {
    return { ok: false, error: "Unable to reset webhook URL override." };
  }
}

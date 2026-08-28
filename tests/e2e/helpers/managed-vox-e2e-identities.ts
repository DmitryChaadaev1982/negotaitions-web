/**
 * Canonical managed Vox E2E identity pool descriptors.
 *
 * MANAGED SLOT → FIXED application User.id → FIXED ng_u_* via production
 * `buildVoximplantUsernameForUser`. The fixture helper lives in `db.ts` and
 * never talks to the Vox Management API.
 *
 * Concurrency: MAX_1_LIVE_LOGIN_PER_SLOT. Playwright workers remain 1.
 * Do not share one slot across concurrent live logins (SetUserInfo rotates
 * the password before one-time-key login). Worker-scoped pools are a future
 * explicit change if workers > 1.
 *
 * Historical remote Vox users are not cleaned here.
 */

export const MANAGED_VOX_E2E_SLOTS = [
  "FACILITATOR_01",
  "PARTICIPANT_01",
  "PARTICIPANT_02",
  "OBSERVER_01",
] as const;

export type ManagedVoxE2ESlot = (typeof MANAGED_VOX_E2E_SLOTS)[number];

export type ManagedVoxE2ESlotDescriptor = {
  slot: ManagedVoxE2ESlot;
  userId: string;
  email: string;
  name: string;
};

export const MANAGED_VOX_E2E_SLOT_DESCRIPTORS: Record<
  ManagedVoxE2ESlot,
  ManagedVoxE2ESlotDescriptor
> = {
  FACILITATOR_01: {
    slot: "FACILITATOR_01",
    userId: "e2e_managed_vox_facilitator_01",
    email: "managed-vox-facilitator-01@e2e-reserved.test",
    name: "Managed Vox Facilitator 01",
  },
  PARTICIPANT_01: {
    slot: "PARTICIPANT_01",
    userId: "e2e_managed_vox_participant_01",
    email: "managed-vox-participant-01@e2e-reserved.test",
    name: "Managed Vox Participant 01",
  },
  PARTICIPANT_02: {
    slot: "PARTICIPANT_02",
    userId: "e2e_managed_vox_participant_02",
    email: "managed-vox-participant-02@e2e-reserved.test",
    name: "Managed Vox Participant 02",
  },
  OBSERVER_01: {
    slot: "OBSERVER_01",
    userId: "e2e_managed_vox_observer_01",
    email: "managed-vox-observer-01@e2e-reserved.test",
    name: "Managed Vox Observer 01",
  },
};

export const MANAGED_VOX_E2E_PASSWORD = "e2e-managed-vox-pass-1234";

const MANAGED_USER_IDS = new Set(
  MANAGED_VOX_E2E_SLOTS.map((slot) => MANAGED_VOX_E2E_SLOT_DESCRIPTORS[slot].userId),
);
const MANAGED_EMAILS = new Set(
  MANAGED_VOX_E2E_SLOTS.map((slot) =>
    MANAGED_VOX_E2E_SLOT_DESCRIPTORS[slot].email.toLowerCase(),
  ),
);

export function getManagedVoxE2ESlotDescriptor(
  slot: ManagedVoxE2ESlot,
): ManagedVoxE2ESlotDescriptor {
  return MANAGED_VOX_E2E_SLOT_DESCRIPTORS[slot];
}

export function listManagedVoxE2EUserIds(): string[] {
  return MANAGED_VOX_E2E_SLOTS.map(
    (slot) => MANAGED_VOX_E2E_SLOT_DESCRIPTORS[slot].userId,
  );
}

export function listManagedVoxE2EEmails(): string[] {
  return MANAGED_VOX_E2E_SLOTS.map(
    (slot) => MANAGED_VOX_E2E_SLOT_DESCRIPTORS[slot].email,
  );
}

export function isManagedVoxE2EUserId(userId: string | null | undefined): boolean {
  return Boolean(userId && MANAGED_USER_IDS.has(userId));
}

export function isManagedVoxE2EEmail(email: string | null | undefined): boolean {
  return Boolean(email && MANAGED_EMAILS.has(email.trim().toLowerCase()));
}

export const MANAGED_VOX_FIXTURE_PROVIDER_USERNAME_PREFIX = "ng_u_fixture_";

export function isForbiddenManagedVoxFixtureProviderUsername(
  providerUsername: string | null | undefined,
): boolean {
  return Boolean(
    providerUsername &&
      providerUsername.startsWith(MANAGED_VOX_FIXTURE_PROVIDER_USERNAME_PREFIX),
  );
}

import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getVoximplantConfig } from "@/lib/voximplant/config";
import {
  ensureRemoteVoximplantUser,
  VoximplantManagementApiNotImplementedError,
} from "@/lib/voximplant/management-api";
import type { VoximplantRoomRole } from "@/lib/voximplant/scenario-messages";

const VOXIMPLANT_PROVIDER = "voximplant";
const STATUS_ACTIVE = "active";
const STATUS_DISABLED = "disabled";
const STATUS_FAILED = "failed";

type IdentityStatus = typeof STATUS_ACTIVE | typeof STATUS_DISABLED | typeof STATUS_FAILED;

export type GetOrCreateVoximplantIdentityParams = {
  userId: string;
  displayName: string | null;
  sessionId: string;
  role: VoximplantRoomRole;
};

export type VoximplantIdentityResult = {
  id: string;
  provider: string;
  userId: string;
  providerUsername: string;
  providerApplicationName: string;
  status: string;
  lastUsedAt: Date | null;
  metadata: unknown;
};

export class VoximplantIdentityProvisioningPendingError extends Error {
  readonly code = "VOXIMPLANT_PROVISIONING_IMPLEMENTATION_PENDING";
  readonly identity: VoximplantIdentityResult | null;

  constructor(message: string, identity: VoximplantIdentityResult | null) {
    super(message);
    this.name = "VoximplantIdentityProvisioningPendingError";
    this.identity = identity;
  }
}

export class VoximplantIdentityDisabledError extends Error {
  readonly code = "VOXIMPLANT_IDENTITY_DISABLED";

  constructor(message: string) {
    super(message);
    this.name = "VoximplantIdentityDisabledError";
  }
}

function asIdentityResult(row: {
  id: string;
  provider: string;
  userId: string;
  providerUsername: string;
  providerApplicationName: string;
  status: string;
  lastUsedAt: Date | null;
  metadata: unknown;
}): VoximplantIdentityResult {
  return {
    id: row.id,
    provider: row.provider,
    userId: row.userId,
    providerUsername: row.providerUsername,
    providerApplicationName: row.providerApplicationName,
    status: row.status,
    lastUsedAt: row.lastUsedAt,
    metadata: row.metadata,
  };
}

function sanitizeUserIdFragment(userId: string): string {
  return userId.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildVoximplantUsernameForUser(userId: string): string {
  const safe = sanitizeUserIdFragment(userId);
  if (safe.length >= 6) {
    return `ng_u_${safe.slice(0, 24)}`;
  }
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `ng_u_${digest}`;
}

export async function markVoximplantIdentityUsed(
  identityId: string,
): Promise<VoximplantIdentityResult> {
  const updated = await prisma.videoProviderIdentity.update({
    where: { id: identityId },
    data: { lastUsedAt: new Date() },
  });
  return asIdentityResult(updated);
}

async function upsertIdentity({
  userId,
  providerUsername,
  providerApplicationName,
  status,
  lastProvisioningError,
  metadata,
}: {
  userId: string;
  providerUsername: string;
  providerApplicationName: string;
  status: IdentityStatus;
  lastProvisioningError: string | null;
  metadata: Prisma.InputJsonValue | null;
}) {
  return prisma.videoProviderIdentity.upsert({
    where: {
      provider_userId: {
        provider: VOXIMPLANT_PROVIDER,
        userId,
      },
    },
    create: {
      provider: VOXIMPLANT_PROVIDER,
      userId,
      providerUsername,
      providerApplicationName,
      status,
      lastUsedAt: status === STATUS_ACTIVE ? new Date() : null,
      lastProvisioningError,
      metadata: metadata ?? Prisma.JsonNull,
    },
    update: {
      providerUsername,
      providerApplicationName,
      status,
      lastUsedAt: status === STATUS_ACTIVE ? new Date() : null,
      lastProvisioningError,
      metadata: metadata ?? Prisma.JsonNull,
    },
  });
}

export async function getOrCreateVoximplantIdentityForUser(
  params: GetOrCreateVoximplantIdentityParams,
): Promise<VoximplantIdentityResult> {
  const config = getVoximplantConfig({
    provider: VOXIMPLANT_PROVIDER,
    requireForRuntime: true,
  });

  const existing = await prisma.videoProviderIdentity.findUnique({
    where: {
      provider_userId: {
        provider: VOXIMPLANT_PROVIDER,
        userId: params.userId,
      },
    },
  });

  if (existing?.status === STATUS_DISABLED) {
    throw new VoximplantIdentityDisabledError(
      "Voximplant identity is disabled for this user.",
    );
  }

  if (existing?.status === STATUS_ACTIVE) {
    return markVoximplantIdentityUsed(existing.id);
  }

  const providerUsername = buildVoximplantUsernameForUser(params.userId);
  const providerApplicationName = config.applicationName as string;

  try {
    const remote = await ensureRemoteVoximplantUser({
      applicationName: providerApplicationName,
      providerUsername,
      displayName: params.displayName,
    });

    const identity = await upsertIdentity({
      userId: params.userId,
      providerUsername,
      providerApplicationName,
      status: STATUS_ACTIVE,
      lastProvisioningError: null,
      metadata: {
        remoteOutcome: remote.outcome,
        remoteUserId: remote.remoteUserId,
        sessionId: params.sessionId,
        role: params.role,
      },
    });
    return asIdentityResult(identity);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown provisioning error";

    const failedIdentity = await upsertIdentity({
      userId: params.userId,
      providerUsername,
      providerApplicationName,
      status: STATUS_FAILED,
      lastProvisioningError: errorMessage,
      metadata: {
        provisioningFailedAt: new Date().toISOString(),
        sessionId: params.sessionId,
        role: params.role,
      },
    });

    if (error instanceof VoximplantManagementApiNotImplementedError) {
      throw new VoximplantIdentityProvisioningPendingError(
        "Voximplant remote user provisioning adapter is pending implementation.",
        asIdentityResult(failedIdentity),
      );
    }

    throw error;
  }
}

import "server-only";

export type EnsureRemoteVoximplantUserParams = {
  applicationName: string;
  providerUsername: string;
  displayName: string | null;
};

export type EnsureRemoteVoximplantUserResult = {
  outcome: "created" | "already_exists";
  remoteUserId: string | null;
};

export class VoximplantManagementApiNotImplementedError extends Error {
  readonly code = "VOXIMPLANT_MANAGEMENT_API_NOT_IMPLEMENTED";

  constructor(message?: string) {
    super(
      message ??
        "Voximplant Management API adapter is not implemented in this environment.",
    );
    this.name = "VoximplantManagementApiNotImplementedError";
  }
}

/**
 * Stage 4 adapter boundary.
 *
 * IMPORTANT:
 * - Do not invent Voximplant API endpoints/methods.
 * - Wire official Management API calls in a follow-up step once exact auth/token
 *   flow is approved for this project environment.
 */
export async function ensureRemoteVoximplantUser(
  params: EnsureRemoteVoximplantUserParams,
): Promise<EnsureRemoteVoximplantUserResult> {
  void params;
  throw new VoximplantManagementApiNotImplementedError();
}

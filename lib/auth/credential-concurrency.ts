/**
 * Credential-generation concurrency helpers for linearizable password mutations.
 *
 * Every password change / reset increments User.credentialGeneration.
 * Login and authenticated password-change capture the generation observed
 * during password verification and only commit when it is unchanged.
 *
 * Session creation locks the User row (FOR UPDATE) while checking generation
 * and inserting UserSession so reset cannot interleave between those steps.
 */

export class StaleCredentialError extends Error {
  constructor(message = "Credential state changed concurrently.") {
    super(message);
    this.name = "StaleCredentialError";
  }
}

export type CredentialMutationHooks = {
  /** Invoked after password verification succeeds, before credential mutation / session create. */
  afterPasswordVerified?: () => Promise<void> | void;
  /** Invoked immediately before the session-create transaction begins. */
  beforeSessionCreate?: () => Promise<void> | void;
  /**
   * Invoked after the User row is locked for session create and generation has
   * been validated, but before UserSession insert (lock still held).
   */
  afterUserRowLockedForSession?: () => Promise<void> | void;
  /** Invoked immediately before conditional password-hash update (inside mutation tx). */
  beforePasswordUpdate?: () => Promise<void> | void;
  /**
   * Invoked after the User row is locked for a credential mutation, before the
   * password hash / generation update (lock still held).
   */
  afterUserRowLockedForCredentialMutation?: () => Promise<void> | void;
};

let activeHooks: CredentialMutationHooks = {};

/** Test-only barrier injection. Never call from production paths. */
export function setCredentialMutationHooksForTests(
  hooks: CredentialMutationHooks,
): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Credential mutation test hooks are unavailable in production.",
    );
  }
  activeHooks = hooks;
}

export function clearCredentialMutationHooksForTests(): void {
  activeHooks = {};
}

export async function runAfterPasswordVerifiedHook(): Promise<void> {
  await activeHooks.afterPasswordVerified?.();
}

export async function runBeforeSessionCreateHook(): Promise<void> {
  await activeHooks.beforeSessionCreate?.();
}

export async function runAfterUserRowLockedForSessionHook(): Promise<void> {
  await activeHooks.afterUserRowLockedForSession?.();
}

export async function runBeforePasswordUpdateHook(): Promise<void> {
  await activeHooks.beforePasswordUpdate?.();
}

export async function runAfterUserRowLockedForCredentialMutationHook(): Promise<void> {
  await activeHooks.afterUserRowLockedForCredentialMutation?.();
}

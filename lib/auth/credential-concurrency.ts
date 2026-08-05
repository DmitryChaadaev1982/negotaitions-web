/**
 * Credential-generation concurrency helpers for linearizable password mutations.
 *
 * Every password change / reset increments User.credentialGeneration.
 * Login and authenticated password-change capture the generation observed
 * during password verification and only commit when it is unchanged.
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
  /** Invoked immediately before conditional session creation. */
  beforeSessionCreate?: () => Promise<void> | void;
  /** Invoked immediately before conditional password-hash update. */
  beforePasswordUpdate?: () => Promise<void> | void;
};

let activeHooks: CredentialMutationHooks = {};

/** Test-only barrier injection. Never call from production paths. */
export function setCredentialMutationHooksForTests(
  hooks: CredentialMutationHooks,
): void {
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

export async function runBeforePasswordUpdateHook(): Promise<void> {
  await activeHooks.beforePasswordUpdate?.();
}

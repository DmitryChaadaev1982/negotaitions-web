/**
 * Stage 3.13C-F final security verifier.
 *
 * Requires the approved schema-scoped URL supplied by the persistent
 * test-database command wrapper.
 * Output is limited to case names, counters, and one opaque run id.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  assertApprovedStage313cVerifierChildEnvironment,
  Stage313cTestDatabaseRefusal,
  STAGE313C_VERIFIER_APPLICATION_NAME,
} from "./stage-3-13c-test-database";
import { applyStage313cTestRuntimeEnv } from "./stage-3-13c-test-runtime";

class VerifierRefusal extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

let databaseUrl: string;
try {
  databaseUrl =
    assertApprovedStage313cVerifierChildEnvironment(
      process.env,
    ).scopedDatabaseUrl;
} catch (error) {
  const code =
    error instanceof Stage313cTestDatabaseRefusal
      ? error.code
      : "TEST_DATABASE_REFUSED";
  console.error(
    JSON.stringify({
      ok: false,
      counts: { safetyRefusals: 1 },
      cases: [code],
    }),
  );
  process.exit(1);
}

process.env.DATABASE_URL = databaseUrl;
process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = randomBytes(32).toString("base64");
applyStage313cTestRuntimeEnv({
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: "10",
});
delete process.env.YANDEX_POSTBOX_ACCESS_KEY_ID;
delete process.env.YANDEX_POSTBOX_SECRET_ACCESS_KEY;

const runId = randomBytes(12).toString("hex");
const marker = `stage313cf_${runId.slice(0, 12)}`;
const cases: string[] = [];
const counts: Record<string, number> = {};
const ownedUserIds: string[] = [];
const ownedEmails: string[] = [];
let currentCase = "bootstrap";
let prisma: (typeof import("@/lib/prisma"))["prisma"] | undefined;

function record(name: string, amount = 1): void {
  cases.push(name);
  counts[name] = (counts[name] ?? 0) + amount;
}

function barrier() {
  let release!: () => void;
  let arrive!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return {
    arrived,
    wait: async () => {
      arrive();
      await gate;
    },
    release,
  };
}

async function quiet<T>(operation: () => Promise<T>): Promise<T> {
  const log = console.log;
  const error = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await operation();
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function main(): Promise<void> {
  const prismaModule = await import("@/lib/prisma");
  prisma = prismaModule.prisma;
  const accountSecurity = await import("@/lib/auth/account-security");
  const passwordTokenModule = await import("@/lib/auth/password-reset-token");
  const authCrypto = await import("@/lib/auth/crypto");
  const sessionModule = await import("@/lib/auth/session");
  const concurrency = await import("@/lib/auth/credential-concurrency");
  const fence = await import("@/lib/auth/credential-dispatch-fence");
  const registration = await import("@/lib/auth/registration");
  const sensitive = await import("@/lib/email/sensitive-payload");
  const providerModule = await import("@/lib/email/provider");
  const worker = await import("@/lib/email/worker");
  const accountEmail = await import("@/lib/email/account-security");
  const adminStatus = await import("@/lib/auth/admin-account-status");
  const authenticatedChange = await import(
    "@/lib/auth/authenticated-password-change"
  );
  const canary = await import("@/lib/email/canary");
  const dispatch = await import("@/lib/email/password-reset-dispatch");
  const retention = await import("@/lib/email/retention");

  const {
    requestPasswordReset,
    resetPasswordWithToken,
  } = accountSecurity;
  const {
    generatePasswordResetToken,
    hashPasswordResetToken,
  } = passwordTokenModule;
  const { hashPassword, hashSessionToken } = authCrypto;
  const {
    createUserSession,
    createUserSessionToken,
    setUserSessionCookieWriterForTests,
    clearUserSessionCookieWriterForTests,
  } = sessionModule;
  const {
    setCredentialMutationHooksForTests,
    clearCredentialMutationHooksForTests,
    StaleCredentialError,
  } = concurrency;
  const {
    credentialDispatchAdvisoryKeys,
    setCredentialDispatchFenceHooksForTests,
    clearCredentialDispatchFenceHooksForTests,
    withCredentialDispatchFence,
    CredentialDispatchFenceError,
  } = fence;
  const { createRegisteredUserWithConsents } = registration;
  const { decryptSensitivePayload } = sensitive;
  const { FakeEmailProvider } = providerModule;
  const { runEmailDeliverySweep } = worker;
  const { enqueuePasswordResetEmail } = accountEmail;
  const { transitionUserToResetIneligibleStatus } = adminStatus;
  const { commitAuthenticatedPasswordChange } = authenticatedChange;
  const { runOneMessageEmailCanary, EmailCanaryError } = canary;
  const { quarantineStalePasswordResetBacklog } = dispatch;
  const { runEmailRetentionCleanup } = retention;

  await prisma.$queryRaw`SELECT 1`;
  const preexisting = await Promise.all([
    prisma.user.count(),
    prisma.userSession.count(),
    prisma.passwordResetToken.count(),
    prisma.emailMessage.count(),
    prisma.emailDeliveryAttempt.count(),
    prisma.emailSuppression.count(),
    prisma.adminActionLog.count(),
    prisma.userConsent.count(),
  ]);
  if (preexisting.some((value) => value !== 0)) {
    throw new VerifierRefusal("VERIFIER_SCHEMA_DATA_NOT_EMPTY");
  }

  const originalPassword = `Old-${randomBytes(12).toString("base64url")}!`;
  const passwordHash = await hashPassword(originalPassword);

  async function createUser(
    label: string,
    status: "ACTIVE" | "PENDING_APPROVAL" | "BLOCKED" | "REJECTED" =
      "ACTIVE",
    globalRole: "USER" | "ADMIN" = "USER",
  ) {
    const email = `${marker}.${label}@test.invalid`;
    const user = await prisma!.user.create({
      data: {
        email,
        passwordHash,
        name: `Stage 3.13C-F ${label}`,
        globalRole,
        status,
        preferredLocale: "en",
        credentialGeneration: 0,
      },
    });
    ownedUserIds.push(user.id);
    ownedEmails.push(email);
    return user;
  }

  async function createRegistration(
    label: string,
    status: "ACTIVE" | "PENDING_APPROVAL",
    globalRole: "ADMIN" | "USER",
  ) {
    const email = `${marker}.registration.${label}@test.invalid`;
    const user = await createRegisteredUserWithConsents({
      email,
      name: `Stage 3.13C-F registration ${label}`,
      passwordHash,
      globalRole,
      status,
      preferredLocale: "en",
      now: new Date(),
    });
    ownedUserIds.push(user.id);
    ownedEmails.push(email);
    return user;
  }

  async function createReset(user: {
    id: string;
    email: string;
  }) {
    await requestPasswordReset({ normalizedEmail: user.email });
    const message = await prisma!.emailMessage.findFirstOrThrow({
      where: {
        userId: user.id,
        messageType: "PASSWORD_RESET",
      },
      orderBy: { createdAt: "desc" },
    });
    const metadata =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : {};
    const generation =
      typeof metadata.credentialGeneration === "number"
        ? metadata.credentialGeneration
        : 0;
    const payload = decryptSensitivePayload(
      {
        ciphertext: message.sensitivePayloadCiphertext!,
        nonce: message.sensitivePayloadNonce!,
      },
      {
        messageId: message.id,
        tokenId: message.relatedTokenId!,
        userId: user.id,
        credentialGeneration: generation,
        recipientNormalized: message.recipientEmailNormalized,
      },
    );
    return { message, rawToken: payload.rawToken };
  }

  async function seedOldReset(user: {
    id: string;
    email: string;
    name: string | null;
    preferredLocale: string;
    credentialGeneration: number;
  }) {
    const rawToken = generatePasswordResetToken();
    const createdAt = new Date(Date.now() - 20_000);
    const message = await prisma!.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashPasswordResetToken(rawToken),
          expiresAt: new Date(Date.now() + 30 * 60_000),
          createdAt,
        },
      });
      const result = await enqueuePasswordResetEmail({
        user,
        rawToken,
        tokenId: token.id,
        credentialGeneration: user.credentialGeneration,
        tx,
      });
      return tx.emailMessage.findUniqueOrThrow({
        where: { id: result.messageId },
      });
    });
    return { message, rawToken };
  }

  async function fenceReleased(userId: string): Promise<void> {
    await withCredentialDispatchFence(
      userId,
      async () => undefined,
      { connectionString: databaseUrl, timeoutMs: 500 },
    );
  }

  async function assertFailureSanitized(
    messageId: string,
    forbidden: string[],
  ): Promise<void> {
    const message = await prisma!.emailMessage.findUniqueOrThrow({
      where: { id: messageId },
      select: {
        status: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        sensitivePayloadCiphertext: true,
        sensitivePayloadNonce: true,
        sensitivePayloadClearedAt: true,
        attempts: {
          select: {
            normalizedErrorCode: true,
            sanitizedErrorMessage: true,
            providerMetadata: true,
          },
        },
      },
    });
    assert.ok(
      message.status === "FAILED_FINAL" ||
        message.status === "CANCELLED",
    );
    assert.equal(message.sensitivePayloadCiphertext, null);
    assert.equal(message.sensitivePayloadNonce, null);
    assert.ok(message.sensitivePayloadClearedAt);
    const failureData = JSON.stringify({
      code: message.lastErrorCode,
      message: message.lastErrorMessage,
      attempts: message.attempts,
    });
    for (const value of forbidden) {
      assert.ok(!failureData.includes(value));
    }
  }

  // Registration session creation and reset ordering.
  currentCase = "registration_session_normal";
  {
    const user = await createRegistration(
      "normal",
      "PENDING_APPROVAL",
      "USER",
    );
    let cookieCount = 0;
    setUserSessionCookieWriterForTests(async () => {
      cookieCount += 1;
    });
    await createUserSession(user.id, {
      expectedCredentialGeneration: user.credentialGeneration,
    });
    clearUserSessionCookieWriterForTests();
    assert.equal(cookieCount, 1);
    assert.equal(
      await prisma.userSession.count({ where: { userId: user.id } }),
      1,
    );
    record(currentCase);
  }

  currentCase = "registration_session_bootstrap_admin";
  {
    const user = await createRegistration("bootstrap", "ACTIVE", "ADMIN");
    let cookieCount = 0;
    setUserSessionCookieWriterForTests(async () => {
      cookieCount += 1;
    });
    await createUserSession(user.id, {
      expectedCredentialGeneration: user.credentialGeneration,
    });
    clearUserSessionCookieWriterForTests();
    assert.equal(cookieCount, 1);
    record(currentCase);
  }

  currentCase = "registration_session_ordering_a";
  {
    const user = await createRegistration("ordering-a", "ACTIVE", "ADMIN");
    const reset = await createReset(user);
    const gate = barrier();
    let cookieToken = "";
    setUserSessionCookieWriterForTests(async ({ token }) => {
      cookieToken = token;
    });
    setCredentialMutationHooksForTests({
      afterUserRowLockedForSession: () => gate.wait(),
    });
    const sessionPromise = createUserSession(user.id, {
      expectedCredentialGeneration: user.credentialGeneration,
    });
    await gate.arrived;
    let resetDone = false;
    const resetPromise = resetPasswordWithToken({
      rawToken: reset.rawToken,
      newPassword: `New-${randomBytes(12).toString("base64url")}!`,
    }).finally(() => {
      resetDone = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resetDone, false);
    gate.release();
    await sessionPromise;
    assert.equal(await resetPromise, true);
    clearCredentialMutationHooksForTests();
    clearUserSessionCookieWriterForTests();
    assert.ok(cookieToken);
    assert.equal(
      await prisma.userSession.count({
        where: {
          sessionTokenHash: hashSessionToken(cookieToken),
        },
      }),
      0,
    );
    record(currentCase);
  }

  currentCase = "registration_session_ordering_b";
  {
    const user = await createRegistration("ordering-b", "ACTIVE", "ADMIN");
    const reset = await createReset(user);
    const gate = barrier();
    let cookieCount = 0;
    setUserSessionCookieWriterForTests(async () => {
      cookieCount += 1;
    });
    setCredentialMutationHooksForTests({
      afterUserRowLockedForCredentialMutation: () => gate.wait(),
    });
    const resetPromise = resetPasswordWithToken({
      rawToken: reset.rawToken,
      newPassword: `New-${randomBytes(12).toString("base64url")}!`,
    });
    await gate.arrived;
    const sessionPromise = createUserSession(user.id, {
      expectedCredentialGeneration: user.credentialGeneration,
    });
    const sessionRejection = assert.rejects(
      sessionPromise,
      StaleCredentialError,
    );
    gate.release();
    assert.equal(await resetPromise, true);
    await sessionRejection;
    clearCredentialMutationHooksForTests();
    clearUserSessionCookieWriterForTests();
    assert.equal(cookieCount, 0);
    assert.equal(
      await prisma.userSession.count({ where: { userId: user.id } }),
      0,
    );
    record(currentCase);
  }

  currentCase = "session_transaction_rollback_and_isolation";
  {
    const user = await createUser("session-rollback");
    const unrelated = await createUser("session-unrelated");
    await createUserSessionToken(unrelated.id, {
      expectedCredentialGeneration: unrelated.credentialGeneration,
    });
    setCredentialMutationHooksForTests({
      afterUserRowLockedForSession: () => {
        throw new Error("forced rollback");
      },
    });
    await assert.rejects(() =>
      createUserSessionToken(user.id, {
        expectedCredentialGeneration: user.credentialGeneration,
      }),
    );
    clearCredentialMutationHooksForTests();
    assert.equal(
      await prisma.userSession.count({ where: { userId: user.id } }),
      0,
    );
    assert.equal(
      await prisma.userSession.count({ where: { userId: unrelated.id } }),
      1,
    );
    record(currentCase);
  }

  currentCase = "session_api_has_no_unguarded_production_caller";
  {
    const repoRoot = process.cwd();
    const sessionSource = await readFile(
      path.join(repoRoot, "lib", "auth", "session.ts"),
      "utf8",
    );
    assert.ok(!sessionSource.includes("expectedCredentialGeneration?:"));
    assert.ok(!sessionSource.includes("meta?:"));

    async function productionFiles(directory: string): Promise<string[]> {
      const output: string[] = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (
          entry.name === "generated" ||
          entry.name.endsWith(".test.ts") ||
          entry.name.endsWith(".test.tsx")
        ) {
          continue;
        }
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) output.push(...(await productionFiles(absolute)));
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          output.push(absolute);
        }
      }
      return output;
    }
    const files = [
      ...(await productionFiles(path.join(repoRoot, "app"))),
      ...(await productionFiles(path.join(repoRoot, "lib"))),
    ];
    for (const file of files) {
      if (file.endsWith(path.join("lib", "auth", "session.ts"))) continue;
      const source = await readFile(file, "utf8");
      if (/\bcreateUserSession(?:Token)?\s*\(/.test(source)) {
        assert.ok(source.includes("expectedCredentialGeneration"));
      }
      assert.ok(!/\.userSession\.(?:create|createMany)\s*\(/.test(source));
    }
    record(currentCase);
  }

  // Actual worker/provider recipient association cases.
  async function recipientCase(params: {
    label: string;
    mutate?: (
      message: Awaited<ReturnType<typeof createReset>>["message"],
      user: Awaited<ReturnType<typeof createUser>>,
    ) => Promise<string[]>;
    sends: boolean;
  }): Promise<void> {
    const user = await createUser(`recipient-${params.label}`);
    const reset = await createReset(user);
    const extraForbidden = params.mutate
      ? await params.mutate(reset.message, user)
      : [];
    const fake = new FakeEmailProvider();
    const result = await quiet(() =>
      runEmailDeliverySweep({
        provider: fake,
        onlyMessageId: reset.message.id,
        limit: 1,
      }),
    );
    assert.equal(fake.sent.length, params.sends ? 1 : 0);
    if (params.sends) {
      assert.equal(fake.sent[0]?.recipientEmail, user.email);
      assert.equal(result.accepted, 1);
    } else {
      await assertFailureSanitized(reset.message.id, [
        user.email,
        reset.rawToken,
        process.env.EMAIL_SENSITIVE_PAYLOAD_KEY!,
        ...extraForbidden,
      ]);
    }
  }

  currentCase = "recipient_field_replacement_rejected";
  await recipientCase({
    label: "recipient-only",
    sends: false,
    mutate: async (message) => {
      const replacement = `${marker}.replacement.one@test.invalid`;
      await prisma!.emailMessage.update({
        where: { id: message.id },
        data: { recipientEmail: replacement },
      });
      return [replacement];
    },
  });
  record(currentCase);

  currentCase = "normalized_recipient_replacement_rejected";
  await recipientCase({
    label: "normalized-only",
    sends: false,
    mutate: async (message) => {
      const replacement = `${marker}.replacement.two@test.invalid`;
      await prisma!.emailMessage.update({
        where: { id: message.id },
        data: { recipientEmailNormalized: replacement },
      });
      return [replacement];
    },
  });
  record(currentCase);

  currentCase = "both_recipient_fields_replaced_rejected";
  await recipientCase({
    label: "both",
    sends: false,
    mutate: async (message) => {
      const replacement = `${marker}.replacement.three@test.invalid`;
      await prisma!.emailMessage.update({
        where: { id: message.id },
        data: {
          recipientEmail: replacement,
          recipientEmailNormalized: replacement,
        },
      });
      return [replacement];
    },
  });
  record(currentCase);

  currentCase = "recipient_case_whitespace_canonicalized";
  await recipientCase({
    label: "case-space",
    sends: true,
    mutate: async (message, user) => {
      await prisma!.emailMessage.update({
        where: { id: message.id },
        data: { recipientEmail: `  ${user.email.toUpperCase()} ` },
      });
      return [];
    },
  });
  record(currentCase);

  currentCase = "recipient_malformed_and_unicode_rejected";
  await recipientCase({
    label: "malformed",
    sends: false,
    mutate: async (message) => {
      await prisma!.emailMessage.update({
        where: { id: message.id },
        data: { recipientEmail: "malformed" },
      });
      return ["malformed"];
    },
  });
  await recipientCase({
    label: "unicode",
    sends: false,
    mutate: async (message) => {
      const unsupported = "usér@example.test";
      await prisma!.emailMessage.update({
        where: { id: message.id },
        data: { recipientEmail: unsupported },
      });
      return [unsupported];
    },
  });
  record(currentCase);

  currentCase = "recipient_correctly_bound";
  await recipientCase({ label: "bound", sends: true });
  record(currentCase);

  // Remaining sensitive association transplants.
  currentCase = "credential_generation_transplant_rejected";
  {
    const user = await createUser("generation-transplant");
    const reset = await createReset(user);
    await prisma.emailMessage.update({
      where: { id: reset.message.id },
      data: {
        metadata: {
          credentialGeneration: user.credentialGeneration + 1,
          sensitive: true,
        },
      },
    });
    const fake = new FakeEmailProvider();
    await quiet(() =>
      runEmailDeliverySweep({
        provider: fake,
        onlyMessageId: reset.message.id,
      }),
    );
    assert.equal(fake.sent.length, 0);
    await assertFailureSanitized(reset.message.id, [
      user.email,
      reset.rawToken,
    ]);
    record(currentCase);
  }

  currentCase = "related_token_transplant_rejected";
  {
    const userA = await createUser("token-transplant-a");
    const userB = await createUser("token-transplant-b");
    const resetA = await createReset(userA);
    const resetB = await createReset(userB);
    await prisma.emailMessage.update({
      where: { id: resetB.message.id },
      data: { relatedTokenId: resetA.message.relatedTokenId },
    });
    const fake = new FakeEmailProvider();
    await quiet(() =>
      runEmailDeliverySweep({
        provider: fake,
        onlyMessageId: resetB.message.id,
      }),
    );
    assert.equal(fake.sent.length, 0);
    await assertFailureSanitized(resetB.message.id, [
      userA.email,
      userB.email,
      resetA.rawToken,
      resetB.rawToken,
    ]);
    record(currentCase);
  }

  currentCase = "raw_token_hash_mismatch_rejected";
  {
    const user = await createUser("hash-mismatch");
    const reset = await createReset(user);
    await prisma.passwordResetToken.update({
      where: { id: reset.message.relatedTokenId! },
      data: {
        tokenHash: createHash("sha256")
          .update(randomBytes(32))
          .digest("hex"),
      },
    });
    const fake = new FakeEmailProvider();
    await quiet(() =>
      runEmailDeliverySweep({
        provider: fake,
        onlyMessageId: reset.message.id,
      }),
    );
    assert.equal(fake.sent.length, 0);
    await assertFailureSanitized(reset.message.id, [
      user.email,
      reset.rawToken,
    ]);
    record(currentCase);
  }

  const admin = await createUser("status-admin", "ACTIVE", "ADMIN");
  type MutationKind =
    | "supersession"
    | "blocked"
    | "rejected"
    | "password-change"
    | "consumption";

  async function mutationFixture(kind: MutationKind, ordering: string) {
    currentCase = `${ordering}_${kind}_fixture_user`;
    const user = await createUser(`${kind}-${ordering}`);
    currentCase = `${ordering}_${kind}_fixture_reset`;
    const reset =
      kind === "supersession"
        ? await seedOldReset(user)
        : await createReset(user);
    currentCase = `${ordering}_${kind}_fixture_ready`;
    const mutate = async () => {
      if (kind === "supersession") {
        await requestPasswordReset({ normalizedEmail: user.email });
      } else if (kind === "blocked" || kind === "rejected") {
        await transitionUserToResetIneligibleStatus({
          targetUserId: user.id,
          adminUserId: admin.id,
          status: kind === "blocked" ? "BLOCKED" : "REJECTED",
          comment: null,
        });
      } else if (kind === "password-change") {
        await commitAuthenticatedPasswordChange({
          user,
          currentPasswordHash: user.passwordHash,
          expectedCredentialGeneration: user.credentialGeneration,
          newPasswordHash: await hashPassword(
            `Changed-${randomBytes(12).toString("base64url")}!`,
          ),
          currentSessionTokenHash: null,
          changedAt: new Date(),
        });
      } else {
        assert.equal(
          await resetPasswordWithToken({
            rawToken: reset.rawToken,
            newPassword: `Consumed-${randomBytes(12).toString("base64url")}!`,
          }),
          true,
        );
      }
    };
    return { user, reset, mutate };
  }

  async function assertMutationState(
    kind: MutationKind,
    fixture: Awaited<ReturnType<typeof mutationFixture>>,
  ): Promise<void> {
    const user = await prisma!.user.findUniqueOrThrow({
      where: { id: fixture.user.id },
    });
    const token = await prisma!.passwordResetToken.findUniqueOrThrow({
      where: { id: fixture.reset.message.relatedTokenId! },
    });
    if (kind === "supersession") {
      assert.ok(token.revokedAt);
      assert.equal(
        await prisma!.passwordResetToken.count({
          where: {
            userId: user.id,
            usedAt: null,
            revokedAt: null,
          },
        }),
        1,
      );
    } else if (kind === "blocked" || kind === "rejected") {
      assert.equal(user.status, kind === "blocked" ? "BLOCKED" : "REJECTED");
      assert.ok(token.revokedAt);
    } else if (kind === "password-change") {
      assert.equal(user.credentialGeneration, 1);
      assert.ok(token.revokedAt);
    } else {
      assert.ok(token.usedAt);
    }
  }

  for (const kind of [
    "supersession",
    "blocked",
    "rejected",
    "password-change",
    "consumption",
  ] as const) {
    currentCase = `worker_first_${kind}`;
    {
      const fixture = await mutationFixture(kind, "worker-first");
      currentCase = `worker_first_${kind}`;
      const gate = barrier();
      const fake = new FakeEmailProvider();
      const workerPromise = quiet(() =>
        runEmailDeliverySweep({
          provider: fake,
          onlyMessageId: fixture.reset.message.id,
          beforeProviderSend: () => gate.wait(),
        }),
      );
      await gate.arrived;
      let mutationDone = false;
      const mutationPromise = fixture.mutate().finally(() => {
        mutationDone = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(mutationDone, false);
      gate.release();
      const workerResult = await workerPromise;
      assert.equal(workerResult.accepted, 1);
      assert.equal(fake.sent.length, 1);
      await mutationPromise;
      await assertMutationState(kind, fixture);
      const message: {
        status: string;
      } = await prisma.emailMessage.findUniqueOrThrow({
        where: { id: fixture.reset.message.id },
      });
      assert.equal(message.status, "ACCEPTED_BY_PROVIDER");
      await fenceReleased(fixture.user.id);
      record(currentCase);
    }

    currentCase = `mutation_first_${kind}`;
    {
      const fixture = await mutationFixture(kind, "mutation-first");
      currentCase = `mutation_first_${kind}`;
      const gate = barrier();
      let armed = true;
      setCredentialDispatchFenceHooksForTests({
        afterFenceAcquired: async (userId) => {
          if (armed && userId === fixture.user.id) {
            armed = false;
            await gate.wait();
          }
        },
      });
      const mutationPromise = fixture.mutate();
      await gate.arrived;
      currentCase = `mutation_first_${kind}_fence_acquired`;
      const fake = new FakeEmailProvider();
      const workerPromise = quiet(() =>
        runEmailDeliverySweep({
          provider: fake,
          onlyMessageId: fixture.reset.message.id,
        }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fake.sent.length, 0);
      gate.release();
      await mutationPromise;
      currentCase = `mutation_first_${kind}_mutation_committed`;
      clearCredentialDispatchFenceHooksForTests();
      const workerResult = await workerPromise;
      currentCase = `mutation_first_${kind}_worker_result`;
      counts.mutationFirstProviderCallsObserved = fake.sent.length;
      counts.mutationFirstCancelledObserved = workerResult.cancelled;
      assert.equal(fake.sent.length, 0);
      assert.equal(workerResult.cancelled, 1);
      currentCase = `mutation_first_${kind}_mutation_state`;
      await assertMutationState(kind, fixture);
      const message: {
        status: string;
        sensitivePayloadCiphertext: string | null;
      } = await prisma.emailMessage.findUniqueOrThrow({
        where: { id: fixture.reset.message.id },
      });
      currentCase = `mutation_first_${kind}_message_state`;
      assert.equal(message.status, "CANCELLED");
      assert.equal(message.sensitivePayloadCiphertext, null);
      await fenceReleased(fixture.user.id);
      currentCase = `mutation_first_${kind}`;
      record(currentCase);
    }
  }

  currentCase = "bounded_advisory_lock_acquisition";
  {
    const user = await createUser("fence-timeout");
    const unrelated = await createUser("fence-unrelated");
    const [key1, key2] = credentialDispatchAdvisoryKeys(user.id);
    const holder = new pg.Client({ connectionString: databaseUrl });
    await holder.connect();
    await holder.query("SELECT pg_advisory_lock($1::int, $2::int)", [
      key1,
      key2,
    ]);
    const started = performance.now();
    try {
      await assert.rejects(
        () =>
          withCredentialDispatchFence(
            user.id,
            async () => undefined,
            { connectionString: databaseUrl, timeoutMs: 100 },
          ),
        CredentialDispatchFenceError,
      );
      assert.ok(performance.now() - started < 1_000);
      await withCredentialDispatchFence(
        unrelated.id,
        async () => undefined,
        { connectionString: databaseUrl, timeoutMs: 100 },
      );
    } finally {
      await holder.query(
        "SELECT pg_advisory_unlock($1::int, $2::int)",
        [key1, key2],
      );
      await holder.end();
    }
    await fenceReleased(user.id);
    record(currentCase);
  }

  currentCase = "provider_exception_timeout_and_cancellation_release_fence";
  {
    const exceptionUser = await createUser("provider-exception");
    const exceptionReset = await createReset(exceptionUser);
    const exceptionProvider = {
      name: "fake-exception",
      transport: "memory",
      async send() {
        throw new Error("provider exception");
      },
    };
    await quiet(() =>
      runEmailDeliverySweep({
        provider: exceptionProvider,
        onlyMessageId: exceptionReset.message.id,
      }),
    );
    await fenceReleased(exceptionUser.id);

    const timeoutUser = await createUser("provider-timeout");
    const timeoutReset = await createReset(timeoutUser);
    const timeoutProvider = {
      name: "fake-timeout",
      transport: "memory",
      async send() {
        return {
          ok: false as const,
          providerName: "fake-timeout",
          transport: "memory",
          retryable: false,
          acceptanceUnknown: true,
          errorCode: "PROVIDER_ACCEPTANCE_UNKNOWN",
          sanitizedMessage: "Provider acceptance could not be confirmed.",
        };
      },
    };
    const timeoutResult = await quiet(() =>
      runEmailDeliverySweep({
        provider: timeoutProvider,
        onlyMessageId: timeoutReset.message.id,
      }),
    );
    assert.equal(timeoutResult.acceptanceUnknown, 1);
    const timeoutMessage = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: timeoutReset.message.id },
    });
    assert.equal(timeoutMessage.status, "ACCEPTANCE_UNKNOWN");
    assert.equal(timeoutMessage.sensitivePayloadCiphertext, null);
    assert.equal(timeoutMessage.sensitivePayloadNonce, null);
    assert.ok(timeoutMessage.sensitivePayloadClearedAt);
    const laterFake = new FakeEmailProvider();
    await quiet(() =>
      runEmailDeliverySweep({
        provider: laterFake,
        onlyMessageId: timeoutReset.message.id,
      }),
    );
    assert.equal(laterFake.sent.length, 0);
    await quiet(() =>
      runEmailRetentionCleanup({
        now: new Date(Date.now() + 2 * 24 * 60 * 60_000),
        limit: 100,
      }),
    );
    await quiet(() =>
      runEmailRetentionCleanup({
        now: new Date(Date.now() + 2 * 24 * 60 * 60_000),
        limit: 100,
      }),
    );
    await fenceReleased(timeoutUser.id);

    const cancelUser = await createUser("provider-cancel");
    const cancelReset = await createReset(cancelUser);
    const cancelProvider = {
      name: "fake-cancel",
      transport: "memory",
      async send() {
        const error = new Error("cancelled");
        error.name = "AbortError";
        throw error;
      },
    };
    await quiet(() =>
      runEmailDeliverySweep({
        provider: cancelProvider,
        onlyMessageId: cancelReset.message.id,
      }),
    );
    await fenceReleased(cancelUser.id);
    record(currentCase);
  }

  currentCase = "worker_acquisition_abort_reschedules_and_releases";
  {
    const user = await createUser("worker-abort");
    const reset = await createReset(user);
    const [key1, key2] = credentialDispatchAdvisoryKeys(user.id);
    const holder = new pg.Client({ connectionString: databaseUrl });
    await holder.connect();
    await holder.query("SELECT pg_advisory_lock($1::int, $2::int)", [
      key1,
      key2,
    ]);
    const controller = new AbortController();
    const fake = new FakeEmailProvider();
    const sweepPromise = quiet(() =>
      runEmailDeliverySweep({
        provider: fake,
        onlyMessageId: reset.message.id,
        signal: controller.signal,
      }),
    );
    controller.abort();
    const result = await sweepPromise;
    assert.equal(fake.sent.length, 0);
    assert.equal(result.retryableFailures, 1);
    await holder.query(
      "SELECT pg_advisory_unlock($1::int, $2::int)",
      [key1, key2],
    );
    await holder.end();
    await fenceReleased(user.id);
    record(currentCase);
  }

  currentCase = "isolated_one_message_canary";
  {
    const selectedUser = await createUser("canary-selected");
    const untouchedUser = await createUser("canary-untouched");
    const selected = await createReset(selectedUser);
    const untouched = await createReset(untouchedUser);
    const fake = new FakeEmailProvider();
    const result = await quiet(() =>
      runOneMessageEmailCanary({
        messageId: selected.message.id,
        provider: fake,
      }),
    );
    assert.equal(result.scanned, 1);
    assert.equal(result.claimed, 1);
    assert.equal(result.accepted, 1);
    assert.equal(fake.sent.length, 1);
    const untouchedMessage = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: untouched.message.id },
    });
    assert.equal(untouchedMessage.status, "PENDING");

    process.env.EMAIL_DELIVERY_ENABLED = "false";
    await assert.rejects(
      () =>
        runOneMessageEmailCanary({
          messageId: untouched.message.id,
          provider: fake,
        }),
      EmailCanaryError,
    );
    process.env.EMAIL_DELIVERY_ENABLED = "true";
    assert.equal(fake.sent.length, 1);
    record(currentCase);
  }

  currentCase = "bounded_backlog_quarantine";
  {
    const fixtures: Array<Awaited<ReturnType<typeof createReset>>> = [];
    for (const label of [
      "expired",
      "consumed",
      "superseded",
      "generation",
      "status",
      "legacy",
    ]) {
      const user = await createUser(`quarantine-${label}`);
      const reset = await createReset(user);
      fixtures.push(reset);
      if (label === "expired") {
        await prisma.passwordResetToken.update({
          where: { id: reset.message.relatedTokenId! },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });
      } else if (label === "consumed") {
        await prisma.passwordResetToken.update({
          where: { id: reset.message.relatedTokenId! },
          data: { usedAt: new Date() },
        });
      } else if (label === "superseded") {
        await prisma.passwordResetToken.update({
          where: { id: reset.message.relatedTokenId! },
          data: { revokedAt: new Date() },
        });
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashPasswordResetToken(
              generatePasswordResetToken(),
            ),
            expiresAt: new Date(Date.now() + 30 * 60_000),
            createdAt: new Date(Date.now() + 1_000),
          },
        });
      } else if (label === "generation") {
        await prisma.user.update({
          where: { id: user.id },
          data: { credentialGeneration: { increment: 1 } },
        });
      } else if (label === "status") {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: "BLOCKED" },
        });
      } else {
        await prisma.emailMessage.update({
          where: { id: reset.message.id },
          data: {
            renderedTextBody: "legacy content",
            renderedHtmlBody: "<p>legacy content</p>",
          },
        });
      }
    }

    const dryRun = await quarantineStalePasswordResetBacklog({
      apply: false,
      limit: 2,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.scanned, 2);
    assert.equal(dryRun.quarantined, 0);
    const firstBefore = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: fixtures[0]!.message.id },
    });
    assert.notEqual(firstBefore.status, "CANCELLED");

    const applied = await quarantineStalePasswordResetBacklog({
      apply: true,
      limit: 500,
    });
    assert.equal(applied.partialFailures, 0);
    assert.ok(applied.classifications.expired >= 1);
    assert.ok(applied.classifications.consumed >= 1);
    assert.ok(applied.classifications.superseded >= 1);
    assert.ok(applied.classifications.generationMismatched >= 1);
    assert.ok(applied.classifications.statusIneligible >= 1);
    assert.ok(applied.classifications.legacyPlaintext >= 1);
    for (const fixture of fixtures) {
      const message: {
        status: string;
        sensitivePayloadCiphertext: string | null;
        sensitivePayloadNonce: string | null;
      } = await prisma.emailMessage.findUniqueOrThrow({
        where: { id: fixture.message.id },
      });
      assert.equal(message.status, "CANCELLED");
      assert.equal(message.sensitivePayloadCiphertext, null);
      assert.equal(message.sensitivePayloadNonce, null);
    }
    const repeated = await quarantineStalePasswordResetBacklog({
      apply: true,
      limit: 500,
    });
    assert.equal(repeated.partialFailures, 0);
    assert.equal(repeated.wouldQuarantine, 0);
    record(currentCase);
  }

  currentCase = "eligibility_enabling_transition_cannot_revive_reset";
  {
    const user = await createUser("unfenced-eligibility");
    const reset = await createReset(user);
    const tokenId = reset.message.relatedTokenId!;

    // 1. Block through the fenced production transition.
    await transitionUserToResetIneligibleStatus({
      targetUserId: user.id,
      adminUserId: admin.id,
      status: "BLOCKED",
      comment: null,
    });

    // 2. Active token revoked and pending reset message cancelled.
    const revokedToken = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { id: tokenId },
    });
    const revokedAt = revokedToken.revokedAt;
    assert.ok(revokedAt);
    const cancelledMessage = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: reset.message.id },
    });
    assert.equal(cancelledMessage.status, "CANCELLED");
    assert.equal(cancelledMessage.sensitivePayloadCiphertext, null);

    // 3. Unblock: the same unfenced User + AdminActionLog write performed by
    //    app/actions/admin-users.ts unblockUser.
    const unblockedAt = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          status: "ACTIVE",
          approvedAt: unblockedAt,
          approvedByUserId: admin.id,
          blockedAt: null,
          blockedByUserId: null,
          rejectedAt: null,
          rejectedByUserId: null,
        },
      }),
      prisma.adminActionLog.create({
        data: {
          adminUserId: admin.id,
          targetUserId: user.id,
          action: "USER_UNBLOCKED",
          comment: null,
        },
      }),
    ]);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status,
      "ACTIVE",
    );

    // 4. The revoked token stays revoked with the same revocation timestamp.
    const tokenAfterUnblock =
      await prisma.passwordResetToken.findUniqueOrThrow({
        where: { id: tokenId },
      });
    assert.equal(tokenAfterUnblock.revokedAt?.getTime(), revokedAt.getTime());
    assert.equal(tokenAfterUnblock.usedAt, null);
    assert.equal(
      (
        await dispatch.evaluatePasswordResetDispatchEligibility({
          relatedTokenId: tokenId,
          userId: user.id,
        })
      ).ok,
      false,
    );

    // 5. The cancelled message remains non-claimable even when targeted.
    const targetedProvider = new FakeEmailProvider();
    const targeted = await quiet(() =>
      runEmailDeliverySweep({
        provider: targetedProvider,
        onlyMessageId: reset.message.id,
        limit: 1,
      }),
    );
    assert.equal(targetedProvider.sent.length, 0);
    assert.equal(targeted.claimed, 0);
    assert.equal(targeted.accepted, 0);

    // 6. A normal delivery sweep never reaches the provider for this account.
    const sweepProvider = new FakeEmailProvider();
    await quiet(() =>
      runEmailDeliverySweep({ provider: sweepProvider, limit: 500 }),
    );
    assert.ok(
      sweepProvider.sent.every((sent) => sent.recipientEmail !== user.email),
    );
    const messageAfterSweep = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: reset.message.id },
    });
    assert.equal(messageAfterSweep.status, "CANCELLED");
    assert.equal(messageAfterSweep.sensitivePayloadCiphertext, null);

    // 7. Eligibility-enabling admin transitions write no reset token or
    //    reset message, which is why they need no fence.
    const adminActionsSource = await readFile(
      path.join(process.cwd(), "app", "actions", "admin-users.ts"),
      "utf8",
    );
    assert.ok(!adminActionsSource.includes("passwordResetToken"));
    assert.ok(!adminActionsSource.includes("emailMessage"));
    assert.ok(!adminActionsSource.includes("sensitivePayload"));

    await fenceReleased(user.id);
    record(currentCase);
  }

  currentCase = "invalid_timeout_configuration_fails_closed";
  {
    assert.throws(
      () => fence.resolveCredentialDispatchFenceTimeoutMs("unbounded"),
      CredentialDispatchFenceError,
    );
    record(currentCase);
  }

  currentCase = "no_permanent_advisory_locks";
  const lockCheck = new pg.Client({ connectionString: databaseUrl });
  await lockCheck.connect();
  const locks = await lockCheck.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM pg_locks l
     JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'advisory'
       AND l.granted
       AND a.application_name = $1`,
    [STAGE313C_VERIFIER_APPLICATION_NAME],
  );
  await lockCheck.end();
  assert.equal(Number(locks.rows[0]?.count ?? 0), 0);
  record("no_permanent_advisory_locks");
}

async function cleanup(): Promise<void> {
  if (!prisma) return;
  await clearHooksSafely();
  if (ownedUserIds.length > 0) {
    await prisma.adminActionLog.deleteMany({
      where: {
        OR: [
          { adminUserId: { in: ownedUserIds } },
          { targetUserId: { in: ownedUserIds } },
        ],
      },
    });
    await prisma.emailMessage.deleteMany({
      where: { userId: { in: ownedUserIds } },
    });
    await prisma.passwordResetToken.deleteMany({
      where: { userId: { in: ownedUserIds } },
    });
    await prisma.userSession.deleteMany({
      where: { userId: { in: ownedUserIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: ownedUserIds } },
    });
  }
  if (ownedEmails.length > 0) {
    await prisma.emailSuppression.deleteMany({
      where: {
        recipientEmailNormalized: { in: ownedEmails },
      },
    });
  }
  const remaining = await Promise.all([
    prisma.user.count(),
    prisma.userSession.count(),
    prisma.passwordResetToken.count(),
    prisma.emailMessage.count(),
    prisma.emailDeliveryAttempt.count(),
    prisma.emailSuppression.count(),
    prisma.adminActionLog.count(),
    prisma.userConsent.count(),
  ]);
  assert.deepEqual(remaining, [0, 0, 0, 0, 0, 0, 0, 0]);
  counts.cleanupTablesVerified = remaining.length;
  record("persistent_schema_resource_cleanup");
}

async function clearHooksSafely(): Promise<void> {
  const concurrency = await import("@/lib/auth/credential-concurrency");
  concurrency.clearCredentialMutationHooksForTests();
  const fence = await import("@/lib/auth/credential-dispatch-fence");
  fence.clearCredentialDispatchFenceHooksForTests();
  const session = await import("@/lib/auth/session");
  session.clearUserSessionCookieWriterForTests();
}

const originalLog = console.log;
const originalError = console.error;

async function run(): Promise<void> {
  let succeeded = false;
  try {
    await main();
    succeeded = true;
  } catch (error) {
    process.exitCode = 1;
    const structuredCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : null;
    const messageCategory =
      error instanceof Error
        ? /invalid email/i.test(error.message)
          ? "INVALID_EMAIL"
          : /unique constraint/i.test(error.message)
            ? "UNIQUE_CONSTRAINT"
            : /serializ|transaction/i.test(error.message)
              ? "TRANSACTION"
              : /timeout|timed out/i.test(error.message)
                ? "TIMEOUT"
                : /credential dispatch|advisory/i.test(error.message)
                  ? "CREDENTIAL_FENCE"
                  : /sensitive payload|encrypt|decrypt/i.test(error.message)
                    ? "SENSITIVE_PAYLOAD"
                    : /configuration|environment|invalid [A-Z_]+/i.test(
                          error.message,
                        )
                      ? "CONFIGURATION"
                      : /raw token|idempotency|metadata/i.test(error.message)
                        ? "EMAIL_CONTENT_POLICY"
                        : null
        : null;
    const code =
      error instanceof VerifierRefusal
        ? error.code
        : structuredCode
          ? `FINAL_REMEDIATION_ERROR_${structuredCode}`
        : messageCategory
          ? `FINAL_REMEDIATION_ERROR_${messageCategory}`
        : error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
          ? `FINAL_REMEDIATION_${error.name.toUpperCase()}`
          : "FINAL_REMEDIATION_VERIFICATION_FAILED";
    originalError(
      JSON.stringify({
        ok: false,
        counts: { ...counts, failures: 1 },
        cases: [...cases, currentCase, code],
        ids: { runId },
      }),
    );
  } finally {
    try {
      await cleanup();
    } catch {
      succeeded = false;
      process.exitCode = 1;
      originalError(
        JSON.stringify({
          ok: false,
          counts: { cleanupFailures: 1 },
          cases: ["FINAL_REMEDIATION_CLEANUP_FAILED"],
          ids: { runId },
        }),
      );
    } finally {
      await prisma?.$disconnect();
    }
  }

  if (succeeded) {
    originalLog(
      JSON.stringify({
        ok: true,
        counts,
        cases,
        ids: { runId },
      }),
    );
  }
}

void run();

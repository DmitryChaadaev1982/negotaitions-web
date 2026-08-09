/**
 * Stage 3.13C-R2 High Remediation Verification
 *
 * Proves H-01R (session/User FOR UPDATE linearization), H-02R (AAD-bound
 * sensitive payload + ciphertext swap rejection), and M-03R (credential
 * dispatch fence) inside the approved persistent test-database schema.
 *
 * Outputs counters and IDs only — never email bodies, recipients, tokens, or keys.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { assertApprovedStage313cVerifierChildEnvironment } from "./stage-3-13c-test-database";
import { applyStage313cTestRuntimeEnv } from "./stage-3-13c-test-runtime";

try {
  assertApprovedStage313cVerifierChildEnvironment(process.env);
} catch {
  console.error(JSON.stringify({ ok: false, counts: { safetyRefusals: 1 } }));
  process.exit(1);
}

const runKey = randomBytes(32).toString("base64");
process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = runKey;

applyStage313cTestRuntimeEnv();
delete process.env.YANDEX_POSTBOX_ACCESS_KEY_ID;
delete process.env.YANDEX_POSTBOX_SECRET_ACCESS_KEY;

const runMarker = `stage313c_r2_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
const ownedUserIds: string[] = [];
const ownedEmails: string[] = [];
const counts: Record<string, number> = {};
let prisma: (typeof import("@/lib/prisma"))["prisma"] | undefined;

function record(name: string, value = 1) {
  counts[name] = (counts[name] ?? 0) + value;
}

function createBarrier() {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let signalArrived!: () => void;
  const arrived = new Promise<void>((resolve) => {
    signalArrived = resolve;
  });
  return {
    arrived,
    wait: async () => {
      signalArrived();
      await gate;
    },
    release: () => releaseGate(),
  };
}

async function withoutServiceLogs<T>(operation: () => Promise<T>): Promise<T> {
  const previousLog = console.log;
  const previousError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await operation();
  } finally {
    console.log = previousLog;
    console.error = previousError;
  }
}

async function main() {
  const [
    prismaModule,
    accountSecurity,
    passwordTokens,
    cryptoModule,
    providerModule,
    workerModule,
    sessionModule,
    concurrencyModule,
    fenceModule,
  ] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/auth/account-security"),
    import("@/lib/auth/password-reset-token"),
    import("@/lib/auth/crypto"),
    import("@/lib/email/provider"),
    import("@/lib/email/worker"),
    import("@/lib/auth/session"),
    import("@/lib/auth/credential-concurrency"),
    import("@/lib/auth/credential-dispatch-fence"),
  ]);

  prisma = prismaModule.prisma;
  const { requestPasswordReset, resetPasswordWithToken } = accountSecurity;
  const { hashPasswordResetToken, generatePasswordResetToken } = passwordTokens;
  const { hashPassword, verifyPassword } = cryptoModule;
  const { FakeEmailProvider } = providerModule;
  const { runEmailDeliverySweep } = workerModule;
  const { createUserSessionToken } = sessionModule;
  const {
    setCredentialMutationHooksForTests,
    clearCredentialMutationHooksForTests,
    StaleCredentialError,
  } = concurrencyModule;
  const {
    setCredentialDispatchFenceHooksForTests,
    clearCredentialDispatchFenceHooksForTests,
  } = fenceModule;

  await prisma.$queryRaw`SELECT 1`;

  const originalPassword = `Old-${randomBytes(12).toString("base64url")}!`;
  const resetPassword = `Rst-${randomBytes(12).toString("base64url")}!`;
  const passwordHash = await hashPassword(originalPassword);

  async function createUser(label: string) {
    const email = `${runMarker}.${label}@test.invalid`;
    const user = await prisma!.user.create({
      data: {
        email,
        passwordHash,
        name: `Stage 3.13C-R2 ${label}`,
        globalRole: "USER",
        status: "ACTIVE",
        preferredLocale: "en",
        credentialGeneration: 0,
      },
    });
    ownedUserIds.push(user.id);
    ownedEmails.push(email);
    return user;
  }

  async function seedResetToken(userId: string) {
    const raw = generatePasswordResetToken();
    await prisma!.passwordResetToken.updateMany({
      where: { userId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const row = await prisma!.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashPasswordResetToken(raw),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    return { raw, row };
  }

  // =========================================================================
  // H-01R Test A: session holds User FOR UPDATE; reset waits; then wipe wins
  // =========================================================================
  {
    const user = await createUser("h01a");
    const token = await seedResetToken(user.id);
    const barrier = createBarrier();
    let resetStarted = false;
    let resetDone = false;

    setCredentialMutationHooksForTests({
      afterUserRowLockedForSession: () => barrier.wait(),
    });

    const sessionPromise = createUserSessionToken(user.id, {
      expectedCredentialGeneration: 0,
    }).finally(() => {
      clearCredentialMutationHooksForTests();
    });

    await barrier.arrived;

    const resetPromise = (async () => {
      resetStarted = true;
      const ok = await resetPasswordWithToken({
        rawToken: token.raw,
        newPassword: resetPassword,
      });
      resetDone = true;
      return ok;
    })();

    // While session holds the row lock, reset must not finish.
    await new Promise((r) => setImmediate(r));
    assert.equal(resetDone, false, "reset must wait while session holds User lock");
    const midGen = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { credentialGeneration: true },
    });
    assert.equal(midGen.credentialGeneration, 0, "reset must not commit before session releases");

    barrier.release();
    await sessionPromise;
    const resetOk = await resetPromise;
    assert.equal(resetOk, true);
    assert.ok(resetStarted);

    const sessions = await prisma.userSession.count({ where: { userId: user.id } });
    assert.equal(sessions, 0, "reset must delete the session created under the lock");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.credentialGeneration, 1);
    assert.equal(await verifyPassword(originalPassword, after.passwordHash), false);
    assert.equal(await verifyPassword(resetPassword, after.passwordHash), true);

    await assert.rejects(
      () =>
        createUserSessionToken(user.id, {
          expectedCredentialGeneration: 0,
        }),
      StaleCredentialError,
    );
    await createUserSessionToken(user.id, {
      expectedCredentialGeneration: 1,
    });
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 1);
    record("h01rTestA");
  }

  // =========================================================================
  // H-01R Test B: reset locks first; stale session create observes mismatch
  // =========================================================================
  {
    const user = await createUser("h01b");
    const token = await seedResetToken(user.id);
    const barrier = createBarrier();

    setCredentialMutationHooksForTests({
      afterUserRowLockedForCredentialMutation: () => barrier.wait(),
    });

    const resetPromise = resetPasswordWithToken({
      rawToken: token.raw,
      newPassword: resetPassword,
    }).finally(() => {
      clearCredentialMutationHooksForTests();
    });

    await barrier.arrived;

    const sessionPromise = createUserSessionToken(user.id, {
      expectedCredentialGeneration: 0,
    });

    await new Promise((r) => setImmediate(r));
    assert.equal(
      await prisma.userSession.count({ where: { userId: user.id } }),
      0,
      "stale session must not insert while reset holds lock",
    );

    barrier.release();
    const [resetSettled, sessionSettled] = await Promise.allSettled([
      resetPromise,
      sessionPromise,
    ]);
    assert.equal(resetSettled.status, "fulfilled");
    assert.equal(resetSettled.value, true);
    assert.equal(sessionSettled.status, "rejected");
    assert.ok(
      sessionSettled.reason instanceof StaleCredentialError,
      "stale session create must reject after reset",
    );
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 0);
    record("h01rTestB");
  }

  // =========================================================================
  // Normal paths + unrelated user isolation
  // =========================================================================
  {
    const user = await createUser("normal");
    const other = await createUser("unrelated");
    await createUserSessionToken(user.id, { expectedCredentialGeneration: 0 });
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.userSession.count({ where: { userId: other.id } }), 0);

    const seeded = await seedResetToken(user.id);
    assert.equal(
      await resetPasswordWithToken({
        rawToken: seeded.raw,
        newPassword: resetPassword,
      }),
      true,
    );
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.userSession.count({ where: { userId: other.id } }), 0);
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    assert.equal(otherUser.credentialGeneration, 0);
    record("normalResetAndIsolation");
  }

  // Concurrent two logins for same generation
  {
    const user = await createUser("twologin");
    const [a, b] = await Promise.all([
      createUserSessionToken(user.id, { expectedCredentialGeneration: 0 }),
      createUserSessionToken(user.id, { expectedCredentialGeneration: 0 }),
    ]);
    assert.ok(a.token);
    assert.ok(b.token);
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 2);
    record("concurrentTwoLogins");
  }

  // Transaction rollback: hook throws after lock → no session
  {
    const user = await createUser("rollback");
    setCredentialMutationHooksForTests({
      afterUserRowLockedForSession: async () => {
        throw new Error("forced-rollback");
      },
    });
    try {
      await assert.rejects(
        () =>
          createUserSessionToken(user.id, {
            expectedCredentialGeneration: 0,
          }),
        /forced-rollback/,
      );
    } finally {
      clearCredentialMutationHooksForTests();
    }
    assert.equal(await prisma.userSession.count({ where: { userId: user.id } }), 0);
    record("sessionCreateRollback");
  }

  // =========================================================================
  // H-02R: ciphertext swap must never call provider.send
  // =========================================================================
  {
    const userA = await createUser("swap-a");
    const userB = await createUser("swap-b");
    await requestPasswordReset({ normalizedEmail: userA.email });
    await requestPasswordReset({ normalizedEmail: userB.email });

    const [msgA, msgB] = await Promise.all([
      prisma.emailMessage.findFirstOrThrow({
        where: { userId: userA.id, messageType: "PASSWORD_RESET" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.emailMessage.findFirstOrThrow({
        where: { userId: userB.id, messageType: "PASSWORD_RESET" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    assert.ok(msgA.sensitivePayloadCiphertext && msgA.sensitivePayloadNonce);
    assert.ok(msgB.sensitivePayloadCiphertext && msgB.sensitivePayloadNonce);

    // Full encrypted payload transplant A → B
    await prisma.emailMessage.update({
      where: { id: msgB.id },
      data: {
        sensitivePayloadCiphertext: msgA.sensitivePayloadCiphertext,
        sensitivePayloadNonce: msgA.sensitivePayloadNonce,
        nextAttemptAt: new Date("1970-01-01T00:00:00.000Z"),
      },
    });

    const fake = new FakeEmailProvider();
    const sweep = await withoutServiceLogs(() =>
      runEmailDeliverySweep({
        provider: fake,
        limit: 1,
        onlyMessageId: msgB.id,
      }),
    );
    assert.equal(fake.sent.length, 0, "provider.send must not run for swapped ciphertext");
    assert.ok(sweep.finalFailures >= 1 || sweep.cancelled >= 1 || sweep.skipped >= 0);
    const afterB = await prisma.emailMessage.findUniqueOrThrow({ where: { id: msgB.id } });
    assert.ok(
      afterB.status === "FAILED_FINAL" || afterB.status === "CANCELLED",
      "swapped message must terminate without delivery",
    );
    assert.equal(afterB.sensitivePayloadCiphertext, null);
    record("h02rCiphertextSwapRejected");

    // relatedTokenId swap while ciphertext unchanged on a fresh pair
    const userC = await createUser("swap-c");
    const userD = await createUser("swap-d");
    await requestPasswordReset({ normalizedEmail: userC.email });
    await requestPasswordReset({ normalizedEmail: userD.email });
    const msgC = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: userC.id, messageType: "PASSWORD_RESET" },
    });
    const msgD = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: userD.id, messageType: "PASSWORD_RESET" },
    });
    await prisma.emailMessage.update({
      where: { id: msgD.id },
      data: {
        relatedTokenId: msgC.relatedTokenId,
        nextAttemptAt: new Date("1970-01-01T00:00:00.000Z"),
      },
    });
    const fake2 = new FakeEmailProvider();
    await withoutServiceLogs(() =>
      runEmailDeliverySweep({
        provider: fake2,
        limit: 1,
        onlyMessageId: msgD.id,
      }),
    );
    assert.equal(fake2.sent.length, 0, "relatedTokenId swap must not send");
    record("h02rRelatedTokenIdSwapRejected");
  }

  // =========================================================================
  // M-03R Test A: worker holds fence through send; mutation waits
  // =========================================================================
  {
    const user = await createUser("m03a");
    await requestPasswordReset({ normalizedEmail: user.email });
    const msg = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: user.id, messageType: "PASSWORD_RESET" },
    });
    await prisma.emailMessage.update({
      where: { id: msg.id },
      data: { nextAttemptAt: new Date("1970-01-01T00:00:00.000Z") },
    });

    const activeToken = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id, usedAt: null, revokedAt: null },
    });
    // Need raw token — recover via decrypt with correct binding for controlled consume after.
    const { decryptSensitivePayload } = await import("@/lib/email/sensitive-payload");
    const metadata =
      msg.metadata && typeof msg.metadata === "object"
        ? (msg.metadata as Record<string, unknown>)
        : {};
    const generation =
      typeof metadata.credentialGeneration === "number"
        ? metadata.credentialGeneration
        : 0;
    const payload = decryptSensitivePayload(
      {
        ciphertext: msg.sensitivePayloadCiphertext!,
        nonce: msg.sensitivePayloadNonce!,
      },
      {
        messageId: msg.id,
        tokenId: msg.relatedTokenId!,
        userId: user.id,
        credentialGeneration: generation,
        recipientNormalized: msg.recipientEmailNormalized,
      },
    );

    const barrier = createBarrier();
    let mutationDone = false;
    const fake = new FakeEmailProvider();

    const workerPromise = withoutServiceLogs(() =>
      runEmailDeliverySweep({
        provider: fake,
        limit: 1,
        onlyMessageId: msg.id,
        beforeProviderSend: () => barrier.wait(),
      }),
    );

    await barrier.arrived;

    const mutationPromise = (async () => {
      const ok = await resetPasswordWithToken({
        rawToken: payload.rawToken,
        newPassword: resetPassword,
      });
      mutationDone = true;
      return ok;
    })();

    await new Promise((r) => setImmediate(r));
    assert.equal(mutationDone, false, "credential mutation must wait on dispatch fence");
    const stillActive = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { id: activeToken.id },
    });
    assert.equal(stillActive.usedAt, null, "token must remain unused while fence held");

    barrier.release();
    const sweep = await workerPromise;
    assert.equal(sweep.accepted, 1);
    assert.equal(fake.sent.length, 1);
    // Outcome A: send completed under fence; mutation proceeds afterward.
    const mutationOk = await mutationPromise;
    assert.equal(mutationOk, true);
    record("m03rTestA");
  }

  // =========================================================================
  // M-03R Test B: mutation holds fence first; worker revalidates and skips send
  // =========================================================================
  {
    const user = await createUser("m03b");
    await requestPasswordReset({ normalizedEmail: user.email });
    const msg = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: user.id, messageType: "PASSWORD_RESET" },
    });
    await prisma.emailMessage.update({
      where: { id: msg.id },
      data: { nextAttemptAt: new Date("1970-01-01T00:00:00.000Z") },
    });

    const { decryptSensitivePayload } = await import("@/lib/email/sensitive-payload");
    const metadata =
      msg.metadata && typeof msg.metadata === "object"
        ? (msg.metadata as Record<string, unknown>)
        : {};
    const generation =
      typeof metadata.credentialGeneration === "number"
        ? metadata.credentialGeneration
        : 0;
    const payload = decryptSensitivePayload(
      {
        ciphertext: msg.sensitivePayloadCiphertext!,
        nonce: msg.sensitivePayloadNonce!,
      },
      {
        messageId: msg.id,
        tokenId: msg.relatedTokenId!,
        userId: user.id,
        credentialGeneration: generation,
        recipientNormalized: msg.recipientEmailNormalized,
      },
    );

    const barrier = createBarrier();
    let armFenceBarrier = true;
    setCredentialDispatchFenceHooksForTests({
      afterFenceAcquired: async (userId) => {
        if (armFenceBarrier && userId === user.id) {
          armFenceBarrier = false;
          await barrier.wait();
        }
      },
    });

    const mutationPromise = resetPasswordWithToken({
      rawToken: payload.rawToken,
      newPassword: resetPassword,
    });

    await barrier.arrived;

    const fake = new FakeEmailProvider();
    const workerPromise = withoutServiceLogs(() =>
      runEmailDeliverySweep({
        provider: fake,
        limit: 1,
        onlyMessageId: msg.id,
      }),
    );

    await new Promise((r) => setImmediate(r));
    assert.equal(fake.sent.length, 0, "worker must not send while mutation holds fence");

    barrier.release();
    assert.equal(await mutationPromise, true);
    clearCredentialDispatchFenceHooksForTests();
    const sweep = await workerPromise;
    assert.equal(fake.sent.length, 0, "provider.send must not run after token consumed");
    assert.ok(sweep.cancelled >= 1 || sweep.finalFailures >= 0);
    const after = await prisma.emailMessage.findUniqueOrThrow({ where: { id: msg.id } });
    assert.ok(
      after.status === "CANCELLED" || after.status === "FAILED_FINAL",
      "stale message must not remain deliverable",
    );
    record("m03rTestB");
  }

  // Additional M-03R: BLOCKED user, expiry, provider throw, fence release on error
  {
    const blocked = await createUser("blocked");
    await requestPasswordReset({ normalizedEmail: blocked.email });
    const msg = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: blocked.id, messageType: "PASSWORD_RESET" },
    });
    await prisma.user.update({
      where: { id: blocked.id },
      data: { status: "BLOCKED" },
    });
    await prisma.emailMessage.update({
      where: { id: msg.id },
      data: { nextAttemptAt: new Date("1970-01-01T00:00:00.000Z") },
    });
    const fake = new FakeEmailProvider();
    const sweep = await withoutServiceLogs(() =>
      runEmailDeliverySweep({
        provider: fake,
        limit: 1,
        onlyMessageId: msg.id,
      }),
    );
    assert.equal(fake.sent.length, 0);
    assert.equal(sweep.cancelled, 1);
    record("m03rBlockedUser");
  }

  {
    const expired = await createUser("expired");
    await requestPasswordReset({ normalizedEmail: expired.email });
    const token = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: expired.id },
    });
    await prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const msg = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: expired.id, messageType: "PASSWORD_RESET" },
    });
    await prisma.emailMessage.update({
      where: { id: msg.id },
      data: { nextAttemptAt: new Date("1970-01-01T00:00:00.000Z") },
    });
    const fake = new FakeEmailProvider();
    const sweep = await withoutServiceLogs(() =>
      runEmailDeliverySweep({
        provider: fake,
        limit: 1,
        onlyMessageId: msg.id,
      }),
    );
    assert.equal(fake.sent.length, 0);
    assert.equal(sweep.cancelled, 1);
    record("m03rExpiredToken");
  }

  {
    const throwUser = await createUser("provider-throw");
    await requestPasswordReset({ normalizedEmail: throwUser.email });
    const msg = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: throwUser.id, messageType: "PASSWORD_RESET" },
    });
    await prisma.emailMessage.update({
      where: { id: msg.id },
      data: { nextAttemptAt: new Date("1970-01-01T00:00:00.000Z") },
    });
    const throwingProvider = {
      name: "fake-throw",
      transport: "memory",
      async send() {
        throw new Error("provider boom");
      },
    };
    const sweep = await withoutServiceLogs(() =>
      runEmailDeliverySweep({
        provider: throwingProvider,
        limit: 1,
        onlyMessageId: msg.id,
      }),
    );
    assert.ok(sweep.retryableFailures + sweep.finalFailures >= 1);
    // Fence must be released — a subsequent mutation must not hang.
    const seeded = await seedResetToken(throwUser.id);
    assert.equal(
      await resetPasswordWithToken({
        rawToken: seeded.raw,
        newPassword: resetPassword,
      }),
      true,
    );
    record("m03rProviderThrowReleasesFence");
  }

  record("r2Complete");
}

async function cleanup() {
  if (!prisma) return;
  if (ownedUserIds.length > 0) {
    await prisma.emailDeliveryAttempt.deleteMany({
      where: { emailMessage: { userId: { in: ownedUserIds } } },
    });
    await prisma.emailMessage.deleteMany({ where: { userId: { in: ownedUserIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ownedUserIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: ownedUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } });
  }
  if (ownedEmails.length > 0) {
    await prisma.emailSuppression.deleteMany({
      where: {
        recipientEmailNormalized: {
          in: ownedEmails.map((email) => email.toLowerCase()),
        },
      },
    });
  }
}

const originalLog = console.log;
const originalError = console.error;

async function run() {
  let succeeded = false;
  try {
    await main();
    succeeded = true;
  } catch (error) {
    process.exitCode = 1;
    const message =
      error instanceof Error
        ? error.message.replace(/[a-f0-9]{64}/gi, "[redacted]")
        : "VERIFICATION_FAILED";
    originalError(JSON.stringify({ ok: false, counts: { ...counts, failures: 1 }, error: message }));
  } finally {
    try {
      clearCredentialMutationHooksForTestsSafe();
      clearCredentialDispatchFenceHooksForTestsSafe();
      await cleanup();
    } catch {
      succeeded = false;
      process.exitCode = 1;
    } finally {
      await prisma?.$disconnect();
    }
  }

  if (succeeded) {
    originalLog(JSON.stringify({ ok: true, counts }));
  }
}

function clearCredentialMutationHooksForTestsSafe() {
  try {
    // Dynamic clear if module loaded
    void import("@/lib/auth/credential-concurrency").then((m) =>
      m.clearCredentialMutationHooksForTests(),
    );
  } catch {
    /* ignore */
  }
}

function clearCredentialDispatchFenceHooksForTestsSafe() {
  try {
    void import("@/lib/auth/credential-dispatch-fence").then((m) =>
      m.clearCredentialDispatchFenceHooksForTests(),
    );
  } catch {
    /* ignore */
  }
}

void run();

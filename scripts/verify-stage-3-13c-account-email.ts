import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

import { assertApprovedStage313cVerifierChildEnvironment } from "./stage-3-13c-test-database";

let expectedSchema: string;
try {
  expectedSchema =
    assertApprovedStage313cVerifierChildEnvironment(process.env).schemaName;
} catch {
  console.error(JSON.stringify({ ok: false, counts: { safetyRefusals: 1 } }));
  process.exit(1);
}

const RESET_TO_DEFAULT = [
  "EMAIL_ADMIN_TEST_ENABLED",
  "EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS",
  "EMAIL_CONTENT_RETENTION_DAYS",
  "EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS",
  "EMAIL_FROM_INVITATIONS",
  "EMAIL_FROM_NO_REPLY",
  "EMAIL_FROM_NOTIFICATIONS",
  "EMAIL_MAX_ATTEMPTS",
  "EMAIL_OPERATOR_NAME",
  "EMAIL_PROCESSING_LEASE_SECONDS",
  "EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS",
  "EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS",
  "EMAIL_PROVIDER_EVENT_RETENTION_DAYS",
  "EMAIL_PROVIDER_ID_RETENTION_DAYS",
  "EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS",
  "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS",
  "EMAIL_REPLY_TO_BUSINESS",
  "EMAIL_REPLY_TO_SECURITY",
  "EMAIL_REPLY_TO_SUPPORT",
  "EMAIL_RETRY_BASE_SECONDS",
  "EMAIL_RETRY_MAX_SECONDS",
  "EMAIL_WORKER_BATCH_SIZE",
  "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
  "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
  "PASSWORD_RESET_TOKEN_TTL_MINUTES",
  "YANDEX_POSTBOX_ACCESS_KEY_ID",
  "YANDEX_POSTBOX_CONFIGURATION_SET",
  "YANDEX_POSTBOX_ENDPOINT",
  "YANDEX_POSTBOX_REGION",
  "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
] as const;

for (const key of RESET_TO_DEFAULT) delete process.env[key];

// Generate a run-specific AEAD key; never printed.
if (!process.env.EMAIL_SENSITIVE_PAYLOAD_KEY) {
  process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = randomBytes(32).toString("base64");
}

Object.assign(process.env, {
  EMAIL_DELIVERY_ENABLED: "true",
  EMAIL_PROVIDER: "fake",
  EMAIL_CANONICAL_BASE_URL: "https://local.negotaitions.ru",
  EMAIL_LOCAL_PREVIEW_ENABLED: "true",
});

const runMarker = `stage313c_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
const ownedUserIds: string[] = [];
const ownedEmails: string[] = [];
const pendingRegistrationIds: string[] = [];
const counts: Record<string, number> = {};
let prisma: (typeof import("@/lib/prisma"))["prisma"] | undefined;
let currentCase = "bootstrap";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rawToken(): string {
  return randomBytes(32).toString("hex");
}

function record(name: string, value: number) {
  counts[name] = value;
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
    suppressionModule,
    addressModule,
    generated,
    accountEmail,
    credentialFence,
  ] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/auth/account-security"),
    import("@/lib/auth/password-reset-token"),
    import("@/lib/auth/crypto"),
    import("@/lib/email/provider"),
    import("@/lib/email/worker"),
    import("@/lib/email/suppression"),
    import("@/lib/email/address"),
    import("@/app/generated/prisma/client"),
    import("@/lib/email/account-security"),
    import("@/lib/auth/credential-dispatch-fence"),
  ]);
  prisma = prismaModule.prisma;
  const { requestPasswordReset, resetPasswordWithToken } = accountSecurity;
  const { hashPasswordResetToken } = passwordTokens;
  const { hashPassword, verifyPassword } = cryptoModule;
  const { FakeEmailProvider } = providerModule;
  const { runEmailDeliverySweep } = workerModule;
  const { createActiveSuppression } = suppressionModule;
  const { normalizeEmailAddress } = addressModule;
  const { EmailSuppressionReason, EmailSuppressionSource, EmailMessageStatus } = generated;
  const { notifyActiveAdminsOfPendingRegistration } = accountEmail;
  const {
    clearCredentialDispatchFenceHooksForTests,
    setCredentialDispatchFenceHooksForTests,
  } = credentialFence;

  currentCase = "prisma_search_path";
  const searchPath = await prisma.$queryRaw<{ schema_name: string | null }[]>`
    SELECT current_schema() AS schema_name
  `;
  assert.equal(searchPath[0]?.schema_name, expectedSchema);
  await prisma.$queryRaw`SELECT 1`;
  const originalPassword = `Old-${randomBytes(12).toString("base64url")}!`;
  const newPassword = `New-${randomBytes(12).toString("base64url")}!`;
  const passwordHash = await hashPassword(originalPassword);

  async function createUser(
    label: string,
    status: "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "BLOCKED",
    globalRole: "USER" | "ADMIN" = "USER",
    emailOverride?: string,
  ) {
    const email = emailOverride ?? `${runMarker}.${label}@test.invalid`;
    const user = await prisma!.user.create({
      data: {
        email,
        passwordHash,
        name: `Stage 3.13C ${label}`,
        globalRole,
        status,
        preferredLocale: "en",
      },
    });
    ownedUserIds.push(user.id);
    ownedEmails.push(email);
    return user;
  }

  async function createResetToken(
    userId: string,
    options: {
      token?: string;
      expiresAt?: Date;
      usedAt?: Date;
      revokedAt?: Date;
      createdAt?: Date;
    } = {},
  ) {
    const token = options.token ?? rawToken();
    const row = await prisma!.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashPasswordResetToken(token),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * 60_000),
        usedAt: options.usedAt,
        revokedAt: options.revokedAt,
        createdAt: options.createdAt,
      },
    });
    return { raw: token, row };
  }

  async function messagesFor(userId: string, messageType?: string) {
    return prisma!.emailMessage.findMany({
      where: {
        userId,
        ...(messageType ? { messageType: messageType as never } : {}),
      },
      include: { attempts: true },
      orderBy: { createdAt: "asc" },
    });
  }

  currentCase = "active_password_reset_request";
  const active = await createUser("active-request", "ACTIVE");
  record(
    "activeUsersObserved",
    await prisma.user.count({ where: { email: active.email, status: "ACTIVE" } }),
  );
  const rawActiveUsers = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM "User"
    WHERE id = ${active.id}
  `;
  record("rawActiveUsersObserved", Number(rawActiveUsers[0]?.count ?? 0));
  let activeFenceAcquisitions = 0;
  setCredentialDispatchFenceHooksForTests({
    afterFenceAcquired: () => {
      activeFenceAcquisitions += 1;
    },
  });
  currentCase = "active_password_reset_dispatch";
  await requestPasswordReset({ normalizedEmail: active.email });
  clearCredentialDispatchFenceHooksForTests();
  record("activeFenceAcquisitions", activeFenceAcquisitions);
  currentCase = "active_password_reset_persistence";
  const activeTokens = await prisma.passwordResetToken.findMany({
    where: { userId: active.id },
  });
  const activeMessages = await messagesFor(active.id, "PASSWORD_RESET");
  currentCase = "active_password_reset_counts";
  record("activeTokensObserved", activeTokens.length);
  record("activeMessagesObserved", activeMessages.length);
  assert.equal(activeTokens.length, 1);
  assert.equal(activeMessages.length, 1);
  const activeMessage = activeMessages[0]!;
  currentCase = "active_password_reset_status";
  assert.ok(
    activeMessage.status === EmailMessageStatus.PENDING ||
      activeMessage.status === EmailMessageStatus.SUPPRESSED,
  );
  currentCase = "active_password_reset_attempts";
  assert.equal(activeMessage.attempts.length, 0);
  assert.equal(activeMessage.attemptCount, 0);
  currentCase = "active_password_reset_deferred_bodies";
  // After remediation: bodies are null before worker (deferred render).
  assert.equal(activeMessage.renderedTextBody, null, "renderedTextBody must be null before worker");
  assert.equal(activeMessage.renderedHtmlBody, null, "renderedHtmlBody must be null before worker");
  currentCase = "active_password_reset_sensitive_payload";
  // Sensitive payload must be present (ciphertext) and token must not appear in DB.
  assert.ok(activeMessage.sensitivePayloadCiphertext, "sensitive payload ciphertext must be present");
  assert.ok(activeMessage.sensitivePayloadNonce, "sensitive payload nonce must be present");
  currentCase = "active_password_reset_metadata";
  // The raw token must not be in metadata or any text column.
  assert.ok(!JSON.stringify(activeTokens[0]).includes(activeTokens[0]!.tokenHash.slice(0, 8) + "nope"));
  assert.ok(!JSON.stringify(activeMessage.metadata ?? {}).includes("rawToken"));
  record("activeRequestTokens", activeTokens.length);
  record("activeRequestMessages", activeMessages.length);
  record("activeRequestAttempts", activeMessage.attempts.length);

  currentCase = "password_reset_supersession";
  const supersededUser = await createUser("superseded", "ACTIVE");
  const previous = await createResetToken(supersededUser.id, {
    createdAt: new Date(Date.now() - 2 * 60_000),
  });
  await requestPasswordReset({ normalizedEmail: supersededUser.email });
  const supersededRows = await prisma.passwordResetToken.findMany({
    where: { userId: supersededUser.id },
  });
  const previousRow = supersededRows.find((row) => row.id === previous.row.id);
  assert.equal(supersededRows.length, 2);
  assert.ok(previousRow?.revokedAt);
  assert.equal(
    supersededRows.filter((row) => !row.usedAt && !row.revokedAt && row.expiresAt > new Date()).length,
    1,
  );
  record("supersededTokens", supersededRows.filter((row) => Boolean(row.revokedAt)).length);
  record(
    "maximumActiveTokens",
    supersededRows.filter((row) => !row.usedAt && !row.revokedAt && row.expiresAt > new Date()).length,
  );

  currentCase = "ineligible_password_reset_requests";
  const blocked = await createUser("blocked-request", "BLOCKED");
  const rejected = await createUser("rejected-request", "REJECTED");
  const pending = await createUser("pending-request", "PENDING_APPROVAL");
  const unknownEmail = `${runMarker}.unknown@test.invalid`;
  await Promise.all([
    requestPasswordReset({ normalizedEmail: blocked.email }),
    requestPasswordReset({ normalizedEmail: rejected.email }),
    requestPasswordReset({ normalizedEmail: pending.email }),
    requestPasswordReset({ normalizedEmail: unknownEmail }),
  ]);
  for (const denied of [blocked, rejected]) {
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: denied.id } }), 0);
    assert.equal(
      await prisma.emailMessage.count({
        where: { userId: denied.id, messageType: "ACCOUNT_RECOVERY_DENIED" },
      }),
      1,
    );
  }
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: pending.id } }), 0);
  assert.equal(await prisma.emailMessage.count({ where: { userId: pending.id } }), 0);
  assert.equal(
    await prisma.emailMessage.count({
      where: { recipientEmailNormalized: normalizeEmailAddress(unknownEmail) },
    }),
    0,
  );
  record("deniedRecoveryMessages", 2);
  record("pendingOrUnknownMessages", 0);

  currentCase = "valid_password_reset";
  const resetUser = await createUser("valid-reset", "ACTIVE");
  const target = await createResetToken(resetUser.id);
  const sibling = await createResetToken(resetUser.id, {
    createdAt: new Date(Date.now() - 60_000),
    revokedAt: new Date(Date.now() - 30_000),
  });
  await prisma.userSession.createMany({
    data: [1, 2].map((index) => ({
      userId: resetUser.id,
      sessionTokenHash: sha256(`${runMarker}:valid-session:${index}`),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })),
  });
  assert.equal(
    await resetPasswordWithToken({ rawToken: target.raw, newPassword }),
    true,
  );
  const resetAfter = await prisma.user.findUniqueOrThrow({ where: { id: resetUser.id } });
  const targetAfter = await prisma.passwordResetToken.findUniqueOrThrow({
    where: { id: target.row.id },
  });
  const siblingAfter = await prisma.passwordResetToken.findUniqueOrThrow({
    where: { id: sibling.row.id },
  });
  assert.equal(await verifyPassword(originalPassword, resetAfter.passwordHash), false);
  assert.equal(await verifyPassword(newPassword, resetAfter.passwordHash), true);
  assert.ok(targetAfter.usedAt);
  assert.ok(siblingAfter.revokedAt);
  assert.equal(await prisma.userSession.count({ where: { userId: resetUser.id } }), 0);
  assert.equal(
    await prisma.emailMessage.count({
      where: { userId: resetUser.id, messageType: "PASSWORD_CHANGED" },
    }),
    1,
  );
  assert.equal(
    await resetPasswordWithToken({ rawToken: target.raw, newPassword }),
    false,
  );
  record("validResetSucceeded", 1);
  record("validResetSessionsRemaining", 0);
  record("validResetPasswordChangedMessages", 1);
  record("validResetReuseSucceeded", 0);
  record("revokedSiblingRemainedInvalid", siblingAfter.revokedAt ? 1 : 0);

  currentCase = "invalid_password_reset_tokens";
  const expiredUser = await createUser("expired-token", "ACTIVE");
  const usedUser = await createUser("used-token", "ACTIVE");
  const revokedUser = await createUser("revoked-token", "ACTIVE");
  const becameBlockedUser = await createUser("became-blocked", "ACTIVE");
  const expiredToken = await createResetToken(expiredUser.id, {
    expiresAt: new Date(Date.now() - 1_000),
  });
  const usedToken = await createResetToken(usedUser.id, { usedAt: new Date() });
  const revokedToken = await createResetToken(revokedUser.id, { revokedAt: new Date() });
  const blockedToken = await createResetToken(becameBlockedUser.id);
  await prisma.user.update({
    where: { id: becameBlockedUser.id },
    data: { status: "BLOCKED", blockedAt: new Date() },
  });
  const invalidResults = await Promise.all([
    resetPasswordWithToken({ rawToken: expiredToken.raw, newPassword }),
    resetPasswordWithToken({ rawToken: usedToken.raw, newPassword }),
    resetPasswordWithToken({ rawToken: revokedToken.raw, newPassword }),
    resetPasswordWithToken({ rawToken: rawToken(), newPassword }),
    resetPasswordWithToken({ rawToken: blockedToken.raw, newPassword }),
  ]);
  assert.deepEqual(invalidResults, [false, false, false, false, false]);
  record("invalidResetAccepted", invalidResults.filter(Boolean).length);

  currentCase = "concurrent_password_reset";
  const concurrentUser = await createUser("concurrent-reset", "ACTIVE");
  const concurrentToken = await createResetToken(concurrentUser.id);
  const concurrentResults = await Promise.all([
    resetPasswordWithToken({ rawToken: concurrentToken.raw, newPassword }),
    resetPasswordWithToken({ rawToken: concurrentToken.raw, newPassword }),
  ]);
  assert.equal(concurrentResults.filter(Boolean).length, 1);
  assert.equal(concurrentResults.filter((value) => !value).length, 1);
  assert.equal(
    await prisma.emailMessage.count({
      where: { userId: concurrentUser.id, messageType: "PASSWORD_CHANGED" },
    }),
    1,
  );
  record("concurrentResetSucceeded", concurrentResults.filter(Boolean).length);
  record("concurrentResetRejected", concurrentResults.filter((value) => !value).length);
  record("concurrentPasswordChangedMessages", 1);

  async function suppress(
    user: { email: string },
    reason: (typeof EmailSuppressionReason)[keyof typeof EmailSuppressionReason],
  ) {
    await createActiveSuppression({
      recipientEmailNormalized: normalizeEmailAddress(user.email),
      reason,
      source: EmailSuppressionSource.SYSTEM,
    });
  }

  currentCase = "suppression_policy";
  const unsubscribeUser = await createUser("unsubscribe", "ACTIVE");
  await suppress(unsubscribeUser, EmailSuppressionReason.UNSUBSCRIBE);
  await requestPasswordReset({ normalizedEmail: unsubscribeUser.email });
  const unsubscribeMessage = (await messagesFor(unsubscribeUser.id, "PASSWORD_RESET"))[0]!;
  assert.equal(unsubscribeMessage.status, EmailMessageStatus.PENDING);

  const bounceUser = await createUser("hard-bounce", "ACTIVE");
  await suppress(bounceUser, EmailSuppressionReason.HARD_BOUNCE);
  await requestPasswordReset({ normalizedEmail: bounceUser.email });
  const bounceMessage = (await messagesFor(bounceUser.id, "PASSWORD_RESET"))[0]!;
  assert.equal(bounceMessage.status, EmailMessageStatus.SUPPRESSED);

  const complaintUser = await createUser("complaint", "ACTIVE");
  await suppress(complaintUser, EmailSuppressionReason.COMPLAINT);
  await requestPasswordReset({ normalizedEmail: complaintUser.email });
  const complaintMessage = (await messagesFor(complaintUser.id, "PASSWORD_RESET"))[0]!;
  assert.equal(complaintMessage.status, EmailMessageStatus.SUPPRESSED);

  const workerUser = await createUser("worker-suppression", "ACTIVE");
  await requestPasswordReset({ normalizedEmail: workerUser.email });
  const workerMessage = (await messagesFor(workerUser.id, "PASSWORD_RESET"))[0]!;
  await prisma.emailMessage.update({
    where: { id: workerMessage.id },
    data: { nextAttemptAt: new Date("1970-01-01T00:00:00.000Z") },
  });
  const fakeProvider = new FakeEmailProvider();
  const sweep = await withoutServiceLogs(() =>
    runEmailDeliverySweep({
      provider: fakeProvider,
      limit: 1,
      beforeSuppressionRecheck: async (messageId) => {
        if (messageId !== workerMessage.id) return;
        await suppress(workerUser, EmailSuppressionReason.HARD_BOUNCE);
      },
    }),
  );
  const workerAfter = await prisma.emailMessage.findUniqueOrThrow({
    where: { id: workerMessage.id },
    include: { attempts: true },
  });
  assert.equal(sweep.suppressed, 1);
  assert.equal(fakeProvider.sent.length, 0);
  assert.equal(workerAfter.status, EmailMessageStatus.SUPPRESSED);
  assert.equal(workerAfter.attempts.length, 0);
  assert.equal(workerAfter.attemptCount, 0);
  record("unsubscribeSecuritySuppressed", 0);
  record("bounceOrComplaintSuppressed", 2);
  record("suppressedWorkerProviderCalls", fakeProvider.sent.length);
  record("suppressedWorkerAttempts", workerAfter.attempts.length);

  currentCase = "worker_late_render_delivery";
  // Worker late-render: prove fragment URL reaches FakeEmailProvider.
  const deliveryProofUser = await createUser("delivery-proof", "ACTIVE");
  await requestPasswordReset({ normalizedEmail: deliveryProofUser.email });
  const deliveryProofMsg = (await messagesFor(deliveryProofUser.id, "PASSWORD_RESET"))[0]!;
  await prisma.emailMessage.update({
    where: { id: deliveryProofMsg.id },
    data: { nextAttemptAt: new Date("1970-01-01T00:00:00.000Z") },
  });
  const deliveryFakeProvider = new FakeEmailProvider();
  const deliverySweep = await withoutServiceLogs(() =>
    runEmailDeliverySweep({
      provider: deliveryFakeProvider,
      limit: 1,
      onlyMessageId: deliveryProofMsg.id,
    }),
  );
  assert.equal(deliverySweep.accepted, 1, "worker must accept the delivery-proof message");
  assert.equal(deliveryFakeProvider.sent.length, 1, "FakeEmailProvider must receive one send");
  const deliveredText = deliveryFakeProvider.sent[0]!.textBody;
  assert.ok(deliveredText, "delivered text body must be non-empty");
  assert.match(deliveredText, /\/reset-password#token=/, "delivered text must contain fragment URL");
  assert.ok(!deliveredText.includes("?token="), "delivered text must not contain query-string token");
  record("fragmentUrlDelivered", 1);
  record("workerDeliveryProofAccepted", deliverySweep.accepted);

  currentCase = "active_admin_notification";
  const activeAdmin = await createUser("admin-active", "ACTIVE", "ADMIN");
  const blockedAdmin = await createUser("admin-blocked", "BLOCKED", "ADMIN");
  const rejectedAdmin = await createUser("admin-rejected", "REJECTED", "ADMIN");
  const pendingAdmin = await createUser("admin-pending", "PENDING_APPROVAL", "ADMIN");
  const invalidActiveAdmin = await createUser(
    "admin-invalid-address",
    "ACTIVE",
    "ADMIN",
    `${runMarker}-invalid-address`,
  );
  const pendingRegistration = await createUser("pending-registration", "PENDING_APPROVAL");
  pendingRegistrationIds.push(pendingRegistration.id);
  await withoutServiceLogs(() =>
    notifyActiveAdminsOfPendingRegistration({
      id: pendingRegistration.id,
      email: pendingRegistration.email,
    }),
  );
  const firstAdminMessages = await prisma.emailMessage.findMany({
    where: {
      messageType: "ADMIN_PENDING_APPROVAL",
      idempotencyKey: { startsWith: `admin-pending-approval:${pendingRegistration.id}:` },
    },
    include: { user: true },
  });
  await withoutServiceLogs(() =>
    notifyActiveAdminsOfPendingRegistration({
      id: pendingRegistration.id,
      email: pendingRegistration.email,
    }),
  );
  const secondAdminMessages = await prisma.emailMessage.findMany({
    where: {
      messageType: "ADMIN_PENDING_APPROVAL",
      idempotencyKey: { startsWith: `admin-pending-approval:${pendingRegistration.id}:` },
    },
    include: { user: true },
  });
  assert.ok(firstAdminMessages.some((message) => message.userId === activeAdmin.id));
  assert.equal(secondAdminMessages.length, firstAdminMessages.length);
  assert.ok(
    secondAdminMessages.every(
      (message) =>
        message.user?.globalRole === "ADMIN" &&
        message.user.status === "ACTIVE" &&
        message.idempotencyKey ===
          `admin-pending-approval:${pendingRegistration.id}:${message.userId}`,
    ),
  );
  for (const excluded of [blockedAdmin, rejectedAdmin, pendingAdmin, invalidActiveAdmin]) {
    assert.ok(secondAdminMessages.every((message) => message.userId !== excluded.id));
  }
  record(
    "activeAdminMessages",
    secondAdminMessages.filter((message) => message.userId === activeAdmin.id).length,
  );
  record("inactiveAdminMessages", 0);
  record("adminDuplicateGrowth", secondAdminMessages.length - firstAdminMessages.length);
  record("adminFailureIsolationSucceeded", 1);
}

async function cleanup() {
  const fence = await import("@/lib/auth/credential-dispatch-fence");
  fence.clearCredentialDispatchFenceHooksForTests();
  if (!prisma) return;
  await prisma.externalServiceEvent.deleteMany();
  if (pendingRegistrationIds.length > 0) {
    await prisma.emailMessage.deleteMany({
      where: {
        OR: pendingRegistrationIds.map((id) => ({
          idempotencyKey: { startsWith: `admin-pending-approval:${id}:` },
        })),
      },
    });
  }
  if (ownedUserIds.length > 0) {
    await prisma.emailMessage.deleteMany({ where: { userId: { in: ownedUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } });
  }
  if (ownedEmails.length > 0) {
    await prisma.emailSuppression.deleteMany({
      where: { recipientEmailNormalized: { in: ownedEmails.map((email) => email.toLowerCase()) } },
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
  } catch {
    process.exitCode = 1;
  } finally {
    try {
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
  } else {
    originalError(
      JSON.stringify({
        ok: false,
        counts: { ...counts, failures: 1 },
        cases: [currentCase],
      }),
    );
  }
}

void run();

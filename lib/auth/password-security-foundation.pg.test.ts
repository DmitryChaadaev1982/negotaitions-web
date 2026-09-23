import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";

import {
  EmailMessageStatus,
  EmailMessageType,
  type PrismaClient,
} from "@/app/generated/prisma/client";
import { requirePgDatabase } from "@/lib/test-helpers/pg-test-gate";
import {
  assertIsolatedE2eDatabase,
  isE2eDatabaseConfigured,
} from "../../tests/e2e/helpers/e2e-database";

const SKIP_REASON = "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";
const CURRENT_PASSWORD = "current-pass";
const NEXT_PASSWORD = "next-pass-1";

type Loaded = {
  prisma: PrismaClient;
  updatePassword: (
    previous: { success?: boolean; error?: string },
    formData: FormData,
  ) => Promise<{ success?: boolean; error?: string }>;
  resetPasswordWithToken: (params: {
    rawToken: string;
    newPassword: string;
  }) => Promise<boolean>;
  requestPasswordReset: (params: {
    normalizedEmail: string;
  }) => Promise<void>;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  hashPassword: (password: string) => Promise<string>;
  generateSessionToken: () => string;
  hashSessionToken: (token: string) => string;
  generatePasswordResetToken: () => string;
  hashPasswordResetToken: (token: string) => string;
  resetEmailProviderInvocationCountForTests: () => void;
  readEmailProviderInvocationCountForTests: () => number;
  setCredentialMutationHooksForTests: (hooks: {
    beforePasswordUpdate?: () => void;
  }) => void;
  clearCredentialMutationHooksForTests: () => void;
  setUserSessionTokenReaderForTests: (reader: () => string | null) => void;
  clearUserSessionTokenReaderForTests: () => void;
};

let loaded: Loaded | null = null;
let currentSessionToken: string | null = null;
const createdUserIds: string[] = [];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function bcryptCost(hash: string): string | undefined {
  return hash.split("$")[2];
}

async function cleanupUser(userId: string): Promise<void> {
  if (!loaded) return;
  const messages = await loaded.prisma.emailMessage.findMany({
    where: { userId },
    select: { id: true },
  });
  if (messages.length > 0) {
    await loaded.prisma.emailDeliveryAttempt.deleteMany({
      where: { emailMessageId: { in: messages.map((message) => message.id) } },
    });
    await loaded.prisma.emailMessage.deleteMany({ where: { userId } });
  }
  await loaded.prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

async function seedActiveUser(passwordHash: string): Promise<{
  id: string;
  email: string;
  credentialGeneration: number;
  currentToken: string;
  otherTokenHash: string;
}> {
  if (!loaded) throw new Error("PostgreSQL test modules are not loaded.");
  const email = `pw-found-${randomBytes(6).toString("hex")}@example.com`;
  const user = await loaded.prisma.user.create({
    data: {
      email,
      passwordHash,
      name: "Password Foundation",
      globalRole: "USER",
      status: "ACTIVE",
      preferredLocale: "en",
      credentialGeneration: 4,
    },
    select: { id: true, email: true, credentialGeneration: true },
  });
  createdUserIds.push(user.id);
  const currentToken = loaded.generateSessionToken();
  const otherToken = loaded.generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const otherTokenHash = loaded.hashSessionToken(otherToken);
  await loaded.prisma.userSession.createMany({
    data: [
      {
        userId: user.id,
        sessionTokenHash: loaded.hashSessionToken(currentToken),
        expiresAt,
      },
      {
        userId: user.id,
        sessionTokenHash: otherTokenHash,
        expiresAt,
      },
    ],
  });
  currentSessionToken = currentToken;
  return {
    id: user.id,
    email: user.email,
    credentialGeneration: user.credentialGeneration,
    currentToken,
    otherTokenHash,
  };
}

test.before(async () => {
  if (!isE2eDatabaseConfigured()) return;
  const e2eUrl = assertIsolatedE2eDatabase();
  process.env.DATABASE_URL = e2eUrl;
  process.env.EMAIL_DELIVERY_ENABLED = "false";
  process.env.EMAIL_PROVIDER = "disabled";
  if (!process.env.EMAIL_SENSITIVE_PAYLOAD_KEY) {
    process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = randomBytes(32).toString("base64");
  }

  const session = await import("@/lib/auth/session");
  session.setUserSessionTokenReaderForTests(() => currentSessionToken);
  const prismaModule = await import("@/lib/prisma");
  const account = await import("@/app/actions/account");
  const accountSecurity = await import("@/lib/auth/account-security");
  const crypto = await import("@/lib/auth/crypto");
  const resetTokens = await import("@/lib/auth/password-reset-token");
  const provider = await import("@/lib/email/provider");
  const hooks = await import("@/lib/auth/credential-concurrency");

  loaded = {
    prisma: prismaModule.prisma,
    updatePassword: account.updatePassword,
    resetPasswordWithToken: accountSecurity.resetPasswordWithToken,
    requestPasswordReset: accountSecurity.requestPasswordReset,
    verifyPassword: crypto.verifyPassword,
    hashPassword: crypto.hashPassword,
    generateSessionToken: crypto.generateSessionToken,
    hashSessionToken: crypto.hashSessionToken,
    generatePasswordResetToken: resetTokens.generatePasswordResetToken,
    hashPasswordResetToken: resetTokens.hashPasswordResetToken,
    resetEmailProviderInvocationCountForTests:
      provider.resetEmailProviderInvocationCountForTests,
    readEmailProviderInvocationCountForTests:
      provider.readEmailProviderInvocationCountForTests,
    setCredentialMutationHooksForTests: hooks.setCredentialMutationHooksForTests,
    clearCredentialMutationHooksForTests: hooks.clearCredentialMutationHooksForTests,
    setUserSessionTokenReaderForTests: session.setUserSessionTokenReaderForTests,
    clearUserSessionTokenReaderForTests:
      session.clearUserSessionTokenReaderForTests,
  };
  await loaded.prisma.$queryRaw`SELECT 1`;
});

test.after(async () => {
  currentSessionToken = null;
  if (!loaded) return;
  loaded.clearCredentialMutationHooksForTests();
  loaded.clearUserSessionTokenReaderForTests();
  for (const userId of createdUserIds) {
    await cleanupUser(userId);
  }
  await loaded.prisma.$disconnect();
});

function ready(
  t: { skip: (reason?: string) => void },
): Loaded | null {
  if (
    !requirePgDatabase(t, {
      databaseReady: loaded !== null,
      unavailableReason: SKIP_REASON,
    })
  ) {
    return null;
  }
  return loaded;
}

test("FOUND-04 self-change uses the canonical policy owner", async (t) => {
  const api = ready(t);
  if (!api) return;
  const user = await seedActiveUser(await api.hashPassword(CURRENT_PASSWORD));
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: CURRENT_PASSWORD,
        newPassword: "short",
        confirmPassword: "short",
      }),
    );
    assert.deepEqual(result, { error: "auth.passwordTooShort" });
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { credentialGeneration: true, passwordHash: true },
    });
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.verifyPassword(CURRENT_PASSWORD, stored.passwordHash), true);
  } finally {
    await cleanupUser(user.id);
  }
});

test("FOUND-05 wrong current password does not mutate credentials", async (t) => {
  const api = ready(t);
  if (!api) return;
  const user = await seedActiveUser(await api.hashPassword(CURRENT_PASSWORD));
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: "wrong-pass",
        newPassword: NEXT_PASSWORD,
        confirmPassword: NEXT_PASSWORD,
      }),
    );
    assert.deepEqual(result, { error: "auth.invalidCurrentPassword" });
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { credentialGeneration: true, passwordHash: true },
    });
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.verifyPassword(CURRENT_PASSWORD, stored.passwordHash), true);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 2);
  } finally {
    await cleanupUser(user.id);
  }
});

test("FOUND-06 FOUND-07 FOUND-08 FOUND-09 FOUND-10 FOUND-11 FOUND-12 successful self-change", async (t) => {
  const api = ready(t);
  if (!api) return;
  const user = await seedActiveUser(await api.hashPassword(CURRENT_PASSWORD));
  const rawReset = api.generatePasswordResetToken();
  const resetRow = await api.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: api.hashPasswordResetToken(rawReset),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  const currentHash = api.hashSessionToken(user.currentToken);
  process.env.EMAIL_DELIVERY_ENABLED = "false";
  process.env.EMAIL_PROVIDER = "disabled";
  api.resetEmailProviderInvocationCountForTests();
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEXT_PASSWORD,
        confirmPassword: NEXT_PASSWORD,
      }),
    );
    assert.deepEqual(result, { success: true });

    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        credentialGeneration: true,
        passwordHash: true,
        passwordChangeRequiredAt: true,
      },
    });
    assert.equal(stored.credentialGeneration, user.credentialGeneration + 1);
    assert.equal(await api.verifyPassword(NEXT_PASSWORD, stored.passwordHash), true);
    assert.equal(await api.verifyPassword(CURRENT_PASSWORD, stored.passwordHash), false);
    assert.match(stored.passwordHash, /^\$argon2id\$v=19\$m=19456,t=4,p=1\$/);
    assert.equal(stored.passwordChangeRequiredAt, null);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
    });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.retiredCredentialGeneration, user.credentialGeneration);
    assert.equal(
      await api.verifyPassword(CURRENT_PASSWORD, history[0]?.passwordHash ?? ""),
      true,
    );

    const sessions = await api.prisma.userSession.findMany({
      where: { userId: user.id },
      select: { sessionTokenHash: true },
    });
    assert.deepEqual(
      sessions.map((session) => session.sessionTokenHash),
      [currentHash],
    );
    assert.equal(
      sessions.some((session) => session.sessionTokenHash === user.otherTokenHash),
      false,
    );

    const token = await api.prisma.passwordResetToken.findUniqueOrThrow({
      where: { id: resetRow.id },
    });
    assert.equal(token.usedAt, null);
    assert.ok(token.revokedAt);

    const message = await api.prisma.emailMessage.findFirstOrThrow({
      where: { userId: user.id, messageType: EmailMessageType.PASSWORD_CHANGED },
    });
    assert.equal(message.status, EmailMessageStatus.PENDING);
    assert.equal(message.providerName, "disabled");
    assert.equal(message.sentAt, null);
    assert.equal(
      await api.prisma.emailDeliveryAttempt.count({
        where: { emailMessageId: message.id },
      }),
      0,
    );
    assert.equal(api.readEmailProviderInvocationCountForTests(), 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test("FOUND-10 password and outbox roll back together when enqueue fails", async (t) => {
  const api = ready(t);
  if (!api) return;
  const user = await seedActiveUser(await api.hashPassword(CURRENT_PASSWORD));
  const operatorName = process.env.EMAIL_OPERATOR_NAME;
  api.setCredentialMutationHooksForTests({
    beforePasswordUpdate: () => {
      delete process.env.EMAIL_OPERATOR_NAME;
    },
  });
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEXT_PASSWORD,
        confirmPassword: NEXT_PASSWORD,
      }),
    );
    assert.equal(result.success, undefined);
    assert.equal(result.error, "auth.passwordChangeFailed");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { credentialGeneration: true, passwordHash: true },
    });
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.verifyPassword(CURRENT_PASSWORD, stored.passwordHash), true);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 2);
    assert.equal(
      await api.prisma.emailMessage.count({
        where: { userId: user.id, messageType: EmailMessageType.PASSWORD_CHANGED },
      }),
      0,
    );
  } finally {
    api.clearCredentialMutationHooksForTests();
    if (operatorName === undefined) delete process.env.EMAIL_OPERATOR_NAME;
    else process.env.EMAIL_OPERATOR_NAME = operatorName;
    await cleanupUser(user.id);
  }
});

test("FOUND-18 configuration failure before the transaction does not change the password", async (t) => {
  const api = ready(t);
  if (!api) return;
  const user = await seedActiveUser(await api.hashPassword(CURRENT_PASSWORD));
  const operatorName = process.env.EMAIL_OPERATOR_NAME;
  delete process.env.EMAIL_OPERATOR_NAME;
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEXT_PASSWORD,
        confirmPassword: NEXT_PASSWORD,
      }),
    );
    assert.equal(result.error, "auth.passwordChangeFailed");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { credentialGeneration: true, passwordHash: true },
    });
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.verifyPassword(CURRENT_PASSWORD, stored.passwordHash), true);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 2);
  } finally {
    if (operatorName === undefined) delete process.env.EMAIL_OPERATOR_NAME;
    else process.env.EMAIL_OPERATOR_NAME = operatorName;
    await cleanupUser(user.id);
  }
});

test("FOUND-13 FOUND-14 email reset revokes every session and keeps token safety", async (t) => {
  const api = ready(t);
  if (!api) return;
  const user = await seedActiveUser(await api.hashPassword(CURRENT_PASSWORD));
  const rawToken = api.generatePasswordResetToken();
  const historicalSibling = api.generatePasswordResetToken();
  const now = Date.now();
  await api.prisma.passwordResetToken.createMany({
    data: [
      {
        userId: user.id,
        tokenHash: api.hashPasswordResetToken(rawToken),
        expiresAt: new Date(now + 30 * 60 * 1000),
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
      },
      {
        userId: user.id,
        tokenHash: api.hashPasswordResetToken(historicalSibling),
        expiresAt: new Date(now + 30 * 60 * 1000),
        revokedAt: new Date(now - 60 * 60 * 1000),
        createdAt: new Date(now - 3 * 60 * 60 * 1000),
      },
    ],
  });
  const expiredUser = await seedActiveUser(await api.hashPassword(CURRENT_PASSWORD));
  const expiredToken = api.generatePasswordResetToken();
  await api.prisma.passwordResetToken.create({
    data: {
      userId: expiredUser.id,
      tokenHash: api.hashPasswordResetToken(expiredToken),
      expiresAt: new Date(now - 60 * 1000),
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
    },
  });
  const enumerationUser = await seedActiveUser(
    await api.hashPassword(CURRENT_PASSWORD),
  );
  try {
    assert.equal(
      await api.resetPasswordWithToken({
        rawToken: expiredToken,
        newPassword: NEXT_PASSWORD,
      }),
      false,
    );
    const expiredStored = await api.prisma.user.findUniqueOrThrow({
      where: { id: expiredUser.id },
      select: { credentialGeneration: true, passwordHash: true },
    });
    assert.equal(expiredStored.credentialGeneration, expiredUser.credentialGeneration);
    assert.equal(
      await api.verifyPassword(CURRENT_PASSWORD, expiredStored.passwordHash),
      true,
    );

    assert.equal(
      await api.resetPasswordWithToken({
        rawToken,
        newPassword: NEXT_PASSWORD,
      }),
      true,
    );
    assert.equal(
      await api.resetPasswordWithToken({
        rawToken,
        newPassword: "second-pass",
      }),
      false,
    );

    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        credentialGeneration: true,
        passwordHash: true,
        passwordChangeRequiredAt: true,
      },
    });
    assert.equal(stored.credentialGeneration, user.credentialGeneration + 1);
    assert.equal(await api.verifyPassword(NEXT_PASSWORD, stored.passwordHash), true);
    assert.match(stored.passwordHash, /^\$argon2id\$v=19\$m=19456,t=4,p=1\$/);
    assert.equal(stored.passwordChangeRequiredAt, null);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
    });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.retiredCredentialGeneration, user.credentialGeneration);
    assert.equal(
      await api.verifyPassword(CURRENT_PASSWORD, history[0]?.passwordHash ?? ""),
      true,
    );
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 0);

    const tokens = await api.prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    const consumed = tokens.find(
      (token) => token.tokenHash === api.hashPasswordResetToken(rawToken),
    );
    const revokedSibling = tokens.find(
      (token) => token.tokenHash === api.hashPasswordResetToken(historicalSibling),
    );
    assert.ok(consumed?.usedAt);
    assert.equal(consumed?.revokedAt, null);
    assert.notEqual(consumed?.tokenHash, rawToken);
    assert.match(consumed?.tokenHash ?? "", /^[a-f0-9]{64}$/);
    assert.ok(revokedSibling?.revokedAt);
    assert.equal(revokedSibling?.usedAt, null);

    const unknownEmail = `missing-${randomBytes(4).toString("hex")}@example.com`;
    assert.equal(
      await api.requestPasswordReset({ normalizedEmail: unknownEmail }),
      undefined,
    );
    assert.equal(
      await api.requestPasswordReset({ normalizedEmail: enumerationUser.email }),
      undefined,
    );
    assert.equal(
      await api.prisma.user.count({ where: { email: unknownEmail } }),
      0,
    );
    const issued = await api.prisma.passwordResetToken.findMany({
      where: { userId: enumerationUser.id, usedAt: null, revokedAt: null },
      select: { tokenHash: true },
    });
    assert.equal(issued.length, 1);
    assert.match(issued[0]?.tokenHash ?? "", /^[a-f0-9]{64}$/);
    const enumerationStored = await api.prisma.user.findUniqueOrThrow({
      where: { id: enumerationUser.id },
      select: { passwordHash: true },
    });
    assert.equal(
      await api.verifyPassword(CURRENT_PASSWORD, enumerationStored.passwordHash),
      true,
    );
  } finally {
    await cleanupUser(user.id);
    await cleanupUser(expiredUser.id);
    await cleanupUser(enumerationUser.id);
  }
});

test("FOUND-15 stored bcrypt cost 10 still changes through self-change", async (t) => {
  const api = ready(t);
  if (!api) return;
  const cost10 = await bcrypt.hash(CURRENT_PASSWORD, 10);
  assert.equal(bcryptCost(cost10), "10");
  const user = await seedActiveUser(cost10);
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEXT_PASSWORD,
        confirmPassword: NEXT_PASSWORD,
      }),
    );
    assert.deepEqual(result, { success: true });
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    assert.match(stored.passwordHash, /^\$argon2id\$v=19\$m=19456,t=4,p=1\$/);
    assert.equal(await api.verifyPassword(NEXT_PASSWORD, stored.passwordHash), true);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
    });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.passwordHash, cost10);
    assert.equal(
      await api.verifyPassword(CURRENT_PASSWORD, history[0]?.passwordHash ?? ""),
      true,
    );
  } finally {
    await cleanupUser(user.id);
  }
});

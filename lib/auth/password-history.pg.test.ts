import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";

import {
  EmailMessageStatus,
  EmailMessageType,
  type PrismaClient,
} from "@/app/generated/prisma/client";
import { PasswordReusedError } from "@/lib/auth/password-history";
import { requirePgDatabase } from "@/lib/test-helpers/pg-test-gate";
import {
  assertIsolatedE2eDatabase,
  isE2eDatabaseConfigured,
} from "../../tests/e2e/helpers/e2e-database";

const SKIP_REASON = "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";

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
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  generateSessionToken: () => string;
  hashSessionToken: (token: string) => string;
  generatePasswordResetToken: () => string;
  hashPasswordResetToken: (token: string) => string;
  upgradeVerifiedPasswordVerifier: (params: {
    userId: string;
    verifiedPassword: string;
    verifiedPasswordHash: string;
    verifiedCredentialGeneration: number;
  }) => Promise<string>;
  setCredentialMutationHooksForTests: (hooks: {
    afterPasswordVerified?: () => Promise<void> | void;
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

function secret(index: number): string {
  return `Stage2b-hist-${String(index).padStart(2, "0")}`;
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

async function seedActiveUser(passwordHash: string, generation = 10) {
  if (!loaded) throw new Error("PostgreSQL test modules are not loaded.");
  const user = await loaded.prisma.user.create({
    data: {
      email: `pw-hist-${randomBytes(6).toString("hex")}@example.com`,
      passwordHash,
      name: "History",
      globalRole: "USER",
      status: "ACTIVE",
      preferredLocale: "en",
      credentialGeneration: generation,
    },
    select: {
      id: true,
      email: true,
      name: true,
      preferredLocale: true,
      credentialGeneration: true,
      passwordHash: true,
    },
  });
  createdUserIds.push(user.id);
  const currentToken = loaded.generateSessionToken();
  const otherToken = loaded.generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await loaded.prisma.userSession.createMany({
    data: [
      {
        userId: user.id,
        sessionTokenHash: loaded.hashSessionToken(currentToken),
        expiresAt,
      },
      {
        userId: user.id,
        sessionTokenHash: loaded.hashSessionToken(otherToken),
        expiresAt,
      },
    ],
  });
  currentSessionToken = currentToken;
  return user;
}

async function snapshot(userId: string) {
  if (!loaded) throw new Error("PostgreSQL test modules are not loaded.");
  const user = await loaded.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, credentialGeneration: true },
  });
  const history = await loaded.prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { retiredCredentialGeneration: "desc" },
  });
  const sessions = await loaded.prisma.userSession.count({ where: { userId } });
  const tokens = await loaded.prisma.passwordResetToken.findMany({
    where: { userId },
  });
  const messages = await loaded.prisma.emailMessage.count({
    where: { userId, messageType: EmailMessageType.PASSWORD_CHANGED },
  });
  return { user, history, sessions, tokens, messages };
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
  const rehash = await import("@/lib/auth/password-rehash");
  const hooks = await import("@/lib/auth/credential-concurrency");
  loaded = {
    prisma: prismaModule.prisma,
    updatePassword: account.updatePassword,
    resetPasswordWithToken: accountSecurity.resetPasswordWithToken,
    hashPassword: crypto.hashPassword,
    verifyPassword: crypto.verifyPassword,
    generateSessionToken: crypto.generateSessionToken,
    hashSessionToken: crypto.hashSessionToken,
    generatePasswordResetToken: resetTokens.generatePasswordResetToken,
    hashPasswordResetToken: resetTokens.hashPasswordResetToken,
    upgradeVerifiedPasswordVerifier: rehash.upgradeVerifiedPasswordVerifier,
    setCredentialMutationHooksForTests: hooks.setCredentialMutationHooksForTests,
    clearCredentialMutationHooksForTests: hooks.clearCredentialMutationHooksForTests,
    setUserSessionTokenReaderForTests: session.setUserSessionTokenReaderForTests,
    clearUserSessionTokenReaderForTests: session.clearUserSessionTokenReaderForTests,
  };
  await loaded.prisma.$queryRaw`SELECT 1`;
});

test.after(async () => {
  currentSessionToken = null;
  if (!loaded) return;
  loaded.clearCredentialMutationHooksForTests();
  loaded.clearUserSessionTokenReaderForTests();
  for (const userId of createdUserIds) await cleanupUser(userId);
  await loaded.prisma.$disconnect();
});

function ready(t: { skip: (reason?: string) => void }): Loaded | null {
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

test("H01 H05 H06 H08 H09 H10 H11 H12 reuse of the current password writes nothing", async (t) => {
  const api = ready(t);
  if (!api) return;
  const current = secret(1);
  const user = await seedActiveUser(await api.hashPassword(current));
  const rawToken = api.generatePasswordResetToken();
  await api.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: api.hashPasswordResetToken(rawToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  const before = await snapshot(user.id);
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: current,
        newPassword: current,
        confirmPassword: current,
      }),
    );
    assert.deepEqual(result, { error: "auth.passwordReused" });
    const after = await snapshot(user.id);
    assert.equal(after.user.passwordHash, before.user.passwordHash);
    assert.equal(after.user.credentialGeneration, before.user.credentialGeneration);
    assert.equal(after.history.length, 0);
    assert.equal(after.sessions, 2);
    assert.equal(after.tokens.length, 1);
    assert.equal(after.tokens[0]?.usedAt, null);
    assert.equal(after.tokens[0]?.revokedAt, null);
    assert.equal(after.messages, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test("H02 H03 H04 H07 history keeps the previous five and allows the older secret", async (t) => {
  const api = ready(t);
  if (!api) return;
  const user = await seedActiveUser(await api.hashPassword(secret(1)), 10);
  try {
    for (let next = 2; next <= 7; next += 1) {
      const result = await api.updatePassword(
        {},
        form({
          currentPassword: secret(next - 1),
          newPassword: secret(next),
          confirmPassword: secret(next),
        }),
      );
      assert.deepEqual(result, { success: true });
    }
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(await api.verifyPassword(secret(7), stored.passwordHash), true);
    assert.equal(stored.credentialGeneration, 16);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
      orderBy: { retiredCredentialGeneration: "desc" },
    });
    assert.equal(history.length, 5);
    assert.deepEqual(
      history.map((row) => row.retiredCredentialGeneration),
      [15, 14, 13, 12, 11],
    );
    for (let index = 0; index < 5; index += 1) {
      assert.equal(
        await api.verifyPassword(secret(6 - index), history[index]?.passwordHash ?? ""),
        true,
      );
    }

    const currentAgain = await api.updatePassword(
      {},
      form({
        currentPassword: secret(7),
        newPassword: secret(7),
        confirmPassword: secret(7),
      }),
    );
    assert.deepEqual(currentAgain, { error: "auth.passwordReused" });
    const oldestRetained = await api.updatePassword(
      {},
      form({
        currentPassword: secret(7),
        newPassword: secret(2),
        confirmPassword: secret(2),
      }),
    );
    assert.deepEqual(oldestRetained, { error: "auth.passwordReused" });
    const pruned = await api.updatePassword(
      {},
      form({
        currentPassword: secret(7),
        newPassword: secret(1),
        confirmPassword: secret(1),
      }),
    );
    assert.deepEqual(pruned, { success: true });
    const finalHistory = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
    });
    assert.equal(finalHistory.length, 5);
    const finalUser = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(await api.verifyPassword(secret(1), finalUser.passwordHash), true);
    assert.equal(finalUser.credentialGeneration, 17);
  } finally {
    await cleanupUser(user.id);
  }
});

test("history order follows retiredCredentialGeneration rather than createdAt", async (t) => {
  const api = ready(t);
  if (!api) return;
  const current = "Stage2b-order-now";
  const user = await seedActiveUser(await api.hashPassword(current), 20);
  const now = Date.now();
  for (let generation = 1; generation <= 6; generation += 1) {
    await api.prisma.passwordHistory.create({
      data: {
        userId: user.id,
        passwordHash: await api.hashPassword(`Stage2b-order-${generation}`),
        retiredCredentialGeneration: generation,
        createdAt: new Date(now - generation * 60 * 1000),
      },
    });
  }
  try {
    const fifth = await api.updatePassword(
      {},
      form({
        currentPassword: current,
        newPassword: "Stage2b-order-2",
        confirmPassword: "Stage2b-order-2",
      }),
    );
    assert.deepEqual(fifth, { error: "auth.passwordReused" });
    const outside = await api.updatePassword(
      {},
      form({
        currentPassword: current,
        newPassword: "Stage2b-order-1",
        confirmPassword: "Stage2b-order-1",
      }),
    );
    assert.deepEqual(outside, { success: true });
    const generations = (
      await api.prisma.passwordHistory.findMany({
        where: { userId: user.id },
        orderBy: { retiredCredentialGeneration: "desc" },
        select: { retiredCredentialGeneration: true },
      })
    ).map((row) => row.retiredCredentialGeneration);
    assert.deepEqual(generations, [20, 6, 5, 4, 3]);
  } finally {
    await cleanupUser(user.id);
  }
});

test("H13 H14 email reset enforces mixed bcrypt and Argon2 history", async (t) => {
  const api = ready(t);
  if (!api) return;
  const current = "Stage2b-current1";
  const user = await seedActiveUser(await api.hashPassword(current), 4);
  const bcrypt10 = "Stage2b-bc10-old";
  const bcrypt12 = "Stage2b-bc12-old";
  const argon = "Stage2b-argon-old";
  await api.prisma.passwordHistory.createMany({
    data: [
      {
        userId: user.id,
        passwordHash: await bcrypt.hash(bcrypt10, 10),
        retiredCredentialGeneration: 1,
      },
      {
        userId: user.id,
        passwordHash: await bcrypt.hash(bcrypt12, 12),
        retiredCredentialGeneration: 2,
      },
      {
        userId: user.id,
        passwordHash: await api.hashPassword(argon),
        retiredCredentialGeneration: 3,
      },
    ],
  });
  const prefix = "c".repeat(72);
  const suffixA = `${prefix}SUFFIX-A`;
  const suffixB = `${prefix}SUFFIX-B-OTHER`;
  await api.prisma.passwordHistory.create({
    data: {
      userId: user.id,
      passwordHash: await bcrypt.hash(suffixA, 10),
      retiredCredentialGeneration: 0,
    },
  });
  const rawToken = api.generatePasswordResetToken();
  await api.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: api.hashPasswordResetToken(rawToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  try {
    for (const reused of [current, bcrypt10, bcrypt12, argon, suffixB]) {
      const result = await api.updatePassword(
        {},
        form({
          currentPassword: current,
          newPassword: reused,
          confirmPassword: reused,
        }),
      );
      assert.deepEqual(result, { error: "auth.passwordReused" });
    }
    const before = await snapshot(user.id);
    await assert.rejects(
      () => api.resetPasswordWithToken({ rawToken, newPassword: bcrypt12 }),
      PasswordReusedError,
    );
    const afterReject = await snapshot(user.id);
    assert.equal(afterReject.user.passwordHash, before.user.passwordHash);
    assert.equal(afterReject.user.credentialGeneration, before.user.credentialGeneration);
    assert.equal(afterReject.tokens[0]?.usedAt, null);

    const fresh = "Stage2b-fresh-01";
    assert.equal(
      await api.resetPasswordWithToken({ rawToken, newPassword: fresh }),
      true,
    );
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(await api.verifyPassword(fresh, stored.passwordHash), true);
    assert.equal(stored.credentialGeneration, 5);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 0);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
      orderBy: { retiredCredentialGeneration: "desc" },
    });
    assert.equal(history.length, 5);
    assert.equal(history[0]?.retiredCredentialGeneration, 4);
    assert.equal(await api.verifyPassword(current, history[0]?.passwordHash ?? ""), true);
    const message = await api.prisma.emailMessage.findFirstOrThrow({
      where: { userId: user.id, messageType: EmailMessageType.PASSWORD_CHANGED },
    });
    assert.equal(message.status, EmailMessageStatus.PENDING);
    assert.equal(message.sentAt, null);
  } finally {
    await cleanupUser(user.id);
  }
});

test("H15 a transparent rehash does not add password history", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-rehash-hist";
  const hash = await bcrypt.hash(password, 10);
  const user = await seedActiveUser(hash, 3);
  try {
    const result = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: 3,
    });
    assert.equal(result, "upgraded");
    assert.equal(
      await api.prisma.passwordHistory.count({ where: { userId: user.id } }),
      0,
    );
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { credentialGeneration: true },
    });
    assert.equal(stored.credentialGeneration, 3);
  } finally {
    await cleanupUser(user.id);
  }
});

test("H16 concurrent explicit changes stay serialized", async (t) => {
  const api = ready(t);
  if (!api) return;
  const current = "Stage2b-race-current";
  const user = await seedActiveUser(await api.hashPassword(current), 8);
  try {
    const [first, second] = await Promise.all([
      api.updatePassword(
        {},
        form({
          currentPassword: current,
          newPassword: "Stage2b-race-new-a",
          confirmPassword: "Stage2b-race-new-a",
        }),
      ),
      api.updatePassword(
        {},
        form({
          currentPassword: current,
          newPassword: "Stage2b-race-new-b",
          confirmPassword: "Stage2b-race-new-b",
        }),
      ),
    ]);
    const successes = [first, second].filter((result) => result.success);
    assert.equal(successes.length, 1);
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(stored.credentialGeneration, 9);
    const verifies = await Promise.all([
      api.verifyPassword("Stage2b-race-new-a", stored.passwordHash),
      api.verifyPassword("Stage2b-race-new-b", stored.passwordHash),
    ]);
    assert.equal(verifies.filter(Boolean).length, 1);
    assert.equal(
      await api.prisma.passwordHistory.count({ where: { userId: user.id } }),
      1,
    );
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 1);
  } finally {
    await cleanupUser(user.id);
  }
});

test("self-change still succeeds after a login rehash replaces only the verifier", async (t) => {
  const api = ready(t);
  if (!api) return;
  const current = "Stage2b-rehash-race";
  const next = "Stage2b-after-race";
  const bcryptHash = await bcrypt.hash(current, 10);
  const user = await seedActiveUser(bcryptHash, 6);
  let rehashed = "";
  api.setCredentialMutationHooksForTests({
    afterPasswordVerified: async () => {
      const observed = await api.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true, credentialGeneration: true },
      });
      const upgraded = await api.upgradeVerifiedPasswordVerifier({
        userId: user.id,
        verifiedPassword: current,
        verifiedPasswordHash: observed.passwordHash,
        verifiedCredentialGeneration: observed.credentialGeneration,
      });
      assert.equal(upgraded, "upgraded");
      const mid = await api.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true, credentialGeneration: true },
      });
      assert.equal(mid.credentialGeneration, 6);
      assert.match(mid.passwordHash, /^\$argon2id\$v=19\$m=19456,t=4,p=1\$/);
      assert.notEqual(mid.passwordHash, bcryptHash);
      rehashed = mid.passwordHash;
    },
  });
  try {
    const result = await api.updatePassword(
      {},
      form({
        currentPassword: current,
        newPassword: next,
        confirmPassword: next,
      }),
    );
    assert.deepEqual(result, { success: true });
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(stored.credentialGeneration, 7);
    assert.equal(await api.verifyPassword(next, stored.passwordHash), true);
    assert.equal(await api.verifyPassword(current, stored.passwordHash), false);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
    });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.passwordHash, rehashed);
    assert.equal(history[0]?.retiredCredentialGeneration, 6);
    assert.equal(await api.verifyPassword(current, history[0]?.passwordHash ?? ""), true);
    assert.equal(
      await api.prisma.emailMessage.count({
        where: { userId: user.id, messageType: EmailMessageType.PASSWORD_CHANGED },
      }),
      1,
    );
  } finally {
    api.clearCredentialMutationHooksForTests();
    await cleanupUser(user.id);
  }
});

test("P16 self-change applies length and common-password policy before writing", async (t) => {
  const api = ready(t);
  if (!api) return;
  const current = "Stage2b-policy-now";
  const user = await seedActiveUser(await api.hashPassword(current), 2);
  const before = await snapshot(user.id);
  try {
    assert.deepEqual(
      await api.updatePassword(
        {},
        form({
          currentPassword: current,
          newPassword: "uniq-shrt",
          confirmPassword: "uniq-shrt",
        }),
      ),
      { error: "auth.passwordTooShort" },
    );
    assert.deepEqual(
      await api.updatePassword(
        {},
        form({
          currentPassword: current,
          newPassword: "x".repeat(129),
          confirmPassword: "x".repeat(129),
        }),
      ),
      { error: "auth.passwordTooLong" },
    );
    assert.deepEqual(
      await api.updatePassword(
        {},
        form({
          currentPassword: current,
          newPassword: "password123",
          confirmPassword: "password123",
        }),
      ),
      { error: "auth.passwordCommon" },
    );
    const after = await snapshot(user.id);
    assert.equal(after.user.passwordHash, before.user.passwordHash);
    assert.equal(after.user.credentialGeneration, before.user.credentialGeneration);
    assert.equal(after.history.length, 0);
    assert.equal(after.sessions, 2);
    assert.equal(after.messages, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

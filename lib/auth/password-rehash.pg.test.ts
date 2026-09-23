import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { hash as argon2Hash, type Options } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

import {
  EmailMessageType,
  type PrismaClient,
} from "@/app/generated/prisma/client";
import { requirePgDatabase } from "@/lib/test-helpers/pg-test-gate";
import {
  assertIsolatedE2eDatabase,
  isE2eDatabaseConfigured,
} from "../../tests/e2e/helpers/e2e-database";

const SKIP_REASON = "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";
const CURRENT_ARGON2 =
  /^\$argon2id\$v=19\$m=19456,t=4,p=1\$/;

type Loaded = {
  prisma: PrismaClient;
  upgradeVerifiedPasswordVerifier: (params: {
    userId: string;
    verifiedPassword: string;
    verifiedPasswordHash: string;
    verifiedCredentialGeneration: number;
  }) => Promise<"upgraded" | "skipped" | "lost-cas" | "failed">;
  establishLoginSessionAndMaybeRehash: (params: {
    userId: string;
    verifiedPassword: string;
    verifiedPasswordHash: string;
    verifiedCredentialGeneration: number;
    userAgent?: string;
  }) => Promise<void>;
  setPasswordRehashHooksForTests: (hooks: {
    beforeCompareAndSet?: () => Promise<void> | void;
    failWrite?: boolean;
  }) => void;
  clearPasswordRehashHooksForTests: () => void;
  setUserSessionCookieWriterForTests: (writer: (params: {
    token: string;
    expiresAt: Date;
  }) => Promise<void>) => void;
  clearUserSessionCookieWriterForTests: () => void;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  hashPassword: (password: string) => Promise<string>;
  classifyPasswordVerifier: (hash: string) => string;
  generateSessionToken: () => string;
  hashSessionToken: (token: string) => string;
  commitAuthenticatedPasswordChange: (params: {
    user: {
      id: string;
      email: string;
      name: string | null;
      preferredLocale: string;
    };
    currentPassword: string;
    currentPasswordHash: string;
    expectedCredentialGeneration: number;
    newPassword: string;
    newPasswordHash: string;
    currentSessionTokenHash: string | null;
    changedAt: Date;
  }) => Promise<void>;
  resetPasswordWithToken: (params: {
    rawToken: string;
    newPassword: string;
  }) => Promise<boolean>;
  generatePasswordResetToken: () => string;
  hashPasswordResetToken: (token: string) => string;
  resetEmailProviderInvocationCountForTests: () => void;
  readEmailProviderInvocationCountForTests: () => number;
};

let loaded: Loaded | null = null;
const createdUserIds: string[] = [];

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

async function seedUser(
  passwordHash: string,
  extras: {
    status?: string;
    passwordChangeRequiredAt?: Date | null;
  } = {},
) {
  if (!loaded) throw new Error("PostgreSQL test modules are not loaded.");
  const user = await loaded.prisma.user.create({
    data: {
      email: `pw-rehash-${randomBytes(6).toString("hex")}@example.com`,
      passwordHash,
      name: "Rehash",
      globalRole: "USER",
      status: extras.status ?? "ACTIVE",
      preferredLocale: "en",
      credentialGeneration: 7,
      passwordChangeRequiredAt: extras.passwordChangeRequiredAt ?? null,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      credentialGeneration: true,
      status: true,
      passwordChangeRequiredAt: true,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function addSessions(userId: string, count: number): Promise<string[]> {
  if (!loaded) throw new Error("PostgreSQL test modules are not loaded.");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const hashes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const sessionTokenHash = loaded.hashSessionToken(loaded.generateSessionToken());
    hashes.push(sessionTokenHash);
    await loaded.prisma.userSession.create({
      data: { userId, sessionTokenHash, expiresAt },
    });
  }
  return hashes;
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
  const prismaModule = await import("@/lib/prisma");
  const rehash = await import("@/lib/auth/password-rehash");
  const session = await import("@/lib/auth/session");
  const crypto = await import("@/lib/auth/crypto");
  const change = await import("@/lib/auth/authenticated-password-change");
  const accountSecurity = await import("@/lib/auth/account-security");
  const resetTokens = await import("@/lib/auth/password-reset-token");
  const provider = await import("@/lib/email/provider");
  session.setUserSessionCookieWriterForTests(async () => undefined);
  loaded = {
    prisma: prismaModule.prisma,
    upgradeVerifiedPasswordVerifier: rehash.upgradeVerifiedPasswordVerifier,
    establishLoginSessionAndMaybeRehash: rehash.establishLoginSessionAndMaybeRehash,
    setPasswordRehashHooksForTests: rehash.setPasswordRehashHooksForTests,
    clearPasswordRehashHooksForTests: rehash.clearPasswordRehashHooksForTests,
    setUserSessionCookieWriterForTests: session.setUserSessionCookieWriterForTests,
    clearUserSessionCookieWriterForTests: session.clearUserSessionCookieWriterForTests,
    verifyPassword: crypto.verifyPassword,
    hashPassword: crypto.hashPassword,
    classifyPasswordVerifier: crypto.classifyPasswordVerifier,
    generateSessionToken: crypto.generateSessionToken,
    hashSessionToken: crypto.hashSessionToken,
    commitAuthenticatedPasswordChange: change.commitAuthenticatedPasswordChange,
    resetPasswordWithToken: accountSecurity.resetPasswordWithToken,
    generatePasswordResetToken: resetTokens.generatePasswordResetToken,
    hashPasswordResetToken: resetTokens.hashPasswordResetToken,
    resetEmailProviderInvocationCountForTests:
      provider.resetEmailProviderInvocationCountForTests,
    readEmailProviderInvocationCountForTests:
      provider.readEmailProviderInvocationCountForTests,
  };
  await loaded.prisma.$queryRaw`SELECT 1`;
});

test.after(async () => {
  if (!loaded) return;
  loaded.clearPasswordRehashHooksForTests();
  loaded.clearUserSessionCookieWriterForTests();
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

test("R01 R02 R03 R04 R05 R06 R07 bcrypt cost 10 and 12 logins rehash without side effects", async (t) => {
  const api = ready(t);
  if (!api) return;
  for (const cost of [10, 12] as const) {
    const password = `Stage2b-bcrypt-${cost}`;
    const hash = await bcrypt.hash(password, cost);
    assert.equal(hash.split("$")[2], String(cost));
    const user = await seedUser(hash);
    const sessions = await addSessions(user.id, 2);
    api.resetEmailProviderInvocationCountForTests();
    try {
      await api.establishLoginSessionAndMaybeRehash({
        userId: user.id,
        verifiedPassword: password,
        verifiedPasswordHash: hash,
        verifiedCredentialGeneration: user.credentialGeneration,
      });
      const stored: {
        passwordHash: string;
        credentialGeneration: number;
        status: string;
        passwordChangeRequiredAt: Date | null;
      } = await api.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          passwordHash: true,
          credentialGeneration: true,
          status: true,
          passwordChangeRequiredAt: true,
        },
      });
      assert.match(stored.passwordHash, CURRENT_ARGON2);
      assert.equal(api.classifyPasswordVerifier(stored.passwordHash), "argon2id-current");
      assert.equal(await api.verifyPassword(password, stored.passwordHash), true);
      assert.equal(stored.credentialGeneration, user.credentialGeneration);
      assert.equal(stored.status, "ACTIVE");
      assert.equal(stored.passwordChangeRequiredAt, null);
      const sessionHashes: string[] = (
        await api.prisma.userSession.findMany({
          where: { userId: user.id },
          select: { sessionTokenHash: true },
        })
      ).map((session) => session.sessionTokenHash);
      assert.equal(sessionHashes.length, 3);
      for (const existing of sessions) assert.ok(sessionHashes.includes(existing));
      assert.equal(
        await api.prisma.passwordHistory.count({ where: { userId: user.id } }),
        0,
      );
      assert.equal(
        await api.prisma.emailMessage.count({
          where: { userId: user.id, messageType: EmailMessageType.PASSWORD_CHANGED },
        }),
        0,
      );
      assert.equal(api.readEmailProviderInvocationCountForTests(), 0);
    } finally {
      await cleanupUser(user.id);
    }
  }
});

test("R08 a rehash write failure leaves the successful login session in place", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-fail-write";
  const hash = await bcrypt.hash(password, 10);
  const user = await seedUser(hash);
  api.setPasswordRehashHooksForTests({ failWrite: true });
  try {
    await api.establishLoginSessionAndMaybeRehash({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    const direct = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(direct, "failed");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(stored.passwordHash, hash);
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 1);
    assert.equal(
      await api.prisma.passwordHistory.count({ where: { userId: user.id } }),
      0,
    );
  } finally {
    api.clearPasswordRehashHooksForTests();
    await cleanupUser(user.id);
  }
});

test("R09 a password change that wins the CAS leaves the rehash unwritten", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-cas-change";
  const hash = await bcrypt.hash(password, 10);
  const user = await seedUser(hash);
  const next = "Stage2b-changed-1";
  const nextHash = await api.hashPassword(next);
  api.setPasswordRehashHooksForTests({
    beforeCompareAndSet: async () => {
      await api.commitAuthenticatedPasswordChange({
        user: {
          id: user.id,
          email: user.email,
          name: "Rehash",
          preferredLocale: "en",
        },
        currentPassword: password,
        currentPasswordHash: hash,
        expectedCredentialGeneration: user.credentialGeneration,
        newPassword: next,
        newPasswordHash: nextHash,
        currentSessionTokenHash: null,
        changedAt: new Date(),
      });
    },
  });
  try {
    const result = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(result, "lost-cas");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(stored.passwordHash, nextHash);
    assert.equal(stored.credentialGeneration, user.credentialGeneration + 1);
    assert.equal(await api.verifyPassword(password, stored.passwordHash), false);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
    });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.passwordHash, hash);
  } finally {
    api.clearPasswordRehashHooksForTests();
    await cleanupUser(user.id);
  }
});

test("R10 a reset that wins the CAS leaves the rehash unwritten", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-cas-reset";
  const hash = await bcrypt.hash(password, 12);
  const user = await seedUser(hash);
  const rawToken = api.generatePasswordResetToken();
  await api.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: api.hashPasswordResetToken(rawToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  api.setPasswordRehashHooksForTests({
    beforeCompareAndSet: async () => {
      assert.equal(
        await api.resetPasswordWithToken({
          rawToken,
          newPassword: "Stage2b-reset-01",
        }),
        true,
      );
    },
  });
  try {
    const result = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(result, "lost-cas");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(await api.verifyPassword("Stage2b-reset-01", stored.passwordHash), true);
    assert.equal(await api.verifyPassword(password, stored.passwordHash), false);
    assert.equal(stored.credentialGeneration, user.credentialGeneration + 1);
    assert.notEqual(stored.passwordHash, hash);
    const history = await api.prisma.passwordHistory.findMany({
      where: { userId: user.id },
    });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.passwordHash, hash);
  } finally {
    api.clearPasswordRehashHooksForTests();
    await cleanupUser(user.id);
  }
});

test("R11 two simultaneous rehashes let at most one stale-hash CAS win", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-double-rehash";
  const hash = await bcrypt.hash(password, 10);
  const user = await seedUser(hash);
  await addSessions(user.id, 2);
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.setPasswordRehashHooksForTests({
    beforeCompareAndSet: async () => {
      arrived += 1;
      if (arrived === 2) release();
      await Promise.race([
        gate,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("rehash barrier timed out")), 15000);
        }),
      ]);
    },
  });
  try {
    const results = await Promise.all([
      api.upgradeVerifiedPasswordVerifier({
        userId: user.id,
        verifiedPassword: password,
        verifiedPasswordHash: hash,
        verifiedCredentialGeneration: user.credentialGeneration,
      }),
      api.upgradeVerifiedPasswordVerifier({
        userId: user.id,
        verifiedPassword: password,
        verifiedPasswordHash: hash,
        verifiedCredentialGeneration: user.credentialGeneration,
      }),
    ]);
    assert.deepEqual(results.slice().sort(), ["lost-cas", "upgraded"]);
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.match(stored.passwordHash, CURRENT_ARGON2);
    assert.equal(await api.verifyPassword(password, stored.passwordHash), true);
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 2);
    assert.equal(
      await api.prisma.passwordHistory.count({ where: { userId: user.id } }),
      0,
    );
  } finally {
    api.clearPasswordRehashHooksForTests();
    await cleanupUser(user.id);
  }
});

test("R12 R13 over-72-byte bcrypt candidates authenticate without binding a suffix", async (t) => {
  const api = ready(t);
  if (!api) return;
  const prefix = "b".repeat(72);
  const first = `${prefix}SUFFIX-A`;
  const second = `${prefix}SUFFIX-B-DIFFERENT`;
  assert.ok(Buffer.byteLength(first, "utf8") > 72);
  assert.ok(Buffer.byteLength(second, "utf8") > 72);
  assert.ok(first.length > 72);
  const hash = await bcrypt.hash(first, 10);
  assert.equal(await api.verifyPassword(first, hash), true);
  assert.equal(await api.verifyPassword(second, hash), true);
  const user = await seedUser(hash);
  const cyrillicPassword = "я".repeat(40);
  assert.ok(cyrillicPassword.length <= 72);
  assert.ok(Buffer.byteLength(cyrillicPassword, "utf8") > 72);
  const cyrillicHash = await bcrypt.hash(cyrillicPassword, 10);
  const cyrillicUser = await seedUser(cyrillicHash);
  try {
    await api.establishLoginSessionAndMaybeRehash({
      userId: user.id,
      verifiedPassword: first,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(
      await api.upgradeVerifiedPasswordVerifier({
        userId: user.id,
        verifiedPassword: second,
        verifiedPasswordHash: hash,
        verifiedCredentialGeneration: user.credentialGeneration,
      }),
      "skipped",
    );
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(stored.passwordHash, hash);
    assert.equal(api.classifyPasswordVerifier(stored.passwordHash), "bcrypt-legacy");
    assert.equal(await api.verifyPassword(first, stored.passwordHash), true);
    assert.equal(await api.verifyPassword(second, stored.passwordHash), true);
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 1);

    await api.establishLoginSessionAndMaybeRehash({
      userId: cyrillicUser.id,
      verifiedPassword: cyrillicPassword,
      verifiedPasswordHash: cyrillicHash,
      verifiedCredentialGeneration: cyrillicUser.credentialGeneration,
    });
    const cyrillicStored = await api.prisma.user.findUniqueOrThrow({
      where: { id: cyrillicUser.id },
      select: { passwordHash: true },
    });
    assert.equal(cyrillicStored.passwordHash, cyrillicHash);
  } finally {
    await cleanupUser(user.id);
    await cleanupUser(cyrillicUser.id);
  }
});

test("R14 a current Argon2id profile is not rehashed", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-argon-now";
  const hash = await api.hashPassword(password);
  const user = await seedUser(hash);
  try {
    const result = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(result, "skipped");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.equal(stored.passwordHash, hash);
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
  } finally {
    await cleanupUser(user.id);
  }
});

test("R15 a non-target Argon2id profile rehashes without a generation increment", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-argon-old";
  const hash = await argon2Hash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  } satisfies Options);
  assert.equal(api.classifyPasswordVerifier(hash), "argon2id-rehash");
  const user = await seedUser(hash);
  try {
    const result = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(result, "upgraded");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.match(stored.passwordHash, CURRENT_ARGON2);
    assert.notEqual(stored.passwordHash, hash);
    assert.equal(await api.verifyPassword(password, stored.passwordHash), true);
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(
      await api.prisma.passwordHistory.count({ where: { userId: user.id } }),
      0,
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test("a blocked account rehash does not restore access or clear a required-change mark", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "Stage2b-blocked-ok";
  const hash = await bcrypt.hash(password, 10);
  const requiredAt = new Date("2026-01-15T00:00:00.000Z");
  const user = await seedUser(hash, {
    status: "BLOCKED",
    passwordChangeRequiredAt: requiredAt,
  });
  try {
    const result = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(result, "upgraded");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        passwordHash: true,
        status: true,
        passwordChangeRequiredAt: true,
        credentialGeneration: true,
      },
    });
    assert.match(stored.passwordHash, CURRENT_ARGON2);
    assert.equal(stored.status, "BLOCKED");
    assert.equal(stored.passwordChangeRequiredAt?.toISOString(), requiredAt.toISOString());
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
    assert.equal(await api.prisma.userSession.count({ where: { userId: user.id } }), 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test("an existing short bcrypt password can still be rehashed on login", async (t) => {
  const api = ready(t);
  if (!api) return;
  const password = "tiny";
  assert.ok(password.length < 10);
  const hash = await bcrypt.hash(password, 10);
  const user = await seedUser(hash);
  try {
    const result = await api.upgradeVerifiedPasswordVerifier({
      userId: user.id,
      verifiedPassword: password,
      verifiedPasswordHash: hash,
      verifiedCredentialGeneration: user.credentialGeneration,
    });
    assert.equal(result, "upgraded");
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialGeneration: true },
    });
    assert.match(stored.passwordHash, CURRENT_ARGON2);
    assert.equal(await api.verifyPassword(password, stored.passwordHash), true);
    assert.equal(stored.credentialGeneration, user.credentialGeneration);
  } finally {
    await cleanupUser(user.id);
  }
});

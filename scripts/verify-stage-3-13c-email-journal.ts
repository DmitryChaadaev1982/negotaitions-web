import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const CONTAINER = `negotaitions-stage313cp-journal-${randomBytes(3).toString("hex")}`;
const PORT = 55443;
const USER = "stage313cp";
const PASSWORD = "stage313cp-local-only";
const DB = "stage313cp_journal_test";
const DATABASE_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`;

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Command failed: ${command}`));
    });
  });
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await run("docker", ["exec", CONTAINER, "pg_isready", "-U", USER, "-d", DB]);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error("Disposable postgres did not become ready.");
}

async function main() {
  process.on("uncaughtException", (error) => {
    if (String((error as Error)?.message || error).includes("Connection terminated")) {
      return;
    }
    console.error(error);
    process.exit(1);
  });

  const runId = `stage313cp_journal_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const adminId = `admin_${runId}`;
  const messageId = `msg_${runId}`;
  const recipient = `journal.${runId}@test.negotaitions.local`;

  await run("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    `POSTGRES_USER=${USER}`,
    "-e",
    `POSTGRES_PASSWORD=${PASSWORD}`,
    "-e",
    `POSTGRES_DB=${DB}`,
    "-p",
    `${PORT}:5432`,
    "postgres:16-alpine",
  ]);

  try {
    await waitForPostgres();
    await run(
      process.execPath,
      [
        path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
        "migrate",
        "deploy",
      ],
      { ...process.env, DATABASE_URL },
    );

    // Must set before any Prisma / journal module import.
    process.env.DATABASE_URL = DATABASE_URL;

    const { prisma } = await import("@/lib/prisma");
    const {
      EMAIL_JOURNAL_ACTION_REVEAL,
      listEmailJournal,
      parseEmailJournalListQuery,
      redactPasswordResetSecrets,
      revealEmailJournalContent,
    } = await import("@/lib/email/admin-journal");

    await prisma.user.create({
      data: {
        id: adminId,
        email: `admin.${runId}@test.negotaitions.local`,
        passwordHash: "unused",
        name: "Journal Verifier Admin",
        globalRole: "ADMIN",
        status: "ACTIVE",
        preferredLocale: "en",
      },
    });
    await prisma.emailMessage.create({
      data: {
        id: messageId,
        messageType: "PASSWORD_RESET",
        category: "SECURITY",
        status: "PENDING",
        recipientEmail: recipient,
        recipientEmailNormalized: recipient,
        fromAddress: "no-reply@negotaitions.ru",
        locale: "en",
        templateKey: "password-reset",
        templateVersion: "1.0.0",
        renderedSubject: "Reset",
        renderedTextBody: `https://local.negotaitions.ru/reset-password?token=${"cd".repeat(32)}`,
        renderedHtmlBody: "<p>reset</p>",
        idempotencyKey: `verify-journal:${runId}`,
        providerName: "fake",
        lastProviderMessageId: `prov_${runId}`,
      },
    });

    const list = await listEmailJournal(
      parseEmailJournalListQuery(
        new URLSearchParams({
          q: recipient,
          provider: "fake",
          pageSize: "20",
        }),
      ),
    );
    assert.ok(list.total >= 1);
    const item = list.items.find((row) => row.id === messageId);
    assert.ok(item);
    assert.match(item.recipientMasked, /\*{3}/);
    assert.equal(item.provider, "fake");
    assert.doesNotMatch(JSON.stringify(item), /token=/i);

    const revealed = await revealEmailJournalContent({
      adminUserId: adminId,
      messageId,
      requestId: runId,
    });
    assert.equal(revealed.available, true);
    if (revealed.available) {
      assert.equal(revealed.redacted, true);
      assert.match(revealed.text ?? "", /\[redacted\]/);
      assert.doesNotMatch(revealed.text ?? "", /token=[a-f0-9]{64}/i);
    }

    const audits = await prisma.adminActionLog.count({
      where: {
        action: EMAIL_JOURNAL_ACTION_REVEAL,
        adminUserId: adminId,
      },
    });
    assert.ok(audits >= 1);
    assert.match(
      redactPasswordResetSecrets(
        "token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ) ?? "",
      /\[redacted\]/,
    );

    await prisma.adminActionLog.deleteMany({ where: { adminUserId: adminId } });
    await prisma.emailMessage.deleteMany({
      where: { idempotencyKey: `verify-journal:${runId}` },
    });
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();

    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.end();

    console.log(
      JSON.stringify({
        ok: true,
        counts: {
          listed: list.total,
          maskedRecipients: list.items.filter((row) =>
            row.recipientMasked.includes("***"),
          ).length,
          reveals: 1,
          audits,
        },
      }),
    );
  } finally {
    await delay(200);
    await run("docker", ["rm", "-f", CONTAINER]).catch(() => undefined);
  }
}

void main().catch(async (error: unknown) => {
  process.exitCode = 1;
  const reason = error instanceof Error ? error.message : "VERIFICATION_FAILED";
  console.error(
    JSON.stringify({
      ok: false,
      counts: { failures: 1 },
      names: { reason: [reason.slice(0, 200)] },
    }),
  );
  await run("docker", ["rm", "-f", CONTAINER]).catch(() => undefined);
});

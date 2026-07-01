import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

type ExportPayload = {
  exportedAt: string;
  source: "local-dev";
  schemaVersion: string;
  counts: Record<string, number>;
  data: {
    users: Awaited<ReturnType<PrismaClient["user"]["findMany"]>>;
    userConsents: Awaited<ReturnType<PrismaClient["userConsent"]["findMany"]>>;
    negotiationCases: Awaited<ReturnType<PrismaClient["negotiationCase"]["findMany"]>>;
    caseRoles: Awaited<ReturnType<PrismaClient["caseRole"]["findMany"]>>;
  };
};

const EXPORT_PATH = path.join("tmp", "prod-seed-export", "negotaitions-prod-seed-export.json");

function detectSchemaVersion(migrationRoot: string): Promise<string> {
  return fs.readdir(migrationRoot, { withFileTypes: true }).then((entries) => {
    const latest = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    return latest ?? "unknown";
  });
}

function ensureSafeDatabase(url: string): void {
  if (/negotaitions_prod/i.test(url)) {
    throw new Error("Refusing to export from production database URL");
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing");
  }
  ensureSafeDatabase(dbUrl);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: dbUrl }),
  });

  try {
    const [schemaVersion, users, userConsents, negotiationCases, caseRoles] = await Promise.all([
      detectSchemaVersion(path.join("prisma", "migrations")),
      prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.userConsent.findMany({ orderBy: { acceptedAt: "asc" } }),
      prisma.negotiationCase.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.caseRole.findMany({ orderBy: [{ negotiationCaseId: "asc" }, { sortOrder: "asc" }] }),
    ]);

    const payload: ExportPayload = {
      exportedAt: new Date().toISOString(),
      source: "local-dev",
      schemaVersion,
      counts: {
        users: users.length,
        userConsents: userConsents.length,
        negotiationCases: negotiationCases.length,
        caseRoles: caseRoles.length,
      },
      data: {
        users,
        userConsents,
        negotiationCases,
        caseRoles,
      },
    };

    await fs.mkdir(path.dirname(EXPORT_PATH), { recursive: true });
    await fs.writeFile(EXPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const stat = await fs.stat(EXPORT_PATH);
    console.log(`Export file: ${EXPORT_PATH}`);
    console.log(`Export size: ${stat.size} bytes`);
    console.log(`Schema version: ${schemaVersion}`);
    console.log(`users=${users.length}`);
    console.log(`userConsents=${userConsents.length}`);
    console.log(`negotiationCases=${negotiationCases.length}`);
    console.log(`caseRoles=${caseRoles.length}`);

    const emailSample = users.slice(0, 3).map((user) => user.email).join(", ");
    const caseSample = negotiationCases.slice(0, 3).map((item) => item.title).join(" | ");
    console.log(`Sample emails: ${emailSample || "n/a"}`);
    console.log(`Sample cases: ${caseSample || "n/a"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[export-error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

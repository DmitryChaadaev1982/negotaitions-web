import "dotenv/config";
import fs from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../app/generated/prisma/client";

const DEFAULT_FILE = "/tmp/negotaitions-prod-seed-export.json";

type ImportJsonRecord = Record<string, unknown>;

type ImportedUserRow = ImportJsonRecord & {
  id: string;
  email: string;
  passwordHash: string;
  name: Prisma.UserCreateInput["name"];
  role: Prisma.UserCreateInput["role"];
  globalRole: Prisma.UserCreateInput["globalRole"];
  status: Prisma.UserCreateInput["status"];
  preferredLocale: Prisma.UserCreateInput["preferredLocale"];
  lastLoginAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectedByUserId: string | null;
  blockedAt: string | null;
  blockedByUserId: string | null;
  approvalComment: string | null;
  createdAt: string | null;
};

type ImportedUserConsentRow = ImportJsonRecord & {
  id: string;
  userId: string;
  consentType: Prisma.UserConsentCreateInput["consentType"];
  version: Prisma.UserConsentCreateInput["version"];
  acceptedAt: string;
  ipHash: string;
  userAgent: string;
};

type ImportedNegotiationCaseRow = Omit<
  Prisma.NegotiationCaseUncheckedCreateInput,
  "deletedAt" | "facilitatorId" | "createdByUserId"
> & {
  deletedAt: string | null;
  facilitatorId: string;
  createdByUserId: string | null;
};

type ImportedCaseRoleRow = Prisma.CaseRoleUncheckedCreateInput;

type ExportPayload = {
  exportedAt: string;
  source: string;
  schemaVersion: string;
  counts: Record<string, number>;
  data: {
    users: ImportedUserRow[];
    userConsents: ImportedUserConsentRow[];
    negotiationCases: ImportedNegotiationCaseRow[];
    caseRoles: ImportedCaseRoleRow[];
  };
};

type Summary = {
  usersCreated: number;
  usersUpdated: number;
  usersSkipped: number;
  consentsCreated: number;
  consentsSkipped: number;
  casesCreated: number;
  casesUpdated: number;
  casesSkipped: number;
  caseRolesCreated: number;
  caseRolesUpdated: number;
  caseRolesSkipped: number;
};

type Args = {
  file: string;
  dryRun: boolean;
  confirm: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { file: DEFAULT_FILE, dryRun: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    if (arg === "--confirm-production-import") args.confirm = true;
    if (arg === "--file") {
      if (!argv[i + 1]) throw new Error("--file requires path");
      args.file = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function assertSafety(args: Args): void {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("NODE_ENV must be production");
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !/negotaitions_prod/i.test(dbUrl)) {
    throw new Error("DATABASE_URL must target negotaitions_prod");
  }
  if (!args.dryRun && !args.confirm) {
    throw new Error("Missing --confirm-production-import");
  }
}

function initSummary(): Summary {
  return {
    usersCreated: 0,
    usersUpdated: 0,
    usersSkipped: 0,
    consentsCreated: 0,
    consentsSkipped: 0,
    casesCreated: 0,
    casesUpdated: 0,
    casesSkipped: 0,
    caseRolesCreated: 0,
    caseRolesUpdated: 0,
    caseRolesSkipped: 0,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertSafety(args);

  const raw = await fs.readFile(args.file, "utf8");
  const payload = JSON.parse(raw) as ExportPayload;
  if (!payload?.data?.users || !payload?.data?.negotiationCases || !payload?.data?.caseRoles) {
    throw new Error("Invalid export payload");
  }

  const dbUrl = process.env.DATABASE_URL as string;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
  const summary = initSummary();
  const warnings: string[] = [];
  const execute = !args.dryRun;
  const userIdMap = new Map<string, string>();
  const caseIdMap = new Map<string, string>();

  try {
    // Users: match by email; keep existing passwordHash.
    for (const user of payload.data.users) {
      const existingByEmail = await prisma.user.findFirst({
        where: { email: { equals: user.email, mode: "insensitive" } },
        select: { id: true },
      });

      if (existingByEmail) {
        userIdMap.set(user.id, existingByEmail.id);
        summary.usersUpdated += 1;
        warnings.push(`user ${user.email}: existing email matched, passwordHash unchanged`);
        if (execute) {
          await prisma.user.update({
            where: { id: existingByEmail.id },
            data: {
              name: user.name,
              role: user.role,
              globalRole: user.globalRole,
              status: user.status,
              preferredLocale: user.preferredLocale,
              lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
              approvedAt: user.approvedAt ? new Date(user.approvedAt) : null,
              approvedByUserId: user.approvedByUserId,
              rejectedAt: user.rejectedAt ? new Date(user.rejectedAt) : null,
              rejectedByUserId: user.rejectedByUserId,
              blockedAt: user.blockedAt ? new Date(user.blockedAt) : null,
              blockedByUserId: user.blockedByUserId,
              approvalComment: user.approvalComment,
            },
          });
        }
        continue;
      }

      summary.usersCreated += 1;
      if (!execute) {
        userIdMap.set(user.id, user.id);
        continue;
      }

      const idConflict = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
      const created = await prisma.user.create({
        data: {
          ...(idConflict ? {} : { id: user.id }),
          email: user.email,
          passwordHash: user.passwordHash,
          name: user.name,
          role: user.role,
          globalRole: user.globalRole,
          status: user.status,
          preferredLocale: user.preferredLocale,
          lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
          approvedAt: user.approvedAt ? new Date(user.approvedAt) : null,
          approvedByUserId: user.approvedByUserId,
          rejectedAt: user.rejectedAt ? new Date(user.rejectedAt) : null,
          rejectedByUserId: user.rejectedByUserId,
          blockedAt: user.blockedAt ? new Date(user.blockedAt) : null,
          blockedByUserId: user.blockedByUserId,
          approvalComment: user.approvalComment,
          createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
        },
        select: { id: true },
      });
      userIdMap.set(user.id, created.id);
      if (idConflict) warnings.push(`user ${user.email}: id conflict, created with generated id`);
    }

    for (const consent of payload.data.userConsents) {
      const mappedUserId = userIdMap.get(consent.userId);
      if (!mappedUserId) {
        summary.consentsSkipped += 1;
        warnings.push(`consent ${consent.id}: skipped (user mapping missing)`);
        continue;
      }
      const acceptedAt = new Date(consent.acceptedAt);
      const exists = await prisma.userConsent.findFirst({
        where: { userId: mappedUserId, consentType: consent.consentType, version: consent.version, acceptedAt },
        select: { id: true },
      });
      if (exists) {
        summary.consentsSkipped += 1;
        continue;
      }
      summary.consentsCreated += 1;
      if (execute) {
        await prisma.userConsent.create({
          data: {
            userId: mappedUserId,
            consentType: consent.consentType,
            version: consent.version,
            acceptedAt,
            ipHash: consent.ipHash,
            userAgent: consent.userAgent,
          },
        });
      }
    }

    for (const item of payload.data.negotiationCases) {
      const caseId = item.id;
      if (!caseId) {
        summary.casesSkipped += 1;
        warnings.push("case <missing-id>: skipped (id missing)");
        continue;
      }
      const facilitatorId = userIdMap.get(item.facilitatorId);
      const createdByUserId = item.createdByUserId ? userIdMap.get(item.createdByUserId) ?? null : null;
      if (!facilitatorId) {
        summary.casesSkipped += 1;
        warnings.push(`case ${caseId}: skipped (facilitator mapping missing)`);
        continue;
      }
      const existing = await prisma.negotiationCase.findUnique({ where: { id: caseId }, select: { id: true } });
      caseIdMap.set(caseId, caseId);
      if (existing) {
        summary.casesUpdated += 1;
        if (execute) {
          await prisma.negotiationCase.update({
            where: { id: caseId },
            data: { ...item, id: caseId, facilitatorId, createdByUserId, deletedAt: item.deletedAt ? new Date(item.deletedAt) : null },
          });
        }
      } else {
        summary.casesCreated += 1;
        if (execute) {
          await prisma.negotiationCase.create({
            data: { ...item, id: caseId, facilitatorId, createdByUserId, deletedAt: item.deletedAt ? new Date(item.deletedAt) : null },
          });
        }
      }
    }

    for (const role of payload.data.caseRoles) {
      const mappedCaseId = caseIdMap.get(role.negotiationCaseId) ?? role.negotiationCaseId;
      const caseExists = await prisma.negotiationCase.findUnique({ where: { id: mappedCaseId }, select: { id: true } });
      if (!caseExists) {
        summary.caseRolesSkipped += 1;
        warnings.push(`caseRole ${role.id}: skipped (case missing)`);
        continue;
      }
      const existing = await prisma.caseRole.findUnique({ where: { id: role.id }, select: { id: true } });
      if (existing) {
        summary.caseRolesUpdated += 1;
        if (execute) {
          await prisma.caseRole.update({ where: { id: role.id }, data: { ...role, negotiationCaseId: mappedCaseId } });
        }
      } else {
        summary.caseRolesCreated += 1;
        if (execute) {
          await prisma.caseRole.create({ data: { ...role, negotiationCaseId: mappedCaseId } });
        }
      }
    }

    console.log(`mode=${args.dryRun ? "dry-run" : "import"}`);
    console.log(`source=${payload.source} exportedAt=${payload.exportedAt} schemaVersion=${payload.schemaVersion}`);
    console.log(`users create/update/skip: ${summary.usersCreated}/${summary.usersUpdated}/${summary.usersSkipped}`);
    console.log(`consents create/skip: ${summary.consentsCreated}/${summary.consentsSkipped}`);
    console.log(`cases create/update/skip: ${summary.casesCreated}/${summary.casesUpdated}/${summary.casesSkipped}`);
    console.log(`caseRoles create/update/skip: ${summary.caseRolesCreated}/${summary.caseRolesUpdated}/${summary.caseRolesSkipped}`);
    console.log("excluded models: TrainingEvent, EventParticipant, EventInvite, Session, SessionParticipant, SessionInvite, SessionRole, SessionPauseInterval, SessionParticipantAudioActivity, Recording, Transcript, TranscriptSegment, AiAnalysis, ExternalServiceEvent, UsageCounter, AdminActionLog, UserSession");
    if (warnings.length > 0) {
      console.log("warnings:");
      for (const warning of warnings) console.log(`- ${warning}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[import-error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

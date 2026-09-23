import { hashPassword } from "@/lib/auth/crypto";
import { assertNewPasswordPolicy } from "@/lib/auth/password-policy";
import {
  assertSeedDatabaseTarget,
  formatSeedTarget,
} from "@/lib/db/seed-target-safety";
import {
  CaseLanguage,
  Difficulty,
  UserRole,
  type Prisma,
} from "../app/generated/prisma/client";

export const DEMO_FACILITATOR_EMAIL = "demo@example.com";

/**
 * Known local fixture for a newly created demo user.
 * The canonical password policy checks it before hashing.
 * Never log this value. Existing users do not receive it.
 */
export const DEMO_SEED_PASSWORD = "local-demo-seed";

const DEMO_FACILITATOR_NAME = "Demo Facilitator";

type RoleSeed = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

type CaseSeed = {
  title: string;
  description: string;
  businessContext: string;
  publicInstructions: string;
  targetSkills: string;
  difficulty: Difficulty;
  caseLanguage: CaseLanguage;
  defaultPreparationDurationSeconds: number;
  defaultDurationSeconds: number;
  roles: RoleSeed[];
};

const demoCases: CaseSeed[] = [
  {
    title: "ERP implementation change request negotiation",
    description:
      "A structured negotiation case for ERP project scope control.",
    businessContext:
      "A client wants to add a large scope change without moving the deadline or increasing budget. Vendor project director must negotiate scope, budget, risks and governance.",
    publicInstructions:
      "Participants should negotiate a practical way forward that protects business value, delivery feasibility, and relationship quality.",
    targetSkills:
      "Scope control, objection handling, value argumentation, escalation management.",
    difficulty: Difficulty.MEDIUM,
    caseLanguage: CaseLanguage.EN,
    defaultPreparationDurationSeconds: 300,
    defaultDurationSeconds: 900,
    roles: [
      {
        name: "Client CFO",
        privateInstructions:
          "You represent the client organization and must protect shareholder value while keeping the ERP go-live date fixed. Push for the new reporting and consolidation features, but avoid appearing unreasonable. Listen for trade-offs the vendor can offer without extra budget.",
        objectives: [
          "Secure the additional financial consolidation and management reporting scope.",
          "Keep the original go-live date and approved budget unchanged.",
          "Obtain clear risk mitigation and governance commitments from the vendor.",
          "Preserve a constructive relationship for post-go-live support.",
        ].join("\n"),
        constraints: [
          "Board has publicly committed to the current go-live date.",
          "No additional capital expenditure is approved for this phase.",
          "You cannot unilaterally descope other business-critical modules.",
          "You must involve the CIO only if the vendor escalates technically.",
        ].join("\n"),
        hiddenInfo:
          "Finance has already modeled a 12% efficiency gain from the requested features. The board will accept a phased delivery only if Phase 1 still delivers consolidated P&L by go-live. You have informal backing to trade lower-priority custom reports for the consolidation module.",
        fallbackPosition:
          "Accept a phased delivery: core consolidation and statutory reporting at go-live, with advanced analytics dashboards delivered within 60 days post go-live at no extra cost, backed by a signed remediation plan and executive steering committee oversight.",
      },
      {
        name: "Vendor Project Director",
        privateInstructions:
          "You are accountable for delivery, margin, and team sustainability. The client's request is materially larger than the contracted scope. Your goal is to reach an agreement without absorbing unbounded risk. Use data on effort, dependencies, and quality impact to frame options.",
        objectives: [
          "Avoid silent scope creep that would jeopardize quality and the go-live date.",
          "Recover or reallocate effort for the additional consolidation work.",
          "Maintain client trust and contract continuity.",
          "Escalate only if the client rejects all reasonable phased options.",
        ].join("\n"),
        constraints: [
          "Delivery team is already at 95% utilization through go-live.",
          "Fixed-price contract has less than 8% contingency remaining.",
          "Adding the full request as-is would require 6–8 additional senior consultants for 10 weeks.",
          "Your delivery director will not approve unpaid scope without a steering decision.",
        ].join("\n"),
        hiddenInfo:
          "Two senior finance consultants could be borrowed from another account for 4 weeks if the client agrees to defer two lower-value custom reports. You can offer executive sponsor sessions and weekly risk reviews at no charge to sweeten a phased deal.",
        fallbackPosition:
          "Propose a change request with phased delivery: Phase 1 delivers statutory consolidation by go-live using reallocated capacity; Phase 2 delivers management dashboards within 60 days under a zero-fee acceleration plan funded by descoping agreed low-priority reports.",
      },
    ],
  },
  {
    title: "Internal resource conflict",
    description:
      "A structured case about competing priorities between two delivery units.",
    businessContext:
      "Two department heads need the same expert resource for urgent projects. They must negotiate priorities, risk, escalation and business impact.",
    publicInstructions:
      "Participants should clarify business priorities, risks, alternatives and decision criteria.",
    targetSkills:
      "Interest-based negotiation, prioritization, conflict management, framing.",
    difficulty: Difficulty.EASY,
    caseLanguage: CaseLanguage.EN,
    defaultPreparationDurationSeconds: 300,
    defaultDurationSeconds: 600,
    roles: [
      {
        name: "ERP Delivery Director",
        privateInstructions:
          "You lead the ERP cutover workstream entering a critical integration testing window. You need the company's lead integration architect for the next three weeks. Make the business risk of delay explicit while remaining open to creative staffing solutions.",
        objectives: [
          "Secure the integration architect for the ERP testing window.",
          "Minimize cutover delay risk before the regulatory reporting deadline.",
          "Maintain cross-department collaboration.",
          "Establish a transparent prioritization rule for future conflicts.",
        ].join("\n"),
        constraints: [
          "ERP testing starts in five business days.",
          "A two-week slip pushes cutover past the regulatory filing window.",
          "You cannot hire an external architect in time due to security onboarding.",
          "Your sponsor expects you to resolve this at director level before escalating.",
        ].join("\n"),
        hiddenInfo:
          "A junior architect on your team can handle 60% of test scenarios, but only the lead architect can resolve complex middleware failures. You can shift non-critical defect triage to an offshore support vendor for two weeks.",
        fallbackPosition:
          "Share the architect 60/40 for three weeks with a written escalation path: ERP owns weeks 1–2 mornings and critical incidents; Analytics owns afternoons and planned workshops, with a joint daily 15-minute sync.",
      },
      {
        name: "Analytics Delivery Director",
        privateInstructions:
          "Your analytics platform rollout underpins a CEO-sponsored customer insights initiative launching at an industry event in four weeks. You need the same integration architect to finalize data pipelines. Focus on business impact and explore alternatives before blocking the ERP timeline.",
        objectives: [
          "Ensure pipeline stability before the executive demo.",
          "Protect the launch date tied to the CEO's public commitments.",
          "Negotiate shared access or viable substitute capacity.",
          "Agree decision criteria for future shared-resource conflicts.",
        ].join("\n"),
        constraints: [
          "Marketing materials for the launch are already in production.",
          "Delaying the launch damages credibility with top enterprise prospects.",
          "Your team lacks another engineer certified on the legacy middleware stack.",
          "You must not appear to deprioritize ERP regulatory risk in front of leadership.",
        ].join("\n"),
        hiddenInfo:
          "Most demo scenarios can run on pre-staged data if three specific real-time feeds are stable. A vendor partner offered 40 hours of senior support at cost for emergency pipeline fixes.",
        fallbackPosition:
          "Accept shared architect time with Analytics focusing on the three demo-critical feeds first, while ERP takes priority on cutover weekends and sev-1 incidents; commit to a steering review if either workstream misses a milestone.",
      },
    ],
  },
];

export type DemoUserIdentity = {
  name: string;
  role: UserRole;
};

export type DemoUserCreate = DemoUserIdentity & {
  email: string;
  passwordHash: string;
};

export type DemoSeedStore = {
  findDemoUser(email: string): Promise<{ id: string; email: string } | null>;
  updateDemoUser(email: string, data: DemoUserIdentity): Promise<void>;
  createDemoUser(data: DemoUserCreate): Promise<{ id: string; email: string }>;
  deleteDemoCases(facilitatorId: string, titles: readonly string[]): Promise<void>;
  createDemoCase(data: Prisma.NegotiationCaseUncheckedCreateInput): Promise<void>;
  disconnect(): Promise<void>;
};

export type SeedDemoResult = {
  userCreated: boolean;
  email: string;
  casesCreated: number;
};

export type RunSeedOptions = {
  databaseUrl: string | undefined;
  createClient: (databaseUrl: string) => DemoSeedStore | Promise<DemoSeedStore>;
  log?: (line: string) => void;
};

export function demoSeedCaseTitles(): string[] {
  return demoCases.map((caseSeed) => caseSeed.title);
}

/**
 * Provision the demo facilitator and refresh that user's demo cases.
 * Credential writes happen only when the demo user does not already exist.
 */
export async function seedDemoDevelopmentData(
  store: DemoSeedStore,
): Promise<SeedDemoResult> {
  const identity: DemoUserIdentity = {
    name: DEMO_FACILITATOR_NAME,
    role: UserRole.FACILITATOR,
  };
  const existing = await store.findDemoUser(DEMO_FACILITATOR_EMAIL);
  let facilitatorId: string;
  let userCreated: boolean;

  if (existing) {
    await store.updateDemoUser(DEMO_FACILITATOR_EMAIL, identity);
    facilitatorId = existing.id;
    userCreated = false;
  } else {
    assertNewPasswordPolicy(DEMO_SEED_PASSWORD);
    const passwordHash = await hashPassword(DEMO_SEED_PASSWORD);
    const created = await store.createDemoUser({
      email: DEMO_FACILITATOR_EMAIL,
      name: identity.name,
      role: identity.role,
      passwordHash,
    });
    facilitatorId = created.id;
    userCreated = true;
  }

  const titles = demoSeedCaseTitles();
  await store.deleteDemoCases(facilitatorId, titles);
  for (const caseSeed of demoCases) {
    await store.createDemoCase({
      title: caseSeed.title,
      description: caseSeed.description,
      businessContext: caseSeed.businessContext,
      publicInstructions: caseSeed.publicInstructions,
      targetSkills: caseSeed.targetSkills,
      difficulty: caseSeed.difficulty,
      caseLanguage: caseSeed.caseLanguage,
      defaultPreparationDurationSeconds: caseSeed.defaultPreparationDurationSeconds,
      defaultDurationSeconds: caseSeed.defaultDurationSeconds,
      facilitatorId,
      createdByUserId: facilitatorId,
      visibility: "PUBLIC",
      roles: {
        create: caseSeed.roles.map((role, index) => ({
          name: role.name,
          privateInstructions: role.privateInstructions,
          objectives: role.objectives,
          constraints: role.constraints,
          hiddenInfo: role.hiddenInfo,
          fallbackPosition: role.fallbackPosition,
          sortOrder: index,
        })),
      },
    });
  }

  return {
    userCreated,
    email: DEMO_FACILITATOR_EMAIL,
    casesCreated: titles.length,
  };
}

export function redactSeedFailure(
  error: unknown,
  databaseUrl: string | undefined,
): string {
  const raw = error instanceof Error ? error.message : "Seed failed.";
  let text = raw;
  const secretUrl = databaseUrl?.trim();
  if (secretUrl) {
    text = text.split(secretUrl).join("[REDACTED_DATABASE_URL]");
  }
  text = text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]");
  text = text.replace(/\b(?:user|username)=[^\s&]+/gi, "user=[REDACTED]");
  text = text.replace(/\bpassword=[^\s&]+/gi, "password=[REDACTED]");
  text = text.replace(/\$argon2id\$\S+/gi, "[REDACTED_PASSWORD_HASH]");
  text = text.replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "[REDACTED_PASSWORD_HASH]");
  if (text.includes(DEMO_SEED_PASSWORD)) {
    text = text.split(DEMO_SEED_PASSWORD).join("[REDACTED_PASSWORD]");
  }
  if (text.startsWith("Seed failed:")) return text;
  return `Seed failed: ${text}`;
}

export async function runSeed(options: RunSeedOptions): Promise<SeedDemoResult> {
  const databaseUrl = options.databaseUrl?.trim() ?? "";
  const log = options.log ?? (() => {});
  let store: DemoSeedStore | null = null;
  let result: SeedDemoResult | null = null;
  let failure: string | null = null;

  try {
    const descriptor = assertSeedDatabaseTarget(databaseUrl);
    log(`Seed target accepted: ${formatSeedTarget(descriptor)}.`);
    store = await options.createClient(databaseUrl);
    result = await seedDemoDevelopmentData(store);
  } catch (error) {
    failure = redactSeedFailure(error, databaseUrl);
  }

  if (store) {
    try {
      await store.disconnect();
    } catch (disconnectError) {
      if (!failure) failure = redactSeedFailure(disconnectError, databaseUrl);
    }
  }

  if (failure) throw new Error(failure);
  if (!result) throw new Error("Seed failed.");

  log(
    result.userCreated
      ? `Seed user created: ${result.email}`
      : `Seed user already exists: ${result.email}`,
  );
  log(`Cases created: ${result.casesCreated}`);
  log("Seed completed successfully.");
  return result;
}

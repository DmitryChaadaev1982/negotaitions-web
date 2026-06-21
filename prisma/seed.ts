import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { Pool } from "pg";

import { Difficulty, PrismaClient, UserRole } from "../app/generated/prisma/client";

const DEMO_FACILITATOR_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo1234";

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

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

async function main() {
  const prisma = createPrismaClient();
  const passwordHash = await hash(DEMO_PASSWORD, 10);

  const facilitator = await prisma.user.upsert({
    where: { email: DEMO_FACILITATOR_EMAIL },
    update: {
      name: "Demo Facilitator",
      role: UserRole.FACILITATOR,
      passwordHash,
    },
    create: {
      email: DEMO_FACILITATOR_EMAIL,
      name: "Demo Facilitator",
      role: UserRole.FACILITATOR,
      passwordHash,
    },
  });

  const demoTitles = demoCases.map((caseSeed) => caseSeed.title);
  await prisma.negotiationCase.deleteMany({
    where: {
      facilitatorId: facilitator.id,
      title: { in: demoTitles },
    },
  });

  for (const caseSeed of demoCases) {
    await prisma.negotiationCase.create({
      data: {
        title: caseSeed.title,
        description: caseSeed.description,
        businessContext: caseSeed.businessContext,
        publicInstructions: caseSeed.publicInstructions,
        targetSkills: caseSeed.targetSkills,
        difficulty: caseSeed.difficulty,
        defaultDurationSeconds: caseSeed.defaultDurationSeconds,
        facilitatorId: facilitator.id,
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
      },
    });
  }

  console.log("Seed completed successfully.");
  console.log(`Facilitator: ${facilitator.email} (password: ${DEMO_PASSWORD})`);
  console.log(`Cases created: ${demoCases.length}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});

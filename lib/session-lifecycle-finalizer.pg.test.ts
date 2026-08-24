import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

import { PrismaClient } from "@/app/generated/prisma/client";
import {
  getSanitizedE2eDatabaseDescriptor,
  isE2eDatabaseConfigured,
  resolveE2eDatabaseUrl,
} from "../tests/e2e/helpers/e2e-database";

const SKIP_REASON =
  "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";
const NOW = new Date("2026-08-24T12:00:00.000Z");

function utcWall(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

const DURATIONS = {
  debriefEmptyCloseMs: 60_000,
  debriefMaxDurationMs: 7_200_000,
  abandonedCloseMs: 10_800_000,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function barrier() {
  const arrived = deferred();
  const release = deferred();
  return {
    arrived: arrived.promise,
    wait: async () => {
      arrived.resolve();
      await release.promise;
    },
    release: () => release.resolve(),
  };
}

async function loadLifecycleModules() {
  const requireForTest = createRequire(`${process.cwd()}/package.json`);
  const moduleInternals = requireForTest("node:module") as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleInternals._load;
  moduleInternals._load = function loadWithServerOnlyShim(
    request,
    parent,
    isMain,
  ) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const [occupancy, lease, hooks, selector, completion] = await Promise.all([
      import("@/lib/session-room-occupancy"),
      import("@/lib/session-room-connection-lease"),
      import("@/lib/session-lifecycle-concurrency-hooks"),
      import("@/lib/session-lifecycle-candidate-selection"),
      import("@/lib/session-completion"),
    ]);
    return { occupancy, lease, hooks, selector, completion };
  } finally {
    moduleInternals._load = originalLoad;
  }
}

type Fixture = {
  userId: string;
  caseId: string;
  sessionId: string;
  participantId: string;
  eventId?: string;
  recordingId?: string;
};

async function createUserAndCase(client: pg.Client, fixture: Fixture) {
  await client.query(`SET TIME ZONE 'UTC'`);
  await client.query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "globalRole", "status", "preferredLocale", "updatedAt")
     VALUES ($1, $2, 'test-password-hash', 'S318A Race', 'USER', 'ACTIVE', 'en', NOW())`,
    [fixture.userId, `s318a-${fixture.userId}@test.negotaitions.local`],
  );
  await client.query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "createdByUserId", "visibility", "updatedAt")
     VALUES ($1, 'S318A Race', 'test', 'test', 'test', 'test', 'EASY', 'EN',
             60, 60, $2, $2, 'PRIVATE', NOW())`,
    [fixture.caseId, fixture.userId],
  );
}

async function createDebriefSession(
  client: pg.Client,
  fixture: Fixture,
  params: {
    endedAt: Date;
    updatedAt: Date;
    eventId?: string | null;
    eventStatus?: "LOBBY_OPEN" | "COMPLETED" | "CANCELLED";
    withActiveLease?: boolean;
    withRecording?: boolean;
  },
) {
  if (params.eventId) {
    await client.query(
      `INSERT INTO "TrainingEvent"
         ("id", "title", "scheduledAt", "timeZone", "hostUserId", "status",
          "publicJoinCode", "hostToken", "updatedAt")
       VALUES ($1, 'S318A Event', $2::timestamp, 'UTC', $3, $4, $5, $6, $2::timestamp)`,
      [
        params.eventId,
        utcWall(new Date("2026-08-20T12:00:00.000Z")),
        fixture.userId,
        params.eventStatus ?? "LOBBY_OPEN",
        `s318a-join-${params.eventId}`,
        `s318a-host-${params.eventId}`,
      ],
    );
  }
  await client.query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "negotiationState", "roomLifecycle", "negotiationEndedAt", "eventId",
        "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'S318A Race', 'S318A Race', 'test', 'test', 'EN',
             'FINISHED', 'DEBRIEF_OPEN', $4::timestamp, $5, $6::timestamp, $6::timestamp)`,
    [
      fixture.sessionId,
      fixture.caseId,
      fixture.userId,
      utcWall(params.endedAt),
      params.eventId ?? null,
      utcWall(params.updatedAt),
    ],
  );
  await client.query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "type", "joinToken", "displayName", "updatedAt")
     VALUES ($1, $2, $3, 'FACILITATOR', $1, 'Facilitator', NOW())`,
    [fixture.participantId, fixture.sessionId, fixture.userId],
  );
  if (params.withActiveLease) {
    await client.query(
      `INSERT INTO "SessionRoomConnection"
         ("id", "sessionId", "userId", "connectionId", "leaseVersion", "role",
          "expiresAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 1, 'FACILITATOR', $5::timestamp, $5::timestamp)`,
      [
        randomUUID(),
        fixture.sessionId,
        fixture.userId,
        `lease-${fixture.sessionId}`,
        utcWall(new Date(NOW.getTime() + 120_000)),
      ],
    );
  }
  if (params.withRecording) {
    fixture.recordingId = randomUUID();
    await client.query(
      `INSERT INTO "Recording"
         ("id", "sessionId", "status", "provider", "updatedAt")
       VALUES ($1, $2, 'RECORDING', 'LIVEKIT_CLOUD', NOW())`,
      [fixture.recordingId, fixture.sessionId],
    );
  }
}

async function createOpenSession(
  client: pg.Client,
  fixture: Fixture,
  params: {
    negotiationState:
      | "PREPARATION"
      | "READY_TO_START"
      | "RUNNING"
      | "PAUSED";
    createdAt: Date;
    updatedAt: Date;
    withRecording?: boolean;
    pausedAt?: Date | null;
  },
) {
  await client.query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "negotiationState", "roomLifecycle", "pausedAt",
        "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'S318A Abandoned', 'S318A Abandoned', 'test', 'test', 'EN',
             $4, 'OPEN', $5::timestamp, $6::timestamp, $7::timestamp)`,
    [
      fixture.sessionId,
      fixture.caseId,
      fixture.userId,
      params.negotiationState,
      params.pausedAt ? utcWall(params.pausedAt) : null,
      utcWall(params.createdAt),
      utcWall(params.updatedAt),
    ],
  );
  await client.query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "type", "joinToken", "displayName", "updatedAt")
     VALUES ($1, $2, $3, 'FACILITATOR', $1, 'Facilitator', NOW())`,
    [fixture.participantId, fixture.sessionId, fixture.userId],
  );
  if (params.withRecording) {
    fixture.recordingId = randomUUID();
    await client.query(
      `INSERT INTO "Recording"
         ("id", "sessionId", "status", "provider", "updatedAt")
       VALUES ($1, $2, 'RECORDING', 'LIVEKIT_CLOUD', NOW())`,
      [fixture.recordingId, fixture.sessionId],
    );
  }
}

async function insertDepartedLease(
  client: pg.Client,
  fixture: Fixture,
  departedAt: Date,
) {
  await client.query(
    `INSERT INTO "SessionRoomConnection"
       ("id", "sessionId", "userId", "connectionId", "leaseVersion", "role",
        "expiresAt", "disconnectedAt", "disconnectedReason", "updatedAt")
     VALUES ($1, $2, $3, $4, 1, 'FACILITATOR', $5::timestamp, $5::timestamp, 'LEFT', $5::timestamp)`,
    [
      randomUUID(),
      fixture.sessionId,
      fixture.userId,
      `departed-${fixture.sessionId}`,
      utcWall(departedAt),
    ],
  );
}

async function countStopOperations(client: pg.Client, sessionId: string) {
  const stops = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM "SessionRecordingStopOperation"
     WHERE "sessionId" = $1`,
    [sessionId],
  );
  return Number(stops.rows[0]?.count ?? 0);
}

async function readSessionRow(client: pg.Client, sessionId: string) {
  const session = await client.query<{
    status: string;
    negotiationState: string;
    negotiationEndedAt: Date | null;
    roomLifecycle: string | null;
    closeReason: string | null;
  }>(
    `SELECT status, "negotiationState", "negotiationEndedAt", "roomLifecycle", "closeReason"
     FROM "Session" WHERE id = $1`,
    [sessionId],
  );
  return session.rows[0];
}

async function cleanupFixture(client: pg.Client, fixture: Fixture) {
  await client.query(`DELETE FROM "Session" WHERE "id" = $1`, [fixture.sessionId]);
  if (fixture.eventId) {
    await client.query(`DELETE FROM "TrainingEvent" WHERE "id" = $1`, [
      fixture.eventId,
    ]);
  }
  await client.query(`DELETE FROM "NegotiationCase" WHERE "id" = $1`, [
    fixture.caseId,
  ]);
  await client.query(`DELETE FROM "User" WHERE "id" = $1`, [fixture.userId]);
}

function newFixture(): Fixture {
  return {
    userId: randomUUID(),
    caseId: randomUUID(),
    sessionId: randomUUID(),
    participantId: randomUUID(),
  };
}

test(
  "R1 stale due evaluation then rejoin prevents automatic empty close",
  { concurrency: false },
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }
    const databaseUrl = resolveE2eDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    console.log(
      `[s318a-finalizer-db] host=${getSanitizedE2eDatabaseDescriptor(databaseUrl).normalizedHost} port=${getSanitizedE2eDatabaseDescriptor(databaseUrl).port} database=${getSanitizedE2eDatabaseDescriptor(databaseUrl).database}`,
    );
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const setup = new pg.Client({ connectionString: databaseUrl });
    const fixture = newFixture();
    const modules = await loadLifecycleModules();
    await setup.connect();
    try {
      await createUserAndCase(setup, fixture);
      await createDebriefSession(setup, fixture, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: NOW,
      });
      const claimed = await modules.lease.claimSessionRoomConnectionLease(
        {
          sessionId: fixture.sessionId,
          userId: fixture.userId,
          connectionId: `rejoin-${fixture.sessionId}`,
          role: "FACILITATOR",
          now: NOW,
        },
        prisma,
      );
      assert.equal(claimed.isCurrentConnectionActive, true);
      const finalized = await modules.occupancy.finalizeSessionCanonicalClose(
        {
          sessionId: fixture.sessionId,
          authority: "DEBRIEF_EMPTY_TIMEOUT",
          now: NOW,
          durations: DURATIONS,
        },
        prisma,
      );
      assert.equal(finalized.applied, false);
      assert.equal(finalized.session?.roomLifecycle, "DEBRIEF_OPEN");
    } finally {
      modules.hooks.clearSessionLifecycleConcurrencyHooksForTests();
      await cleanupFixture(setup, fixture);
      await setup.end();
      await prisma.$disconnect();
      await pool.end();
    }
  },
);

test(
  "R2 claim-first overlap admits the user and automatic close loses",
  { concurrency: false },
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }
    const databaseUrl = resolveE2eDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const setup = new pg.Client({ connectionString: databaseUrl });
    const fixture = newFixture();
    const modules = await loadLifecycleModules();
    const claimHold = barrier();
    await setup.connect();
    try {
      await createUserAndCase(setup, fixture);
      await createDebriefSession(setup, fixture, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: NOW,
      });
      modules.hooks.setSessionLifecycleConcurrencyHooksForTests({
        afterSessionRowLockedForClaim: () => claimHold.wait(),
      });
      const claimPromise = modules.lease.claimSessionRoomConnectionLease(
        {
          sessionId: fixture.sessionId,
          userId: fixture.userId,
          connectionId: `overlap-claim-${fixture.sessionId}`,
          role: "FACILITATOR",
          now: NOW,
        },
        prisma,
      );
      await claimHold.arrived;
      const finalizePromise = modules.occupancy.finalizeSessionCanonicalClose(
        {
          sessionId: fixture.sessionId,
          authority: "DEBRIEF_EMPTY_TIMEOUT",
          now: NOW,
          durations: DURATIONS,
        },
        prisma,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      claimHold.release();
      const [claimed, finalized] = await Promise.all([
        claimPromise,
        finalizePromise,
      ]);
      assert.equal(claimed.isCurrentConnectionActive, true);
      assert.equal(finalized.applied, false);
      assert.equal(finalized.session?.roomLifecycle, "DEBRIEF_OPEN");
    } finally {
      modules.hooks.clearSessionLifecycleConcurrencyHooksForTests();
      await cleanupFixture(setup, fixture);
      await setup.end();
      await prisma.$disconnect();
      await pool.end();
    }
  },
);

test(
  "R2 finalizer-first overlap closes and refuses the later claim",
  { concurrency: false },
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }
    const databaseUrl = resolveE2eDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const setup = new pg.Client({ connectionString: databaseUrl });
    const fixture = newFixture();
    const modules = await loadLifecycleModules();
    const finalizeHold = barrier();
    await setup.connect();
    try {
      await createUserAndCase(setup, fixture);
      await createDebriefSession(setup, fixture, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: NOW,
      });
      modules.hooks.setSessionLifecycleConcurrencyHooksForTests({
        afterSessionRowLockedForFinalize: () => finalizeHold.wait(),
      });
      const finalizePromise = modules.occupancy.finalizeSessionCanonicalClose(
        {
          sessionId: fixture.sessionId,
          authority: "DEBRIEF_EMPTY_TIMEOUT",
          now: NOW,
          durations: DURATIONS,
        },
        prisma,
      );
      await finalizeHold.arrived;
      const claimPromise = modules.lease.claimSessionRoomConnectionLease(
        {
          sessionId: fixture.sessionId,
          userId: fixture.userId,
          connectionId: `overlap-late-${fixture.sessionId}`,
          role: "FACILITATOR",
          now: NOW,
        },
        prisma,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      finalizeHold.release();
      const [finalized, claimed] = await Promise.all([
        finalizePromise,
        claimPromise,
      ]);
      assert.equal(finalized.applied, true);
      assert.equal(finalized.session?.roomLifecycle, "CLOSED");
      assert.equal(claimed.isCurrentConnectionActive, false);
      const active = await setup.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM "SessionRoomConnection"
         WHERE "sessionId" = $1
           AND "disconnectedAt" IS NULL
           AND "supersededAt" IS NULL
           AND "revokedAt" IS NULL
           AND "expiresAt" > $2`,
        [fixture.sessionId, NOW],
      );
      assert.equal(Number(active.rows[0]?.count ?? 1), 0);
    } finally {
      modules.hooks.clearSessionLifecycleConcurrencyHooksForTests();
      await cleanupFixture(setup, fixture);
      await setup.end();
      await prisma.$disconnect();
      await pool.end();
    }
  },
);

test("R3 two automatic reconcilers produce one terminal transition", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createDebriefSession(setup, fixture, {
      endedAt: new Date(NOW.getTime() - 90_000),
      updatedAt: NOW,
    });
    const [first, second] = await Promise.all([
      modules.occupancy.reconcileSessionAutomaticClose(fixture.sessionId, prisma, {
        now: NOW,
        durations: DURATIONS,
        invocation: "periodic",
      }),
      modules.occupancy.reconcileSessionAutomaticClose(fixture.sessionId, prisma, {
        now: NOW,
        durations: DURATIONS,
        invocation: "periodic",
      }),
    ]);
    const applied = [first, second].filter((result) => result.closed);
    assert.equal(applied.length, 1);
    assert.ok(
      [first.decision, second.decision].includes("closed") &&
        ([first.decision, second.decision].includes("already_terminal") ||
          [first.decision, second.decision].includes("lost_race") ||
          [first.decision, second.decision].includes("ineligible")),
    );
    const session = await setup.query<{ roomLifecycle: string; closeReason: string }>(
      `SELECT "roomLifecycle", "closeReason" FROM "Session" WHERE id = $1`,
      [fixture.sessionId],
    );
    assert.equal(session.rows[0]?.roomLifecycle, "CLOSED");
    assert.equal(session.rows[0]?.closeReason, "DEBRIEF_EMPTY_TIMEOUT");
  } finally {
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test(
  "R4 atomic finalizer race is one terminal lifecycle without an automatic stop op",
  { concurrency: false },
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }
    const databaseUrl = resolveE2eDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const setup = new pg.Client({ connectionString: databaseUrl });
    const fixture = newFixture();
    const modules = await loadLifecycleModules();
    await setup.connect();
    try {
      await createUserAndCase(setup, fixture);
      await createDebriefSession(setup, fixture, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: NOW,
        withRecording: true,
      });
      const [manual, automatic] = await Promise.all([
        modules.occupancy.finalizeSessionCanonicalClose(
          {
            sessionId: fixture.sessionId,
            authority: "FACILITATOR_SESSION_COMPLETE",
            now: NOW,
            durations: DURATIONS,
          },
          prisma,
        ),
        modules.occupancy.reconcileSessionAutomaticClose(
          fixture.sessionId,
          prisma,
          { now: NOW, durations: DURATIONS, invocation: "periodic" },
        ),
      ]);
      assert.equal(
        [manual.applied, automatic.closed].filter(Boolean).length,
        1,
      );
      const session = await setup.query<{ roomLifecycle: string }>(
        `SELECT "roomLifecycle" FROM "Session" WHERE id = $1`,
        [fixture.sessionId],
      );
      assert.equal(session.rows[0]?.roomLifecycle, "CLOSED");
      const stops = await setup.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM "SessionRecordingStopOperation"
         WHERE "sessionId" = $1`,
        [fixture.sessionId],
      );
      assert.equal(Number(stops.rows[0]?.count ?? 1), 0);
    } finally {
      await cleanupFixture(setup, fixture);
      await setup.end();
      await prisma.$disconnect();
      await pool.end();
    }
  },
);

test(
  "C1/C2 tiny-limit sweeper makes forward progress past occupied/not-due rows",
  { concurrency: false },
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }
    const databaseUrl = resolveE2eDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const setup = new pg.Client({ connectionString: databaseUrl });
    const occupied = newFixture();
    const dueFirst = newFixture();
    dueFirst.userId = occupied.userId;
    dueFirst.caseId = occupied.caseId;
    const dueSecond = newFixture();
    dueSecond.userId = occupied.userId;
    dueSecond.caseId = occupied.caseId;
    const modules = await loadLifecycleModules();
    const ids = [occupied.sessionId, dueFirst.sessionId, dueSecond.sessionId];
    await setup.connect();
    try {
      await createUserAndCase(setup, occupied);
      await createDebriefSession(setup, occupied, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: new Date(NOW.getTime() - 3_000),
        withActiveLease: true,
      });
      await createDebriefSession(setup, dueFirst, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: new Date(NOW.getTime() - 2_000),
      });
      await createDebriefSession(setup, dueSecond, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: new Date(NOW.getTime() - 1_000),
      });

      const plan = modules.selector.buildSessionLifecycleCandidateSelectionPlan({
        now: NOW,
        limit: 1,
        durations: DURATIONS,
      });
      const firstPage = await prisma.session.findMany({
        where: { AND: [plan.debriefEmptyWhere, { id: { in: ids } }] },
        orderBy: plan.orderBy,
        take: plan.take,
        select: { id: true },
      });
      assert.deepEqual(
        firstPage.map((row) => row.id),
        [dueFirst.sessionId],
      );

      const closed = await modules.occupancy.reconcileSessionAutomaticClose(
        dueFirst.sessionId,
        prisma,
        { now: NOW, durations: DURATIONS, invocation: "periodic" },
      );
      assert.equal(closed.closed, true);

      const secondPage = await prisma.session.findMany({
        where: { AND: [plan.debriefEmptyWhere, { id: { in: ids } }] },
        orderBy: plan.orderBy,
        take: plan.take,
        select: { id: true },
      });
      assert.deepEqual(
        secondPage.map((row) => row.id),
        [dueSecond.sessionId],
      );
    } finally {
      await setup.query(`DELETE FROM "Session" WHERE id = ANY($1::text[])`, [ids]);
      await cleanupFixture(setup, occupied);
      await setup.end();
      await prisma.$disconnect();
      await pool.end();
    }
  },
);

test(
  "H3 stale automatic finalizer no-ops after parent Event becomes terminal",
  { concurrency: false },
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }
    const databaseUrl = resolveE2eDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const setup = new pg.Client({ connectionString: databaseUrl });
    const fixture = newFixture();
    fixture.eventId = randomUUID();
    const modules = await loadLifecycleModules();
    await setup.connect();
    try {
      await createUserAndCase(setup, fixture);
      await createDebriefSession(setup, fixture, {
        endedAt: new Date(NOW.getTime() - 90_000),
        updatedAt: NOW,
        eventId: fixture.eventId,
        eventStatus: "LOBBY_OPEN",
      });
      await setup.query(
        `UPDATE "TrainingEvent" SET status = 'COMPLETED', "updatedAt" = NOW() WHERE id = $1`,
        [fixture.eventId],
      );
      const finalized = await modules.occupancy.finalizeSessionCanonicalClose(
        {
          sessionId: fixture.sessionId,
          authority: "DEBRIEF_EMPTY_TIMEOUT",
          now: NOW,
          durations: DURATIONS,
        },
        prisma,
      );
      assert.equal(finalized.applied, false);
      assert.equal(finalized.session?.roomLifecycle, "DEBRIEF_OPEN");
    } finally {
      await cleanupFixture(setup, fixture);
      await setup.end();
      await prisma.$disconnect();
      await pool.end();
    }
  },
);

async function runAbandonedReconcile(
  modules: Awaited<ReturnType<typeof loadLifecycleModules>>,
  prisma: PrismaClient,
  sessionId: string,
) {
  return modules.occupancy.reconcileSessionAutomaticClose(sessionId, prisma, {
    now: NOW,
    durations: DURATIONS,
    invocation: "periodic",
  });
}

test("A1 PREPARATION abandoned close is terminal without a recording stop", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createOpenSession(setup, fixture, {
      negotiationState: "PREPARATION",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: NOW,
    });
    const closed = await runAbandonedReconcile(modules, prisma, fixture.sessionId);
    assert.equal(closed.closed, true);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.status, "COMPLETED");
    assert.equal(row?.negotiationState, "FINISHED");
    assert.ok(row?.negotiationEndedAt);
    assert.equal(row?.roomLifecycle, "CLOSED");
    assert.equal(row?.closeReason, "SESSION_ABANDONED_TIMEOUT");
    assert.equal(await countStopOperations(setup, fixture.sessionId), 0);
  } finally {
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("A2 READY_TO_START abandoned close is terminal without a recording stop", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createOpenSession(setup, fixture, {
      negotiationState: "READY_TO_START",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: NOW,
    });
    const closed = await runAbandonedReconcile(modules, prisma, fixture.sessionId);
    assert.equal(closed.closed, true);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.status, "COMPLETED");
    assert.equal(row?.negotiationState, "FINISHED");
    assert.ok(row?.negotiationEndedAt);
    assert.equal(row?.roomLifecycle, "CLOSED");
    assert.equal(row?.closeReason, "SESSION_ABANDONED_TIMEOUT");
    assert.equal(await countStopOperations(setup, fixture.sessionId), 0);
  } finally {
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("A3 RUNNING abandoned close finishes negotiation and claims one stop", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createOpenSession(setup, fixture, {
      negotiationState: "RUNNING",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: NOW,
      withRecording: true,
    });
    const closed = await runAbandonedReconcile(modules, prisma, fixture.sessionId);
    assert.equal(closed.closed, true);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.status, "COMPLETED");
    assert.equal(row?.negotiationState, "FINISHED");
    assert.ok(row?.negotiationEndedAt);
    assert.equal(row?.roomLifecycle, "CLOSED");
    assert.equal(row?.closeReason, "SESSION_ABANDONED_TIMEOUT");
    assert.equal(await countStopOperations(setup, fixture.sessionId), 1);
    const recording = await setup.query<{ status: string }>(
      `SELECT status FROM "Recording" WHERE "sessionId" = $1`,
      [fixture.sessionId],
    );
    assert.ok(["STOPPED", "COMPLETED", "PROCESSING", "RECORDING"].includes(recording.rows[0]?.status ?? ""));
  } finally {
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("A4 PAUSED abandoned close finishes negotiation and claims one stop", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createOpenSession(setup, fixture, {
      negotiationState: "PAUSED",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: NOW,
      withRecording: true,
      pausedAt: new Date(NOW.getTime() - 60_000),
    });
    const closed = await runAbandonedReconcile(modules, prisma, fixture.sessionId);
    assert.equal(closed.closed, true);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.status, "COMPLETED");
    assert.equal(row?.negotiationState, "FINISHED");
    assert.ok(row?.negotiationEndedAt);
    assert.equal(row?.roomLifecycle, "CLOSED");
    assert.equal(row?.closeReason, "SESSION_ABANDONED_TIMEOUT");
    assert.equal(await countStopOperations(setup, fixture.sessionId), 1);
  } finally {
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test(
  "A5/R4 real completeSessionCanonical vs abandoned is one terminal lifecycle and one stop",
  { concurrency: false },
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }
    const databaseUrl = resolveE2eDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const setup = new pg.Client({ connectionString: databaseUrl });
    const fixture = newFixture();
    const modules = await loadLifecycleModules();
    await setup.connect();
    try {
      await createUserAndCase(setup, fixture);
      await createOpenSession(setup, fixture, {
        negotiationState: "RUNNING",
        createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
        updatedAt: NOW,
        withRecording: true,
      });
      const [manual, automatic] = await Promise.all([
        modules.completion.completeSessionCanonical({
          sessionId: fixture.sessionId,
          mode: "ADMINISTRATIVE_SESSION_FINISH",
          reason: "FACILITATOR_SESSION_COMPLETE",
          hardClose: true,
          now: NOW,
          durations: DURATIONS,
          client: prisma,
        }),
        modules.occupancy.reconcileSessionAutomaticClose(
          fixture.sessionId,
          prisma,
          { now: NOW, durations: DURATIONS, invocation: "periodic" },
        ),
      ]);
      const row = await readSessionRow(setup, fixture.sessionId);
      assert.equal(row?.status, "COMPLETED");
      assert.equal(row?.negotiationState, "FINISHED");
      assert.ok(row?.negotiationEndedAt);
      assert.equal(row?.roomLifecycle, "CLOSED");
      assert.ok(
        row?.closeReason === "FACILITATOR_SESSION_COMPLETE" ||
          row?.closeReason === "SESSION_ABANDONED_TIMEOUT",
      );
      assert.equal(
        [manual.sessionCloseApplied, automatic.closed].filter(Boolean).length <= 1,
        true,
      );
      assert.equal(await countStopOperations(setup, fixture.sessionId), 1);
    } finally {
      await cleanupFixture(setup, fixture);
      await setup.end();
      await prisma.$disconnect();
      await pool.end();
    }
  },
);

test("A6 repeated abandoned reconciliation after terminal does not create a second stop", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createOpenSession(setup, fixture, {
      negotiationState: "RUNNING",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: NOW,
      withRecording: true,
    });
    const first = await runAbandonedReconcile(modules, prisma, fixture.sessionId);
    const second = await runAbandonedReconcile(modules, prisma, fixture.sessionId);
    assert.equal(first.closed, true);
    assert.equal(second.closed, false);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.roomLifecycle, "CLOSED");
    assert.equal(row?.closeReason, "SESSION_ABANDONED_TIMEOUT");
    assert.equal(await countStopOperations(setup, fixture.sessionId), 1);
  } finally {
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("A7 Debrief empty/max close does not start a second recording stop", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createDebriefSession(setup, fixture, {
      endedAt: new Date(NOW.getTime() - 90_000),
      updatedAt: NOW,
      withRecording: true,
    });
    await setup.query(
      `INSERT INTO "SessionRecordingStopOperation"
         ("id", "sessionId", "recordingId", "provider", "requestedByMode",
          "requestReason", "operationId", "state", "updatedAt")
       VALUES ($1, $2, $3, 'LIVEKIT_CLOUD', 'ROOM_FACILITATOR_FINISH',
               'FINISH', $4, 'DELIVERED', NOW())`,
      [
        randomUUID(),
        fixture.sessionId,
        fixture.recordingId,
        `stop:${fixture.recordingId}:legacy:room_facilitator_finish`,
      ],
    );
    const closed = await modules.occupancy.reconcileSessionAutomaticClose(
      fixture.sessionId,
      prisma,
      { now: NOW, durations: DURATIONS, invocation: "periodic" },
    );
    assert.equal(closed.closed, true);
    assert.equal(await countStopOperations(setup, fixture.sessionId), 1);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.closeReason, "DEBRIEF_EMPTY_TIMEOUT");
    assert.equal(row?.negotiationState, "FINISHED");
  } finally {
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("abandoned claim-first overlap admits the user and does not finish negotiation", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  const claimHold = barrier();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createOpenSession(setup, fixture, {
      negotiationState: "RUNNING",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: NOW,
      withRecording: true,
    });
    modules.hooks.setSessionLifecycleConcurrencyHooksForTests({
      afterSessionRowLockedForClaim: () => claimHold.wait(),
    });
    const claimPromise = modules.lease.claimSessionRoomConnectionLease(
      {
        sessionId: fixture.sessionId,
        userId: fixture.userId,
        connectionId: `abandoned-claim-${fixture.sessionId}`,
        role: "FACILITATOR",
        now: NOW,
      },
      prisma,
    );
    await claimHold.arrived;
    const closePromise = modules.occupancy.reconcileSessionAutomaticClose(
      fixture.sessionId,
      prisma,
      { now: NOW, durations: DURATIONS, invocation: "periodic" },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    claimHold.release();
    const [claimed, closed] = await Promise.all([claimPromise, closePromise]);
    assert.equal(claimed.isCurrentConnectionActive, true);
    assert.equal(closed.closed, false);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.negotiationState, "RUNNING");
    assert.equal(row?.roomLifecycle, "OPEN");
    assert.equal(row?.negotiationEndedAt, null);
    assert.equal(await countStopOperations(setup, fixture.sessionId), 0);
  } finally {
    modules.hooks.clearSessionLifecycleConcurrencyHooksForTests();
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("abandoned close-first overlap closes and refuses the later claim", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const fixture = newFixture();
  const modules = await loadLifecycleModules();
  const finalizeHold = barrier();
  await setup.connect();
  try {
    await createUserAndCase(setup, fixture);
    await createOpenSession(setup, fixture, {
      negotiationState: "RUNNING",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: NOW,
      withRecording: true,
    });
    modules.hooks.setSessionLifecycleConcurrencyHooksForTests({
      afterSessionRowLockedForFinalize: () => finalizeHold.wait(),
    });
    const closePromise = modules.occupancy.reconcileSessionAutomaticClose(
      fixture.sessionId,
      prisma,
      { now: NOW, durations: DURATIONS, invocation: "periodic" },
    );
    await finalizeHold.arrived;
    const claimPromise = modules.lease.claimSessionRoomConnectionLease(
      {
        sessionId: fixture.sessionId,
        userId: fixture.userId,
        connectionId: `abandoned-late-${fixture.sessionId}`,
        role: "FACILITATOR",
        now: NOW,
      },
      prisma,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    finalizeHold.release();
    const [closed, claimed] = await Promise.all([closePromise, claimPromise]);
    assert.equal(closed.closed, true);
    assert.equal(claimed.isCurrentConnectionActive, false);
    const row = await readSessionRow(setup, fixture.sessionId);
    assert.equal(row?.roomLifecycle, "CLOSED");
    assert.equal(row?.negotiationState, "FINISHED");
    assert.equal(await countStopOperations(setup, fixture.sessionId), 1);
  } finally {
    modules.hooks.clearSessionLifecycleConcurrencyHooksForTests();
    await cleanupFixture(setup, fixture);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("C3 terminal-parent Debrief child does not occupy the empty candidate page", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const terminal = newFixture();
  terminal.eventId = randomUUID();
  const operable = newFixture();
  operable.userId = terminal.userId;
  operable.caseId = terminal.caseId;
  const modules = await loadLifecycleModules();
  const ids = [terminal.sessionId, operable.sessionId];
  await setup.connect();
  try {
    await createUserAndCase(setup, terminal);
    await createDebriefSession(setup, terminal, {
      endedAt: new Date(NOW.getTime() - 90_000),
      updatedAt: new Date(NOW.getTime() - 2_000),
      eventId: terminal.eventId,
      eventStatus: "COMPLETED",
    });
    await createDebriefSession(setup, operable, {
      endedAt: new Date(NOW.getTime() - 90_000),
      updatedAt: new Date(NOW.getTime() - 1_000),
    });
    const selected = await modules.selector.selectSessionLifecycleReconcileCandidateIds({
      now: NOW,
      limit: 1,
      durations: DURATIONS,
      scopeSessionIds: ids,
      client: prisma,
    });
    assert.deepEqual(selected, [operable.sessionId]);
  } finally {
    await setup.query(`DELETE FROM "Session" WHERE id = ANY($1::text[])`, [ids]);
    await cleanupFixture(setup, terminal);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("C4 recent current-generation Debrief departure cannot starve a true empty-due Session", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const recent = newFixture();
  const due = newFixture();
  due.userId = recent.userId;
  due.caseId = recent.caseId;
  const modules = await loadLifecycleModules();
  const ids = [recent.sessionId, due.sessionId];
  await setup.connect();
  try {
    await createUserAndCase(setup, recent);
    await createDebriefSession(setup, recent, {
      endedAt: new Date(NOW.getTime() - 90_000),
      updatedAt: new Date(NOW.getTime() - 2_000),
    });
    await insertDepartedLease(setup, recent, new Date(NOW.getTime() - 10_000));
    await createDebriefSession(setup, due, {
      endedAt: new Date(NOW.getTime() - 90_000),
      updatedAt: new Date(NOW.getTime() - 1_000),
    });
    const selected = await modules.selector.selectSessionLifecycleReconcileCandidateIds({
      now: NOW,
      limit: 1,
      durations: DURATIONS,
      scopeSessionIds: ids,
      client: prisma,
    });
    assert.deepEqual(selected, [due.sessionId]);
  } finally {
    await setup.query(`DELETE FROM "Session" WHERE id = ANY($1::text[])`, [ids]);
    await cleanupFixture(setup, recent);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

test("C5 recent current-generation abandoned departure cannot starve a true abandoned-due Session", { concurrency: false }, async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip(SKIP_REASON);
    return;
  }
  const databaseUrl = resolveE2eDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const setup = new pg.Client({ connectionString: databaseUrl });
  const recent = newFixture();
  const due = newFixture();
  due.userId = recent.userId;
  due.caseId = recent.caseId;
  const modules = await loadLifecycleModules();
  const ids = [recent.sessionId, due.sessionId];
  await setup.connect();
  try {
    await createUserAndCase(setup, recent);
    await createOpenSession(setup, recent, {
      negotiationState: "RUNNING",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() - 2_000),
    });
    await insertDepartedLease(setup, recent, new Date(NOW.getTime() - 5 * 60 * 1000));
    await createOpenSession(setup, due, {
      negotiationState: "RUNNING",
      createdAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() - 1_000),
    });
    const selected = await modules.selector.selectSessionLifecycleReconcileCandidateIds({
      now: NOW,
      limit: 1,
      durations: DURATIONS,
      scopeSessionIds: ids,
      client: prisma,
    });
    assert.deepEqual(selected, [due.sessionId]);
  } finally {
    await setup.query(`DELETE FROM "Session" WHERE id = ANY($1::text[])`, [ids]);
    await cleanupFixture(setup, recent);
    await setup.end();
    await prisma.$disconnect();
    await pool.end();
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  getSanitizedE2eDatabaseDescriptor,
  isE2eDatabaseConfigured,
  resolveE2eDatabaseUrl,
} from "../../tests/e2e/helpers/e2e-database";
import { lockSessionParticipantsById } from "@/lib/session-participant-locking";

const SKIP_REASON =
  "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createFixture(
  client: pg.Client,
  fixture: {
    caseId: string;
    userId: string;
    sessionId: string;
    analysisId: string;
    firstParticipantId: string;
    secondParticipantId: string;
  },
) {
  await client.query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "globalRole", "status", "preferredLocale", "updatedAt")
     VALUES ($1, $2, 'test-password-hash', 'Wave C Lock Test', 'USER', 'ACTIVE', 'en', NOW())`,
    [fixture.userId, `wave-c-lock-${fixture.userId}@test.negotaitions.local`],
  );
  await client.query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "createdByUserId", "visibility", "updatedAt")
     VALUES ($1, 'Wave C Lock Test', 'test', 'test', 'test', 'test', 'EASY', 'EN',
             60, 60, $2, $2, 'PRIVATE', NOW())`,
    [fixture.caseId, fixture.userId],
  );
  await client.query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "negotiationState", "updatedAt")
     VALUES ($1, $2, $3, 'Wave C Lock Test', 'Wave C Lock Test',
             'test', 'test', 'EN', 'FINISHED', NOW())`,
    [fixture.sessionId, fixture.caseId, fixture.userId],
  );
  await client.query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "type", "joinToken", "displayName", "updatedAt")
     VALUES
       ($1, $3, 'PARTICIPANT', $1, 'First participant', NOW()),
       ($2, $3, 'PARTICIPANT', $2, 'Second participant', NOW())`,
    [
      fixture.firstParticipantId,
      fixture.secondParticipantId,
      fixture.sessionId,
    ],
  );
  await client.query(
    `INSERT INTO "AiAnalysis"
       ("id", "sessionId", "status", "runToken", "updatedAt")
     VALUES ($1, $2, 'ANALYZING', 'wave-c-lock-token', NOW())`,
    [fixture.analysisId, fixture.sessionId],
  );
}

async function cleanupFixture(
  client: pg.Client,
  fixture: { caseId: string; userId: string; sessionId: string },
) {
  await client.query(`DELETE FROM "Session" WHERE "id" = $1`, [
    fixture.sessionId,
  ]);
  await client.query(`DELETE FROM "NegotiationCase" WHERE "id" = $1`, [
    fixture.caseId,
  ]);
  await client.query(`DELETE FROM "User" WHERE "id" = $1`, [fixture.userId]);
}

test(
  "current-roster finalization and concurrent multi-row role mutation serialize by participant id",
  async (t) => {
    if (!isE2eDatabaseConfigured()) {
      t.skip(SKIP_REASON);
      return;
    }

    const databaseUrl = resolveE2eDatabaseUrl();
    const descriptor = getSanitizedE2eDatabaseDescriptor(databaseUrl);
    console.log(
      `[analysis-operation-lock-db] host=${descriptor.normalizedHost} port=${descriptor.port} database=${descriptor.database}`,
    );

    const ids = [randomUUID(), randomUUID()].sort((left, right) =>
      left.localeCompare(right),
    );
    const fixture = {
      caseId: randomUUID(),
      userId: randomUUID(),
      sessionId: randomUUID(),
      analysisId: randomUUID(),
      firstParticipantId: ids[0]!,
      secondParticipantId: ids[1]!,
    };
    const setup = new pg.Client({ connectionString: databaseUrl });
    const mutation = new pg.Client({ connectionString: databaseUrl });
    const finalization = new pg.Client({ connectionString: databaseUrl });
    await Promise.all([setup.connect(), mutation.connect(), finalization.connect()]);

    const mutationLocked = deferred();
    const finalizationAboutToLock = deferred();
    const allowMutationToCommit = deferred();
    let finalizationLockQuery = "";

    try {
      await createFixture(setup, fixture);

      const mutationPromise = (async () => {
        await mutation.query("BEGIN");
        try {
          let mutationLockQuery = "";
          await lockSessionParticipantsById(
            {
              $queryRaw: async (query: { strings: readonly string[] }) => {
                mutationLockQuery = query.strings.join("");
                assert.match(
                  mutationLockQuery,
                  /ORDER BY id ASC\s+FOR UPDATE/,
                );
                const result = await mutation.query<{ id: string }>(
                  `SELECT "id"
                   FROM "SessionParticipant"
                   WHERE "sessionId" = $1
                   ORDER BY "id" ASC
                   FOR UPDATE`,
                  [fixture.sessionId],
                );
                assert.deepEqual(
                  result.rows.map((row) => row.id),
                  [fixture.firstParticipantId, fixture.secondParticipantId],
                );
                return result;
              },
            } as never,
            fixture.sessionId,
            [fixture.secondParticipantId, fixture.firstParticipantId],
          );
          mutationLocked.resolve();
          await allowMutationToCommit.promise;

          for (const participantId of [
            fixture.firstParticipantId,
            fixture.secondParticipantId,
          ]) {
            await mutation.query(
              `UPDATE "SessionParticipant"
               SET "type" = CASE WHEN "id" = $2 THEN 'OBSERVER'::"ParticipantType"
                                 ELSE 'PARTICIPANT'::"ParticipantType" END
               WHERE "id" = $1`,
              [participantId, fixture.firstParticipantId],
            );
          }
          await mutation.query("COMMIT");
        } catch (error) {
          await mutation.query("ROLLBACK");
          throw error;
        }
      })();

      await mutationLocked.promise;

      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;
      const { completeAiAnalysisRunWithCurrentParticipants } = await import(
        "@/lib/ai/analysis-operation"
      );
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }

      const completionClient = {
        $transaction: async (
          operation: (tx: {
            $queryRaw: (query: { strings: readonly string[] }) => Promise<unknown>;
            sessionParticipant: {
              findMany: () => Promise<
                Array<{ id: string; displayName: string; type: string }>
              >;
            };
            aiAnalysis: {
              updateMany: (input: {
                where: { id: string; runToken: string };
                data: {
                  model: string;
                  executiveSummary: string;
                  overallScore: number;
                  analysisJson: unknown;
                  rawModelOutput: unknown;
                  completedAt: Date;
                };
              }) => Promise<{ count: number }>;
            };
          }) => Promise<boolean>,
        ) => {
          await finalization.query("BEGIN");
          try {
            const result = await operation({
              $queryRaw: async (query) => {
                finalizationLockQuery = query.strings.join("");
                assert.match(finalizationLockQuery, /ORDER BY id ASC\s+FOR UPDATE/);
                finalizationAboutToLock.resolve();
                return finalization.query(
                  `SELECT "id"
                   FROM "SessionParticipant"
                   WHERE "sessionId" = $1
                   ORDER BY "id" ASC
                   FOR UPDATE`,
                  [fixture.sessionId],
                );
              },
              sessionParticipant: {
                findMany: async () => {
                  const result = await finalization.query<{
                    id: string;
                    displayName: string;
                    type: string;
                  }>(
                    `SELECT "id", "displayName", "type"
                     FROM "SessionParticipant"
                     WHERE "sessionId" = $1
                     ORDER BY "id" ASC`,
                    [fixture.sessionId],
                  );
                  return result.rows;
                },
              },
              aiAnalysis: {
                updateMany: async ({ where, data }) => {
                  const result = await finalization.query(
                    `UPDATE "AiAnalysis"
                     SET "status" = 'COMPLETED',
                         "leaseExpiresAt" = NULL,
                         "model" = $3,
                         "executiveSummary" = $4,
                         "overallScore" = $5,
                         "analysisJson" = $6::jsonb,
                         "rawModelOutput" = $7::jsonb,
                         "completedAt" = $8,
                         "providerResponseId" = NULL,
                         "errorMessage" = NULL,
                         "updatedAt" = NOW()
                     WHERE "id" = $1
                       AND "runToken" = $2
                       AND "status" = 'ANALYZING'`,
                    [
                      where.id,
                      where.runToken,
                      data.model,
                      data.executiveSummary,
                      data.overallScore,
                      JSON.stringify(data.analysisJson),
                      JSON.stringify(data.rawModelOutput),
                      data.completedAt,
                    ],
                  );
                  return { count: result.rowCount ?? 0 };
                },
              },
            });
            await finalization.query("COMMIT");
            return result;
          } catch (error) {
            await finalization.query("ROLLBACK");
            throw error;
          }
        },
      };

      const completionPromise = completeAiAnalysisRunWithCurrentParticipants({
        sessionId: fixture.sessionId,
        owner: {
          analysisId: fixture.analysisId,
          runToken: "wave-c-lock-token",
          leaseExpiresAt: new Date("2026-08-14T15:00:00.000Z"),
          providerResponseId: null,
        },
        completedAt: new Date("2026-08-14T15:01:00.000Z"),
        client: completionClient as never,
        buildFields: (participants) => ({
          model: "test-model",
          executiveSummary: "test",
          overallScore: 1,
          analysisJson: {
            participantPersonalFeedback: participants
              .filter((participant) => participant.type === "PARTICIPANT")
              .map((participant) => ({
                sessionParticipantId: participant.id,
              })),
          },
          rawModelOutput: {},
        }),
      });

      await finalizationAboutToLock.promise;
      allowMutationToCommit.resolve();
      await mutationPromise;
      assert.equal(await completionPromise, true);

      const persisted = await setup.query<{
        status: string;
        analysisJson: {
          participantPersonalFeedback: Array<{ sessionParticipantId: string }>;
        };
      }>(
        `SELECT "status", "analysisJson"
         FROM "AiAnalysis"
         WHERE "id" = $1`,
        [fixture.analysisId],
      );
      assert.equal(persisted.rows[0]?.status, "COMPLETED");
      assert.deepEqual(
        persisted.rows[0]?.analysisJson.participantPersonalFeedback,
        [{ sessionParticipantId: fixture.secondParticipantId }],
      );
    } finally {
      await cleanupFixture(setup, fixture);
      await Promise.all([setup.end(), mutation.end(), finalization.end()]);
    }
  },
);

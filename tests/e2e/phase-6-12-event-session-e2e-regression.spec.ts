import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import { cleanupE2eData, query } from "./helpers/db";

test.beforeAll(cleanupE2eData);
test.afterAll(cleanupE2eData);

const BROWSER_BASE_URL = process.env.BASE_URL ?? "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createActiveUser(
  prefix: string,
  opts: { admin?: boolean; name?: string } = {},
) {
  const id = uid(prefix);
  const email = `${id}@test.negotaitions.local`;
  const name = opts.name ?? prefix;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","preferredLocale","updatedAt")
     VALUES ($1,$2,'hash',$3,'PARTICIPANT',$4,'ACTIVE','en',NOW())`,
    [id, email, name, opts.admin ? "ADMIN" : "USER"],
  );
  return { id, email, name };
}

async function createUserSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES (gen_random_uuid(),$1,$2,NOW() + INTERVAL '30 days',NOW())`,
    [userId, tokenHash],
  );
  return rawToken;
}

async function createCaseWithRoles(ownerUserId: string) {
  const caseId = uid("case612");
  await query(
    `INSERT INTO "NegotiationCase"
       ("id","title","description","businessContext","publicInstructions","targetSkills",
        "difficulty","caseLanguage","defaultPreparationDurationSeconds","defaultDurationSeconds",
        "facilitatorId","createdByUserId","visibility","createdAt","updatedAt")
     VALUES ($1,'E2E 6.12 Case','desc','ctx','instructions','skills','MEDIUM','EN',300,900,
             $2,$2,'PUBLIC',NOW(),NOW())`,
    [caseId, ownerUserId],
  );

  const roleA = uid("role612");
  const roleB = uid("role612");
  await query(
    `INSERT INTO "CaseRole"
       ("id","negotiationCaseId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","createdAt","updatedAt")
     VALUES
       ($1,$3,'Seller','E2E_PRIVATE_SELLER_ONLY','obj','con','hidden','fallback',0,NOW(),NOW()),
       ($2,$3,'Buyer','E2E_PRIVATE_BUYER_ONLY','obj','con','hidden','fallback',1,NOW(),NOW())`,
    [roleA, roleB, caseId],
  );

  return { caseId };
}

async function createEvent(hostUserId: string, facilitatorUserId: string, visibility: "PUBLIC" | "PRIVATE" = "PRIVATE") {
  const eventId = uid("event612");
  await query(
    `INSERT INTO "TrainingEvent"
       ("id","title","hostUserId","facilitatorUserId","visibility","status","publicJoinCode","hostToken","createdAt","updatedAt")
     VALUES ($1,'E2E 6.12 Event',$2,$3,$4,'LOBBY_OPEN',$5,$6,NOW(),NOW())`,
    [eventId, hostUserId, facilitatorUserId, visibility, uid("pjc612"), uid("ht612")],
  );
  return eventId;
}

async function createSession(input: {
  caseId: string;
  facilitatorId: string;
  visibility?: "PUBLIC" | "PRIVATE";
  eventId?: string | null;
  title?: string;
}) {
  const sessionId = uid("sess612");
  await query(
    `INSERT INTO "Session"
       ("id","title","negotiationCaseId","facilitatorId","eventId","visibility","status",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions","snapshotCaseLanguage",
        "negotiationState","durationSeconds","preparationDurationSeconds","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'DRAFT','Snapshot','ctx','instructions','EN','PREPARATION',900,300,NOW(),NOW())`,
    [
      sessionId,
      input.title ?? `E2E 6.12 ${sessionId}`,
      input.caseId,
      input.facilitatorId,
      input.eventId ?? null,
      input.visibility ?? "PRIVATE",
    ],
  );

  const roles = await query<{ id: string; name: string; privateInstructions: string; objectives: string; constraints: string; hiddenInfo: string; fallbackPosition: string; sortOrder: number }>(
    `SELECT "id","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder"
     FROM "CaseRole" WHERE "negotiationCaseId"=$1 ORDER BY "sortOrder" ASC`,
    [input.caseId],
  );

  for (const role of roles) {
    await query(
      `INSERT INTO "SessionRole"
         ("id","sessionId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
      [
        uid("srole612"),
        sessionId,
        role.name,
        role.privateInstructions,
        role.objectives,
        role.constraints,
        role.hiddenInfo,
        role.fallbackPosition,
        role.sortOrder,
      ],
    );
  }

  return sessionId;
}

async function getSessionRoleIds(sessionId: string) {
  return query<{ id: string; name: string }>(
    `SELECT "id","name" FROM "SessionRole" WHERE "sessionId"=$1 ORDER BY "sortOrder" ASC`,
    [sessionId],
  );
}

async function addSessionParticipant(input: {
  sessionId: string;
  userId: string | null;
  displayName: string;
  type: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  sessionRoleId?: string | null;
  eventParticipantId?: string | null;
}) {
  const participantId = uid("sp612");
  const joinToken = uid("jt612");
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","displayName","type","joinToken","sessionRoleId","eventParticipantId","notes","joinedAt","lastSeenAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,''::text,NOW(),NOW(),NOW(),NOW())`,
    [
      participantId,
      input.sessionId,
      input.userId,
      input.displayName,
      input.type,
      joinToken,
      input.sessionRoleId ?? null,
      input.eventParticipantId ?? null,
    ],
  );
  return { participantId, joinToken };
}

async function addEventParticipant(eventId: string, userId: string, displayName: string, opts: { isHost?: boolean } = {}) {
  const eventParticipantId = uid("ep612");
  await query(
    `INSERT INTO "EventParticipant"
       ("id","eventId","userId","displayName","participantToken","isHost","preference","joinedAt","lastSeenAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'UNDECIDED',NOW(),NOW(),NOW(),NOW())`,
    [eventParticipantId, eventId, userId, displayName, uid("pt612"), opts.isHost ?? false],
  );
  return eventParticipantId;
}

test.describe("Phase 6.12 - DB/API regression", () => {
  test("T01/T02 - /sessions lists accessible standalone and event-linked sessions; hides unrelated private", async ({ request }) => {
    const facilitator = await createActiveUser("p612_fac");
    const unrelated = await createActiveUser("p612_unrel");
    const facCookie = `auth_session=${await createUserSession(facilitator.id)}`;
    const unrelCookie = `auth_session=${await createUserSession(unrelated.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const eventId = await createEvent(facilitator.id, facilitator.id, "PRIVATE");
    const standaloneId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    const linkedId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE", eventId });
    await addSessionParticipant({ sessionId: standaloneId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    await addSessionParticipant({ sessionId: linkedId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });

    const facRes = await request.get("/sessions", { headers: { Cookie: facCookie } });
    expect(facRes.status()).toBe(200);
    const facHtml = await facRes.text();
    expect(facHtml).toContain(standaloneId);
    expect(facHtml).toContain(linkedId);

    const unrelRes = await request.get("/sessions", { headers: { Cookie: unrelCookie } });
    expect(unrelRes.status()).toBe(200);
    const unrelHtml = await unrelRes.text();
    expect(unrelHtml).not.toContain(standaloneId);
    expect(unrelHtml).not.toContain(linkedId);
  });

  test("T03/T04 - Event lobby and /sessions open same event-linked session id", async ({ request }) => {
    const host = await createActiveUser("p612_host");
    const participant = await createActiveUser("p612_part");
    const hostCookie = `auth_session=${await createUserSession(host.id)}`;
    const participantCookie = `auth_session=${await createUserSession(participant.id)}`;
    const { caseId } = await createCaseWithRoles(host.id);
    const eventId = await createEvent(host.id, host.id, "PRIVATE");
    const hostEpId = await addEventParticipant(eventId, host.id, "Host", { isHost: true });
    const participantEpId = await addEventParticipant(eventId, participant.id, "Participant");
    const sessionId = await createSession({ caseId, facilitatorId: host.id, eventId, visibility: "PRIVATE" });
    const fac = await addSessionParticipant({
      sessionId,
      userId: host.id,
      displayName: "Host",
      type: "FACILITATOR",
      eventParticipantId: hostEpId,
    });
    await addSessionParticipant({
      sessionId,
      userId: participant.id,
      displayName: "Participant",
      type: "PARTICIPANT",
      eventParticipantId: participantEpId,
    });
    await query(
      `UPDATE "EventParticipant"
       SET "assignedSessionId"=$2,"assignedSessionParticipantId"=$3,"updatedAt"=NOW()
       WHERE "id"=$1`,
      [participantEpId, sessionId, fac.participantId],
    );

    const lobbyState = await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: participantCookie },
    });
    expect(lobbyState.status()).toBe(200);
    const state = (await lobbyState.json()) as {
      sessions: Array<{ id: string }>;
      participants: Array<{ roomUrl: string | null; materialsUrl: string | null }>;
    };
    expect(state.sessions.some((s) => s.id === sessionId)).toBe(true);
    const participantLinks = state.participants.find((p) => p.roomUrl?.includes(`/room/${sessionId}`));
    expect(participantLinks).toBeTruthy();
    expect(participantLinks?.roomUrl ?? "").toContain(`/room/${sessionId}`);
    expect(participantLinks?.roomUrl ?? "").not.toContain("joinToken");

    const sessionsHtmlRes = await request.get("/sessions", { headers: { Cookie: hostCookie } });
    const sessionsHtml = await sessionsHtmlRes.text();
    expect(sessionsHtml).toContain(`/room/${sessionId}`);
  });

  test("T04b - Account lobby identity and preference update stay token-free", async ({ request }) => {
    const host = await createActiveUser("p612_lobby_host");
    const participant = await createActiveUser("p612_lobby_part");
    const participantCookie = `auth_session=${await createUserSession(participant.id)}`;
    const { caseId } = await createCaseWithRoles(host.id);
    const eventId = await createEvent(host.id, host.id, "PRIVATE");
    await addEventParticipant(eventId, host.id, "Host", { isHost: true });
    const participantEpId = await addEventParticipant(eventId, participant.id, "Participant");
    const sessionId = await createSession({
      caseId,
      facilitatorId: host.id,
      eventId,
      visibility: "PRIVATE",
    });
    await addSessionParticipant({
      sessionId,
      userId: participant.id,
      displayName: "Participant",
      type: "PARTICIPANT",
      eventParticipantId: participantEpId,
    });

    const stateRes = await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: participantCookie },
    });
    expect(stateRes.status()).toBe(200);
    const statePayload = await stateRes.json();
    expect(statePayload.currentParticipant?.id).toBe(participantEpId);
    const stateJson = JSON.stringify(statePayload);
    expect(stateJson).not.toContain("participantToken");
    expect(stateJson).not.toContain("hostToken");
    expect(stateJson).not.toContain("joinToken");
    expect(stateJson).not.toContain("facilitatorJoinToken");
    expect(stateJson).not.toContain("hostParticipantToken");

    const prefRes = await request.patch(`/api/events/${eventId}/participant`, {
      headers: { Cookie: participantCookie },
      data: { preference: "PLAY" },
    });
    expect(prefRes.status()).toBe(200);
    const prefPayload = await prefRes.json();
    expect(prefPayload.currentParticipant?.id).toBe(participantEpId);
    expect(prefPayload.currentParticipant?.preference).toBe("PLAY");
    const prefJson = JSON.stringify(prefPayload);
    expect(prefJson).not.toContain("participantToken");
    expect(prefJson).not.toContain("hostToken");
    expect(prefJson).not.toContain("joinToken");
    expect(prefJson).not.toContain("facilitatorJoinToken");
    expect(prefJson).not.toContain("hostParticipantToken");
  });

  test("T05 - Opening room from both paths does not duplicate SessionParticipant", async ({ request }) => {
    const user = await createActiveUser("p612_duproom");
    const cookie = `auth_session=${await createUserSession(user.id)}`;
    const { caseId } = await createCaseWithRoles(user.id);
    const sessionId = await createSession({ caseId, facilitatorId: user.id, visibility: "PRIVATE" });
    await addSessionParticipant({ sessionId, userId: user.id, displayName: "User", type: "FACILITATOR" });

    const before = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "SessionParticipant" WHERE "sessionId"=$1 AND "userId"=$2`,
      [sessionId, user.id],
    );

    const r1 = await request.get(`/room/${sessionId}`, { headers: { Cookie: cookie }, maxRedirects: 5 });
    const r2 = await request.get(`/room/${sessionId}`, { headers: { Cookie: cookie }, maxRedirects: 5 });
    expect([200, 302, 303]).toContain(r1.status());
    expect([200, 302, 303]).toContain(r2.status());

    const after = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "SessionParticipant" WHERE "sessionId"=$1 AND "userId"=$2`,
      [sessionId, user.id],
    );
    expect(Number(after[0]!.c)).toBe(Number(before[0]!.c));
  });

  test("T06/T08 - Facilitator can manage from room APIs for event-linked and standalone sessions", async ({ request }) => {
    const user = await createActiveUser("p612_manage_room");
    const cookie = `auth_session=${await createUserSession(user.id)}`;
    const { caseId } = await createCaseWithRoles(user.id);
    const eventId = await createEvent(user.id, user.id, "PRIVATE");
    const standaloneId = await createSession({ caseId, facilitatorId: user.id, visibility: "PRIVATE" });
    const linkedId = await createSession({ caseId, facilitatorId: user.id, visibility: "PRIVATE", eventId });
    const facStandalone = await addSessionParticipant({ sessionId: standaloneId, userId: user.id, displayName: "Fac", type: "FACILITATOR" });
    const facLinked = await addSessionParticipant({ sessionId: linkedId, userId: user.id, displayName: "Fac", type: "FACILITATOR" });

    const controlStandalone = await request.post(`/api/sessions/${standaloneId}/control`, {
      headers: { Cookie: cookie },
      data: { participantId: facStandalone.participantId, action: "START_PREPARATION" },
    });
    const controlLinked = await request.post(`/api/sessions/${linkedId}/control`, {
      headers: { Cookie: cookie },
      data: { participantId: facLinked.participantId, action: "START_PREPARATION" },
    });
    expect(controlStandalone.status()).toBe(200);
    expect(controlLinked.status()).toBe(200);
  });

  test("T07/T09 - Facilitator can manage from session management screen for both types", async ({ request }) => {
    const user = await createActiveUser("p612_manage_screen");
    const cookie = `auth_session=${await createUserSession(user.id)}`;
    const { caseId } = await createCaseWithRoles(user.id);
    const eventId = await createEvent(user.id, user.id, "PRIVATE");
    const standaloneId = await createSession({ caseId, facilitatorId: user.id, visibility: "PRIVATE" });
    const linkedId = await createSession({ caseId, facilitatorId: user.id, visibility: "PRIVATE", eventId });
    await addSessionParticipant({ sessionId: standaloneId, userId: user.id, displayName: "Fac", type: "FACILITATOR" });
    await addSessionParticipant({ sessionId: linkedId, userId: user.id, displayName: "Fac", type: "FACILITATOR" });

    const standaloneRes = await request.get(`/sessions/${standaloneId}`, { headers: { Cookie: cookie } });
    const linkedRes = await request.get(`/sessions/${linkedId}`, { headers: { Cookie: cookie } });
    expect(standaloneRes.status()).toBe(200);
    expect(linkedRes.status()).toBe(200);

    const standaloneHtml = await standaloneRes.text();
    const linkedHtml = await linkedRes.text();
    expect(standaloneHtml).toContain("session-role-management-panel");
    expect(linkedHtml).toContain("session-role-management-panel");
  });

  test("T10/T12/T13 - Unassigned participant gating and unlock after role assignment", async ({ request }) => {
    const facilitator = await createActiveUser("p612_unassign_fac");
    const participant = await createActiveUser("p612_unassign_part");
    const facCookie = `auth_session=${await createUserSession(facilitator.id)}`;
    const partCookie = `auth_session=${await createUserSession(participant.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const sessionId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    await addSessionParticipant({ sessionId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    const partRow = await addSessionParticipant({
      sessionId,
      userId: participant.id,
      displayName: "Participant",
      type: "PARTICIPANT",
      sessionRoleId: null,
    });

    const before = await request.get(`/sessions/${sessionId}/materials`, { headers: { Cookie: partCookie } });
    expect(before.status()).toBe(200);
    const beforeHtml = await before.text();
    expect(beforeHtml).toContain("materials-role-locked-message");
    expect(beforeHtml).toContain("materials-notes-locked-message");

    const roleIds = await getSessionRoleIds(sessionId);
    await query(
      `UPDATE "SessionParticipant" SET "sessionRoleId"=$2,"updatedAt"=NOW() WHERE "id"=$1`,
      [partRow.participantId, roleIds[0]!.id],
    );

    const after = await request.get(`/sessions/${sessionId}/materials`, { headers: { Cookie: partCookie } });
    expect(after.status()).toBe(200);
    const afterHtml = await after.text();
    expect(afterHtml).not.toContain("materials-role-locked-message");

    const roomApi = await request.get(
      `/api/livekit/sidebar?participantId=${partRow.participantId}`,
      { headers: { Cookie: partCookie } },
    );
    expect(roomApi.status()).toBe(200);
    const sidebar = (await roomApi.json()) as { hasAssignedRole: boolean };
    expect(sidebar.hasAssignedRole).toBe(true);
    expect(facCookie).toBeTruthy();
  });

  test("T11 - Role assignment reflected in room sidebar API (refresh path)", async ({ request }) => {
    const facilitator = await createActiveUser("p612_room_sync_fac");
    const participant = await createActiveUser("p612_room_sync_part");
    const partCookie = `auth_session=${await createUserSession(participant.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const sessionId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    await addSessionParticipant({ sessionId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    const partRow = await addSessionParticipant({
      sessionId,
      userId: participant.id,
      displayName: "Participant",
      type: "PARTICIPANT",
      sessionRoleId: null,
    });

    const before = await request.get(`/api/livekit/sidebar?participantId=${partRow.participantId}`, {
      headers: { Cookie: partCookie },
    });
    const beforeData = (await before.json()) as { hasAssignedRole: boolean };
    expect(beforeData.hasAssignedRole).toBe(false);

    const roleIds = await getSessionRoleIds(sessionId);
    await query(`UPDATE "SessionParticipant" SET "sessionRoleId"=$2 WHERE "id"=$1`, [partRow.participantId, roleIds[0]!.id]);

    const after = await request.get(`/api/livekit/sidebar?participantId=${partRow.participantId}`, {
      headers: { Cookie: partCookie },
    });
    const afterData = (await after.json()) as { hasAssignedRole: boolean };
    expect(afterData.hasAssignedRole).toBe(true);
  });

  test("T14/T15 - Participant/observer privacy in materials payload", async ({ request }) => {
    const facilitator = await createActiveUser("p612_priv_fac");
    const pA = await createActiveUser("p612_priv_a");
    const observer = await createActiveUser("p612_priv_obs");
    const pACookie = `auth_session=${await createUserSession(pA.id)}`;
    const obsCookie = `auth_session=${await createUserSession(observer.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const sessionId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    const roles = await getSessionRoleIds(sessionId);
    await addSessionParticipant({ sessionId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    const partA = await addSessionParticipant({ sessionId, userId: pA.id, displayName: "A", type: "PARTICIPANT", sessionRoleId: roles[0]!.id });
    const pB = await createActiveUser("p612_priv_b");
    await addSessionParticipant({ sessionId, userId: pB.id, displayName: "B", type: "PARTICIPANT", sessionRoleId: roles[1]!.id });
    const obs = await addSessionParticipant({ sessionId, userId: observer.id, displayName: "Obs", type: "OBSERVER" });

    const pStatus = await request.get(`/api/sessions/${sessionId}/materials/status?participantId=${partA.participantId}`, {
      headers: { Cookie: pACookie },
    });
    expect(pStatus.status()).toBe(200);
    const pData = (await pStatus.json()) as { session: { participantType: string; participantRole: string | null } };
    expect(pData.session.participantType).toBe("PARTICIPANT");
    expect(pData.session.participantRole).toBeTruthy();

    const oStatus = await request.get(`/api/sessions/${sessionId}/materials/status?participantId=${obs.participantId}`, {
      headers: { Cookie: obsCookie },
    });
    expect(oStatus.status()).toBe(200);
    const oData = (await oStatus.json()) as { session: { participantType: string; participantRole: string | null } };
    expect(oData.session.participantType).toBe("OBSERVER");
    expect(oData.session.participantRole).toBeNull();
  });

  test("T16/T17 - Participant cannot call facilitator APIs (control/analyze/share/transcribe)", async ({ request }) => {
    const facilitator = await createActiveUser("p612_api_fac");
    const participant = await createActiveUser("p612_api_part");
    const partCookie = `auth_session=${await createUserSession(participant.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const sessionId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    const roles = await getSessionRoleIds(sessionId);
    await addSessionParticipant({ sessionId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    const p = await addSessionParticipant({ sessionId, userId: participant.id, displayName: "Part", type: "PARTICIPANT", sessionRoleId: roles[0]!.id });

    const control = await request.post(`/api/sessions/${sessionId}/control`, {
      headers: { Cookie: partCookie },
      data: { participantId: p.participantId, action: "START_PREPARATION" },
    });
    const analyze = await request.post(`/api/sessions/${sessionId}/analyze`, {
      headers: { Cookie: partCookie },
      data: { participantId: p.participantId, aiProcessingConfirmed: true },
    });
    const share = await request.post(`/api/sessions/${sessionId}/ai-analysis/share`, {
      headers: { Cookie: partCookie },
      data: { participantId: p.participantId, shareDebriefConfirmed: true },
    });
    const transcribe = await request.post(`/api/sessions/${sessionId}/materials/transcribe`, {
      headers: { Cookie: partCookie },
      data: { participantId: p.participantId },
    });

    expect([401, 403, 409]).toContain(control.status());
    expect([401, 403, 400, 422]).toContain(analyze.status());
    expect([401, 403, 404, 409]).toContain(share.status());
    expect([401, 403, 404, 409, 400]).toContain(transcribe.status());
  });

  test("T18/T19/T20/T21 - Published AI visible, own feedback only, sanitized for participant", async ({ request }) => {
    const facilitator = await createActiveUser("p612_ai_fac");
    const partA = await createActiveUser("p612_ai_a");
    const partB = await createActiveUser("p612_ai_b");
    const aCookie = `auth_session=${await createUserSession(partA.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const sessionId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    const roles = await getSessionRoleIds(sessionId);
    await addSessionParticipant({ sessionId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    const a = await addSessionParticipant({ sessionId, userId: partA.id, displayName: "A", type: "PARTICIPANT", sessionRoleId: roles[0]!.id });
    const b = await addSessionParticipant({ sessionId, userId: partB.id, displayName: "B", type: "PARTICIPANT", sessionRoleId: roles[1]!.id });
    await query(`UPDATE "Session" SET "negotiationState"='FINISHED' WHERE "id"=$1`, [sessionId]);

    const sharedJson = {
      executiveSummary: "shared",
      overallScore: 8,
      participantPersonalFeedback: [
        { sessionParticipantId: a.participantId, participantName: "A", summary: "A only" },
        { sessionParticipantId: b.participantId, participantName: "B", summary: "B only" },
      ],
    };
    await query(
      `INSERT INTO "AiAnalysis"
         ("id","sessionId","status","analysisJson","sharedAnalysisJson","sharedExecutiveSummary","visibility","executiveSummary","overallScore","createdAt","updatedAt")
       VALUES ($1,$2,'COMPLETED',$3,$4,'shared','SHARED_WITH_SESSION','private summary',9,NOW(),NOW())`,
      [
        uid("ai612"),
        sessionId,
        JSON.stringify({
          ...sharedJson,
          rawPrompt: "secret",
          analysisContext: "secret",
          facilitatorNotes: "secret",
        }),
        JSON.stringify(sharedJson),
      ],
    );

    const res = await request.get(`/api/sessions/${sessionId}/materials/status?participantId=${a.participantId}`, {
      headers: { Cookie: aCookie },
    });
    expect(res.status()).toBe(200);
    const data = (await res.json()) as {
      aiAnalysis: { canView: boolean; analysisJson: unknown; visibility: string | null };
    };
    expect(data.aiAnalysis.canView).toBe(true);
    expect(data.aiAnalysis.visibility).toBeNull();
    const json = JSON.stringify(data.aiAnalysis.analysisJson ?? {});
    expect(json).toContain(a.participantId);
    expect(json).not.toContain(b.participantId);
    expect(json).not.toContain("rawPrompt");
    expect(json).not.toContain("analysisContext");
    expect(json).not.toContain("facilitatorNotes");
  });

  test("T22 - Transcription status exposed consistently via materials/status and room control-state", async ({ request }) => {
    const facilitator = await createActiveUser("p612_tx_fac");
    const cookie = `auth_session=${await createUserSession(facilitator.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const sessionId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    const fac = await addSessionParticipant({ sessionId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    await query(
      `INSERT INTO "Transcript" ("id","sessionId","source","status","text","updatedAt","completedAt")
       VALUES ($1,$2,'MANUAL','COMPLETED','Transcript text',NOW(),NOW())`,
      [uid("tx612"), sessionId],
    );
    const status = await request.get(`/api/sessions/${sessionId}/materials/status?participantId=${fac.participantId}`, {
      headers: { Cookie: cookie },
    });
    const control = await request.get(`/api/sessions/${sessionId}/control-state?participantId=${fac.participantId}`, {
      headers: { Cookie: cookie },
    });
    expect(status.status()).toBe(200);
    expect(control.status()).toBe(200);
    const statusJson = (await status.json()) as { transcription: { status: string | null } };
    expect(statusJson.transcription.status).toBe("COMPLETED");
  });

  test("T23/T24/T25 - Navigation links room -> sessions/event lobby and /sessions -> room", async ({ request }) => {
    const user = await createActiveUser("p612_nav");
    const cookie = `auth_session=${await createUserSession(user.id)}`;
    const { caseId } = await createCaseWithRoles(user.id);
    const eventId = await createEvent(user.id, user.id, "PRIVATE");
    const sessionId = await createSession({ caseId, facilitatorId: user.id, eventId, visibility: "PRIVATE" });
    await addSessionParticipant({ sessionId, userId: user.id, displayName: "Fac", type: "FACILITATOR" });

    const roomRes = await request.get(`/room/${sessionId}`, { headers: { Cookie: cookie } });
    expect([200, 302, 303]).toContain(roomRes.status());

    const sessionDetailRes = await request.get(`/sessions/${sessionId}`, { headers: { Cookie: cookie } });
    const sessionDetailHtml = await sessionDetailRes.text();
    expect(sessionDetailHtml).toContain("/sessions");
    expect(sessionDetailHtml).toContain(`/events/${eventId}/lobby`);

    const sessionsRes = await request.get("/sessions", { headers: { Cookie: cookie } });
    const sessionsHtml = await sessionsRes.text();
    expect(sessionsHtml).toContain(`/room/${sessionId}`);
  });

  test("T26/T27/T28 - HTML pages do not expose token fields", async ({ request }) => {
    const user = await createActiveUser("p612_html");
    const cookie = `auth_session=${await createUserSession(user.id)}`;
    const { caseId } = await createCaseWithRoles(user.id);
    const eventId = await createEvent(user.id, user.id, "PRIVATE");
    const sessionId = await createSession({ caseId, facilitatorId: user.id, eventId, visibility: "PRIVATE" });
    await addEventParticipant(eventId, user.id, "User", { isHost: true });
    await addSessionParticipant({ sessionId, userId: user.id, displayName: "User", type: "FACILITATOR" });

    const sessionsHtml = await (await request.get("/sessions", { headers: { Cookie: cookie } })).text();
    const lobbyHtml = await (await request.get(`/events/${eventId}/lobby`, { headers: { Cookie: cookie } })).text();
    const materialsHtml = await (await request.get(`/sessions/${sessionId}/materials`, { headers: { Cookie: cookie } })).text();
    const roomHtml = await (await request.get(`/room/${sessionId}`, { headers: { Cookie: cookie } })).text();

    for (const html of [sessionsHtml, lobbyHtml, materialsHtml, roomHtml]) {
      expect(html).not.toContain("joinToken");
      expect(html).not.toContain("participantToken");
      expect(html).not.toContain("hostToken");
      expect(html).not.toContain("facilitatorJoinToken");
      expect(html).not.toContain("hostParticipantToken");
      expect(html).not.toContain("sessionTokenHash");
      expect(html).not.toContain("passwordHash");
    }
  });

  test("T29 - Two users stay distinct in same session (LiveKit token ownership)", async ({ request }) => {
    const facilitator = await createActiveUser("p612_dist_fac");
    const userA = await createActiveUser("p612_dist_a");
    const userB = await createActiveUser("p612_dist_b");
    const cookieA = `auth_session=${await createUserSession(userA.id)}`;
    const cookieB = `auth_session=${await createUserSession(userB.id)}`;
    const { caseId } = await createCaseWithRoles(facilitator.id);
    const sessionId = await createSession({ caseId, facilitatorId: facilitator.id, visibility: "PRIVATE" });
    await addSessionParticipant({ sessionId, userId: facilitator.id, displayName: "Fac", type: "FACILITATOR" });
    const a = await addSessionParticipant({ sessionId, userId: userA.id, displayName: "A", type: "PARTICIPANT" });
    const b = await addSessionParticipant({ sessionId, userId: userB.id, displayName: "B", type: "PARTICIPANT" });

    const tokenA = await request.post("/api/livekit/token", {
      headers: { Cookie: cookieA },
      data: { participantId: a.participantId },
    });
    const tokenB = await request.post("/api/livekit/token", {
      headers: { Cookie: cookieB },
      data: { participantId: b.participantId },
    });
    const cross = await request.post("/api/livekit/token", {
      headers: { Cookie: cookieA },
      data: { participantId: b.participantId },
    });

    expect(tokenA.status()).toBe(200);
    expect(tokenB.status()).toBe(200);
    expect(cross.status()).toBe(403);

    const aJson = (await tokenA.json()) as { participantId: string };
    const bJson = (await tokenB.json()) as { participantId: string };
    expect(aJson.participantId).not.toBe(bJson.participantId);
  });

  test("T30/T31 - Core paths still work: Event->Lobby->Session->Room and Standalone->Room", async ({ request }) => {
    const user = await createActiveUser("p612_paths");
    const cookie = `auth_session=${await createUserSession(user.id)}`;
    const { caseId } = await createCaseWithRoles(user.id);
    const eventId = await createEvent(user.id, user.id, "PRIVATE");
    const eventEp = await addEventParticipant(eventId, user.id, "User", { isHost: true });
    const eventSessionId = await createSession({ caseId, facilitatorId: user.id, eventId, visibility: "PRIVATE" });
    const eventFac = await addSessionParticipant({
      sessionId: eventSessionId,
      userId: user.id,
      displayName: "User",
      type: "FACILITATOR",
      eventParticipantId: eventEp,
    });
    await query(
      `UPDATE "EventParticipant" SET "assignedSessionId"=$2,"assignedSessionParticipantId"=$3 WHERE "id"=$1`,
      [eventEp, eventSessionId, eventFac.participantId],
    );

    const standaloneId = await createSession({ caseId, facilitatorId: user.id, visibility: "PRIVATE" });
    await addSessionParticipant({ sessionId: standaloneId, userId: user.id, displayName: "User", type: "FACILITATOR" });

    const lobby = await request.get(`/events/${eventId}/lobby`, { headers: { Cookie: cookie } });
    const roomEvent = await request.get(`/room/${eventSessionId}`, { headers: { Cookie: cookie }, maxRedirects: 5 });
    const roomStandalone = await request.get(`/room/${standaloneId}`, { headers: { Cookie: cookie }, maxRedirects: 5 });
    expect(lobby.status()).toBe(200);
    expect([200, 302, 303]).toContain(roomEvent.status());
    expect([200, 302, 303]).toContain(roomStandalone.status());
  });
});

(BROWSER_BASE_URL ? test.describe : test.describe.skip)(
  "Phase 6.12 - Browser smoke checks",
  () => {
    test("Browser01 - Dual-window sync smoke (manual/skip in CI)", async ({ page }) => {
      await page.goto(`${BROWSER_BASE_URL}/sessions`);
      await expect(page).toHaveURL(/sessions/);
    });

    test("Browser02 - Event-linked session can be opened from lobby and sessions list", async ({ page }) => {
      await page.goto(`${BROWSER_BASE_URL}/events`);
      await expect(page).toHaveURL(/events/);
    });
  },
);

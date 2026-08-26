import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createSession } from "@/app/actions/sessions";
import { createSessionFromEvent } from "@/lib/create-event-session";
import { buildAccountSessionRoomPath } from "@/lib/config";

test("ST-01 Standalone create redirects to /sessions/{id}", () => {
  const compiled = createSession.toString();
  const source = readFileSync(
    join(process.cwd(), "app/actions/sessions.ts"),
    "utf8",
  );
  const createFn = source.slice(
    source.indexOf("export async function createSession"),
    source.indexOf("export async function", source.indexOf("export async function createSession") + 1),
  );

  assert.equal(compiled.includes("`/sessions/${session.id}`"), true);
  assert.equal(compiled.includes("redirect"), true);
  assert.equal(createFn.includes("redirect(`/sessions/${session.id}`)"), true);
});

test("ST-02 Standalone create does not redirect to /room/{id}", () => {
  const compiled = createSession.toString();
  const source = readFileSync(
    join(process.cwd(), "app/actions/sessions.ts"),
    "utf8",
  );
  const createFn = source.slice(
    source.indexOf("export async function createSession"),
    source.indexOf("export async function", source.indexOf("export async function createSession") + 1),
  );

  assert.equal(compiled.includes("`/room/"), false);
  assert.equal(createFn.includes("redirect(`/room/"), false);
  assert.equal(createFn.includes('redirect("/room/'), false);
});

test("ST-04 management page keeps an explicit /room/{id} entry control", () => {
  const detailView = readFileSync(
    join(process.cwd(), "components/session-detail-view.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "app/(app)/sessions/[id]/page.tsx"),
    "utf8",
  );

  assert.equal(buildAccountSessionRoomPath("session-real-1"), "/room/session-real-1");
  assert.equal(detailView.includes("buildAccountSessionRoomPath(session.id)"), true);
  assert.equal(detailView.includes('data-testid="open-session-room-button"'), true);
  assert.equal(page.includes("canManageSession"), true);
  assert.equal(page.includes("requireActiveUser"), true);
});

test("EV-01 Event Session create stays in the Event host/lobby JSON flow", () => {
  const hostRoute = readFileSync(
    join(process.cwd(), "app/api/events/[id]/host/route.ts"),
    "utf8",
  );
  const createSource = createSessionFromEvent.toString();

  assert.equal(createSource.includes("redirect("), false);
  assert.equal(createSource.includes("/sessions/"), false);
  assert.equal(hostRoute.includes("createSessionFromEvent"), true);
  assert.equal(hostRoute.includes("return NextResponse.json({"), true);
  assert.equal(hostRoute.includes("redirect(`/sessions/"), false);
  assert.equal(hostRoute.includes("redirect(`/room/"), false);
});

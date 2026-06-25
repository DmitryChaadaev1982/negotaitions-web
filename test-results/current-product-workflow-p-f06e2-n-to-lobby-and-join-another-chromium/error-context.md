# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: current-product-workflow.spec.ts >> participant can finish one session, return to lobby, and join another
- Location: tests\e2e\current-product-workflow.spec.ts:148:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('session-finished-message')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('session-finished-message')

```

```yaml
- banner:
  - paragraph: E2E Sequential Participant Event — E2E Case A — Scope Change
  - paragraph: Igor · Participant
  - text: Debrief
  - link "Rejoin":
    - /url: /rejoin
  - group "Interface language":
    - button "ru"
    - button "en" [pressed]
  - button "Leave room"
- paragraph: Could not reconnect automatically.
- button "Rejoin room"
- region "Negotiation table":
  - text: Igor Client CFO Waiting to join...
  - img
  - img
  - img
  - paragraph
  - text: Participant
  - paragraph: Negotiation
  - text: 02:00
  - paragraph: Negotiation finished — debrief mode
  - text: Dmitry Facilitator Waiting to join... Alex Vendor Project Director Waiting to join...
- button "Leave"
- heading "Debrief" [level=2]
- paragraph: This session is finished. You can stay in the room for debrief.
- paragraph: Processing status
- text: "Recording: Recording is not available for this session. Transcription: Waiting for recording to become available. AI analysis: Waiting for transcript."
- paragraph: Actions
- link "Open Session materials":
  - /url: /join/hYzmfFR5-vkgF2l6pMvoH
- link "Return to Event lobby":
  - /url: /events/event_1782325529423_o6x7xsi3/lobby?participantToken=igor-1782325529423-5st1d
- paragraph: AI analysis has not been shared yet.
- alert
```

# Test source

```ts
  89  |   const dmitry = participantByName(participants, "Dmitry");
  90  |   const igor = participantByName(participants, "Igor");
  91  |   const alex = participantByName(participants, "Alex");
  92  |   const serg = participantByName(participants, "Serg");
  93  |   const olga = participantByName(participants, "Olga");
  94  |   const ivan = participantByName(participants, "Ivan");
  95  | 
  96  |   const session1Response = await createSessionFromEvent(request, {
  97  |     eventId: event.id,
  98  |     hostToken: event.hostToken,
  99  |     caseId: caseA.id,
  100 |     roomLabel: "Room A",
  101 |     facilitatorEventParticipantId: dmitry.id,
  102 |     roleAssignments: [
  103 |       { caseRoleId: caseA.roles[0]!.id, eventParticipantId: igor.id },
  104 |       { caseRoleId: caseA.roles[1]!.id, eventParticipantId: alex.id },
  105 |     ],
  106 |   });
  107 |   expect(session1Response.ok()).toBeTruthy();
  108 |   const session1 = (await session1Response.json()) as { session: { id: string } };
  109 |   await finishSession(request, session1.session.id);
  110 | 
  111 |   const session2Response = await createSessionFromEvent(request, {
  112 |     eventId: event.id,
  113 |     hostToken: event.hostToken,
  114 |     caseId: caseB.id,
  115 |     roomLabel: "Room B",
  116 |     facilitatorEventParticipantId: serg.id,
  117 |     roleAssignments: [
  118 |       { caseRoleId: caseB.roles[0]!.id, eventParticipantId: olga.id },
  119 |       { caseRoleId: caseB.roles[1]!.id, eventParticipantId: ivan.id },
  120 |     ],
  121 |   });
  122 |   expect(session2Response.ok()).toBeTruthy();
  123 | 
  124 |   await page.setViewportSize({ width: 1366, height: 768 });
  125 |   await page.goto("/events");
  126 |   await expect(page.getByTestId("events-page")).toBeVisible();
  127 | 
  128 |   const row = page.getByTestId("event-row").filter({ hasText: event.title });
  129 |   await expect(row.getByTestId("event-total-sessions").first()).toContainText("2");
  130 |   await expect(row.getByTestId("event-active-sessions").first()).toContainText("1");
  131 |   await expect(row.getByTestId("event-finished-sessions").first()).toContainText("1");
  132 |   await expect(row.getByTestId("open-event-lobby-button").first()).toBeVisible();
  133 |   await expect(row.getByTestId("view-event-sessions-button").first()).toBeVisible();
  134 | 
  135 |   const overflow = await page.evaluate(() => ({
  136 |     scrollWidth: document.documentElement.scrollWidth,
  137 |     clientWidth: document.documentElement.clientWidth,
  138 |   }));
  139 |   expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  140 | 
  141 |   await page.goto("/dashboard");
  142 |   const dashboardEvent = page.getByTestId("event-card").filter({ hasText: event.title });
  143 |   await expect(dashboardEvent.getByTestId("event-total-sessions")).toContainText("2");
  144 |   await expect(dashboardEvent.getByTestId("event-active-sessions")).toContainText("1");
  145 |   await expect(dashboardEvent.getByTestId("event-finished-sessions")).toContainText("1");
  146 | });
  147 | 
  148 | test("participant can finish one session, return to lobby, and join another", async ({
  149 |   page,
  150 |   request,
  151 | }) => {
  152 |   const negotiationCase = await createTestCase();
  153 |   const event = await createTestEvent({
  154 |     withParticipants: true,
  155 |     title: "E2E Sequential Participant Event",
  156 |   });
  157 |   const participants = await getEventParticipants(event.id);
  158 |   const dmitry = participantByName(participants, "Dmitry");
  159 |   const maria = participantByName(participants, "Igor");
  160 |   const alex = participantByName(participants, "Alex");
  161 |   const [roleA, roleB] = negotiationCase.roles;
  162 | 
  163 |   const session1Response = await createSessionFromEvent(request, {
  164 |     eventId: event.id,
  165 |     hostToken: event.hostToken,
  166 |     caseId: negotiationCase.id,
  167 |     roomLabel: "Room A",
  168 |     facilitatorEventParticipantId: dmitry.id,
  169 |     roleAssignments: [
  170 |       { caseRoleId: roleA!.id, eventParticipantId: maria.id },
  171 |       { caseRoleId: roleB!.id, eventParticipantId: alex.id },
  172 |     ],
  173 |   });
  174 |   expect(session1Response.ok()).toBeTruthy();
  175 |   const session1Body = (await session1Response.json()) as { session: { id: string } };
  176 |   const session1 = await getSession(session1Body.session.id);
  177 |   const mariaSession1 = participantByName(session1.participants, "Igor");
  178 | 
  179 |   await page.goto(`/events/${event.id}/lobby?participantToken=${maria.participantToken}`);
  180 |   await expect(page.getByTestId("assigned-session-card")).toContainText("Room A");
  181 |   await expect(
  182 |     page
  183 |       .getByTestId("assigned-session-card")
  184 |       .getByTestId("go-to-session-room-button"),
  185 |   ).toHaveAttribute("href", new RegExp(`/room/${session1.id}`));
  186 | 
  187 |   await finishSession(request, session1.id);
  188 |   await page.goto(`/room/${session1.id}?joinToken=${mariaSession1.joinToken}`);
> 189 |   await expect(page.getByTestId("session-finished-message")).toBeVisible();
      |                                                              ^ Error: expect(locator).toBeVisible() failed
  190 |   await expect(page.getByTestId("return-to-event-lobby-button")).toBeVisible();
  191 |   await expect(page.getByTestId("open-session-materials-button")).toBeVisible();
  192 | 
  193 |   await page.getByTestId("return-to-event-lobby-button").click();
  194 |   await expect(page.getByTestId("my-sessions-in-event-section")).toContainText("Room A");
  195 | 
  196 |   const session2Response = await createSessionFromEvent(request, {
  197 |     eventId: event.id,
  198 |     hostToken: event.hostToken,
  199 |     caseId: negotiationCase.id,
  200 |     roomLabel: "Room B",
  201 |     facilitatorEventParticipantId: dmitry.id,
  202 |     roleAssignments: [
  203 |       { caseRoleId: roleA!.id, eventParticipantId: maria.id },
  204 |       { caseRoleId: roleB!.id, eventParticipantId: alex.id },
  205 |     ],
  206 |   });
  207 |   expect(session2Response.ok()).toBeTruthy();
  208 |   const session2Body = (await session2Response.json()) as { session: { id: string } };
  209 | 
  210 |   await page.goto(`/events/${event.id}/lobby?participantToken=${maria.participantToken}`);
  211 |   await expect(page.getByTestId("assigned-session-card")).toContainText("Room B");
  212 |   await expect(page.getByTestId("my-sessions-in-event-section")).toContainText("Room A");
  213 |   await expect(page.getByTestId("go-to-session-room-button").first()).toHaveAttribute(
  214 |     "href",
  215 |     new RegExp(`/room/${session2Body.session.id}`),
  216 |   );
  217 | 
  218 |   const rejoinResponse = await request.post("/api/rejoin/validate", {
  219 |     data: {
  220 |       type: "EVENT_LOBBY",
  221 |       eventId: event.id,
  222 |       participantToken: maria.participantToken,
  223 |     },
  224 |   });
  225 |   const rejoin = await rejoinResponse.json();
  226 |   expect(rejoin.valid).toBe(true);
  227 |   expect(rejoin.primaryAction).toBe("room");
  228 |   expect(rejoin.targetUrl).toContain(`/room/${session2Body.session.id}`);
  229 | });
  230 | 
  231 | test("duplicate active assignment is blocked and completed event preserves materials", async ({
  232 |   page,
  233 |   request,
  234 | }) => {
  235 |   const negotiationCase = await createTestCase();
  236 |   const event = await createTestEvent({
  237 |     withParticipants: true,
  238 |     title: "E2E Duplicate Assignment Event",
  239 |   });
  240 |   await joinEventAsParticipant(event.id, "Olga", "FACILITATE");
  241 |   const participants = await getEventParticipants(event.id);
  242 |   const dmitry = participantByName(participants, "Dmitry");
  243 |   const igor = participantByName(participants, "Igor");
  244 |   const alex = participantByName(participants, "Alex");
  245 |   const serg = participantByName(participants, "Serg");
  246 |   const olga = participantByName(participants, "Olga");
  247 |   const [roleA, roleB] = negotiationCase.roles;
  248 | 
  249 |   const session1Response = await createSessionFromEvent(request, {
  250 |     eventId: event.id,
  251 |     hostToken: event.hostToken,
  252 |     caseId: negotiationCase.id,
  253 |     roomLabel: "Room A",
  254 |     facilitatorEventParticipantId: dmitry.id,
  255 |     roleAssignments: [
  256 |       { caseRoleId: roleA!.id, eventParticipantId: igor.id },
  257 |       { caseRoleId: roleB!.id, eventParticipantId: alex.id },
  258 |     ],
  259 |   });
  260 |   expect(session1Response.ok()).toBeTruthy();
  261 |   const session1Body = (await session1Response.json()) as { session: { id: string } };
  262 | 
  263 |   const duplicate = await createSessionFromEvent(request, {
  264 |     eventId: event.id,
  265 |     hostToken: event.hostToken,
  266 |     caseId: negotiationCase.id,
  267 |     roomLabel: "Room B",
  268 |     facilitatorEventParticipantId: olga.id,
  269 |     roleAssignments: [
  270 |       { caseRoleId: roleA!.id, eventParticipantId: igor.id },
  271 |       { caseRoleId: roleB!.id, eventParticipantId: serg.id },
  272 |     ],
  273 |   });
  274 |   expect(duplicate.status()).toBe(400);
  275 |   await expect(duplicate.json()).resolves.toMatchObject({
  276 |     error: "participantAlreadyAssigned",
  277 |   });
  278 | 
  279 |   await request.post(`/api/events/${event.id}/complete`, {
  280 |     data: { hostToken: event.hostToken },
  281 |   });
  282 | 
  283 |   await page.goto("/events");
  284 |   const row = page.getByTestId("event-row").filter({ hasText: event.title });
  285 |   await expect(row.getByTestId("event-status-badge").first()).toContainText(/Completed|Завершена/);
  286 |   await expect(row.getByTestId("open-event-lobby-button")).toHaveCount(0);
  287 |   await expect(row.getByTestId("open-event-results-button").first()).toBeVisible();
  288 | 
  289 |   const session1 = await getSession(session1Body.session.id);
```
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { CurrentUserSessionAccess } from "@/lib/access-control";
import { canManageSession } from "@/lib/access-control";
import {
  computeSessionListCanManage,
  decideAuthorizedMaterialsContinuation,
  decideSessionManagementAuthorization,
  decideSessionMaterialsProjection,
  resolveSessionManagerActorId,
} from "@/lib/session-management-auth";

function sessionAccess(
  overrides: Partial<CurrentUserSessionAccess> = {},
): CurrentUserSessionAccess {
  return {
    session: {
      id: "session-1",
      eventId: null,
      facilitatorId: "facilitator-1",
      deletedAt: null,
      event: null,
    },
    user: {
      id: "user-ordinary",
      email: "ordinary@example.com",
      name: "Ordinary User",
      globalRole: "USER",
      status: "ACTIVE",
      preferredLocale: "en",
      sessionSoundEnabled: true,
    },
    isAdmin: false,
    isEventHostOwner: false,
    isEventFacilitatorOwner: false,
    isSessionFacilitatorOwner: false,
    tokenParticipant: null,
    userParticipant: null,
    hasEmailInvite: false,
    ...overrides,
  };
}

function participant(type: "FACILITATOR" | "PARTICIPANT" | "OBSERVER") {
  return {
    type,
    userId: "user-ordinary",
  } as CurrentUserSessionAccess["userParticipant"];
}

test("AUTH-01 ADMIN who is not facilitator can manage session materials", () => {
  const access = sessionAccess({
    isAdmin: true,
    user: {
      ...sessionAccess().user!,
      id: "admin-1",
      email: "admin@example.com",
      globalRole: "ADMIN",
    },
  });
  assert.equal(canManageSession(access), true);
  assert.equal(
    decideSessionManagementAuthorization({
      hasAuthenticatedUser: true,
      hasJoinToken: false,
      access,
      resolvedParticipantType: null,
    }).allowed,
    true,
  );
  assert.equal(
    decideSessionMaterialsProjection({
      canManage: true,
      participantType: null,
    }).isManagerProjection,
    true,
  );
});

test("AUTH-02 ADMIN who is not facilitator can access recording/transcription state", () => {
  const projection = decideSessionMaterialsProjection({
    canManage: true,
    participantType: "OBSERVER",
  });
  assert.equal(projection.canManage, true);
  assert.equal(projection.isManagerProjection, true);
  assert.equal(projection.viewerType, "FACILITATOR");
});

test("AUTH-03 ADMIN can invoke retranscription/enhancement management", () => {
  const decision = decideSessionManagementAuthorization({
    hasAuthenticatedUser: true,
    hasJoinToken: false,
    access: sessionAccess({ isAdmin: true }),
    resolvedParticipantType: "PARTICIPANT",
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "ok");
});

test("AUTH-04 ordinary non-facilitator receives server-side forbidden", () => {
  const decision = decideSessionManagementAuthorization({
    hasAuthenticatedUser: true,
    hasJoinToken: false,
    access: sessionAccess({
      userParticipant: participant("PARTICIPANT"),
    }),
    resolvedParticipantType: "PARTICIPANT",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 403);
  assert.equal(decision.reason, "forbidden");
});

test("AUTH-05 ordinary non-facilitator does not see Управление", () => {
  assert.equal(
    computeSessionListCanManage({
      isAdmin: false,
      userId: "user-ordinary",
      facilitatorId: "facilitator-1",
      eventHostUserId: null,
      eventFacilitatorUserId: null,
      participantType: "PARTICIPANT",
    }),
    false,
  );
});

test("AUTH-06 facilitator retains existing management authority", () => {
  const access = sessionAccess({
    isSessionFacilitatorOwner: true,
    userParticipant: participant("FACILITATOR"),
  });
  assert.equal(canManageSession(access), true);
  assert.equal(
    decideSessionManagementAuthorization({
      hasAuthenticatedUser: true,
      hasJoinToken: false,
      access,
      resolvedParticipantType: "FACILITATOR",
    }).allowed,
    true,
  );
  assert.equal(
    computeSessionListCanManage({
      isAdmin: false,
      userId: "facilitator-1",
      facilitatorId: "facilitator-1",
      eventHostUserId: null,
      eventFacilitatorUserId: null,
      participantType: "FACILITATOR",
    }),
    true,
  );
});

test("AUTH-07 ADMIN sees Управление on a session they do not facilitate", () => {
  assert.equal(
    computeSessionListCanManage({
      isAdmin: true,
      userId: "admin-1",
      facilitatorId: "facilitator-1",
      eventHostUserId: null,
      eventFacilitatorUserId: null,
      participantType: null,
    }),
    true,
  );
});

test("AUTH-08 participant and observer do not gain management authority", () => {
  for (const type of ["PARTICIPANT", "OBSERVER"] as const) {
    assert.equal(
      canManageSession(
        sessionAccess({
          userParticipant: participant(type),
        }),
      ),
      false,
    );
    assert.equal(
      computeSessionListCanManage({
        isAdmin: false,
        userId: "user-ordinary",
        facilitatorId: "facilitator-1",
        eventHostUserId: null,
        eventFacilitatorUserId: null,
        participantType: type,
      }),
      false,
    );
  }
});

test("AUTH-09 owner who is not facilitator/admin does not gain management", () => {
  const caseOwnerOnly = sessionAccess({
    user: {
      ...sessionAccess().user!,
      id: "case-owner-1",
    },
  });
  assert.equal(canManageSession(caseOwnerOnly), false);
  assert.equal(
    computeSessionListCanManage({
      isAdmin: false,
      userId: "case-owner-1",
      facilitatorId: "facilitator-1",
      eventHostUserId: null,
      eventFacilitatorUserId: null,
      participantType: null,
    }),
    false,
  );
});

test("AUTH-10 UI and server policy agree for representative roles", () => {
  const cases = [
    {
      access: sessionAccess({ isAdmin: true }),
      list: {
        isAdmin: true,
        userId: "admin-1",
        facilitatorId: "facilitator-1",
        eventHostUserId: null,
        eventFacilitatorUserId: null,
        participantType: null,
      },
      expected: true,
    },
    {
      access: sessionAccess({ isSessionFacilitatorOwner: true }),
      list: {
        isAdmin: false,
        userId: "facilitator-1",
        facilitatorId: "facilitator-1",
        eventHostUserId: null,
        eventFacilitatorUserId: null,
        participantType: null,
      },
      expected: true,
    },
    {
      access: sessionAccess({ isEventHostOwner: true }),
      list: {
        isAdmin: false,
        userId: "host-1",
        facilitatorId: "facilitator-1",
        eventHostUserId: "host-1",
        eventFacilitatorUserId: null,
        participantType: null,
      },
      expected: true,
    },
    {
      access: sessionAccess({
        userParticipant: participant("PARTICIPANT"),
      }),
      list: {
        isAdmin: false,
        userId: "user-ordinary",
        facilitatorId: "facilitator-1",
        eventHostUserId: null,
        eventFacilitatorUserId: null,
        participantType: "PARTICIPANT",
      },
      expected: false,
    },
  ] as const;

  for (const item of cases) {
    assert.equal(canManageSession(item.access), item.expected);
    assert.equal(computeSessionListCanManage(item.list), item.expected);
  }

  const listView = readFileSync(
    join(process.cwd(), "components/sessions-list-view.tsx"),
    "utf8",
  );
  assert.match(listView, /session\.canManage \?/);
  assert.match(listView, /data-testid="manage-session-button"/);
});

test("management routes use the shared canManageSession helper", () => {
  const files = [
    "app/api/sessions/[sessionId]/materials/status/route.ts",
    "app/api/sessions/[sessionId]/materials/transcribe/route.ts",
    "app/api/sessions/[sessionId]/materials/retranscribe/route.ts",
    "app/api/sessions/[sessionId]/materials/enhance-transcript/route.ts",
    "app/api/sessions/[sessionId]/materials/continue-transcript/route.ts",
    "app/api/sessions/[sessionId]/transcript/route.ts",
    "app/api/sessions/[sessionId]/speaker-mapping/route.ts",
    "app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts",
    "app/api/sessions/[sessionId]/recording/route.ts",
    "app/api/sessions/[sessionId]/analyze/route.ts",
    "app/api/sessions/[sessionId]/ai-analysis/share/route.ts",
    "app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(
      source,
      /authorizeSessionManagementAccess|authorizeSessionMaterialsAccess/,
      file,
    );
    assert.doesNotMatch(
      source,
      /participant\.type !== ParticipantType\.FACILITATOR/,
      file,
    );
  }
});

test("AUTH-FINAL-01 ADMIN without SessionParticipant can access materials/status", () => {
  const continuation = decideAuthorizedMaterialsContinuation({
    canManage: true,
    participantPresent: false,
  });
  assert.equal(continuation.allowed, true);
  assert.equal(continuation.status, 200);

  const statusRoute = readFileSync(
    join(process.cwd(), "app/api/sessions/[sessionId]/materials/status/route.ts"),
    "utf8",
  );
  assert.match(statusRoute, /decideAuthorizedMaterialsContinuation/);
  assert.doesNotMatch(
    statusRoute,
    /if \(!participant\) \{\s*return NextResponse\.json\(\{ error: "Forbidden\." \}/,
  );
});

test("AUTH-FINAL-02 ADMIN management read path needs no synthetic participant", () => {
  const actorId = resolveSessionManagerActorId({
    participantId: null,
    userId: "admin-1",
    fallbackDisplayName: "Admin",
  });
  assert.equal(actorId, "admin-1");
  assert.equal(
    decideSessionMaterialsProjection({
      canManage: true,
      participantType: null,
    }).isManagerProjection,
    true,
  );
});

test("AUTH-FINAL-03 ordinary unrelated user without SessionParticipant remains 403", () => {
  const decision = decideSessionManagementAuthorization({
    hasAuthenticatedUser: true,
    hasJoinToken: false,
    access: sessionAccess(),
    resolvedParticipantType: null,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 403);
  assert.equal(
    decideAuthorizedMaterialsContinuation({
      canManage: false,
      participantPresent: false,
    }).allowed,
    false,
  );
});

test("AUTH-FINAL-04 ordinary participant who is not facilitator remains non-manager", () => {
  assert.equal(
    canManageSession(
      sessionAccess({
        userParticipant: participant("PARTICIPANT"),
      }),
    ),
    false,
  );
  assert.equal(
    decideAuthorizedMaterialsContinuation({
      canManage: false,
      participantPresent: true,
    }).allowed,
    true,
  );
});

test("AUTH-FINAL-05 facilitator behavior unchanged", () => {
  const access = sessionAccess({
    isSessionFacilitatorOwner: true,
    userParticipant: participant("FACILITATOR"),
  });
  assert.equal(canManageSession(access), true);
  assert.equal(
    decideAuthorizedMaterialsContinuation({
      canManage: true,
      participantPresent: true,
    }).allowed,
    true,
  );
});

test("AUTH-FINAL-06 no participant row is inserted as a side effect", () => {
  const files = [
    "lib/session-management-auth.ts",
    "app/api/sessions/[sessionId]/materials/status/route.ts",
    "app/api/sessions/[sessionId]/analyze/route.ts",
    "app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /sessionParticipant\.create/, file);
    assert.doesNotMatch(source, /participants:\s*\{\s*create/, file);
  }
});

test("AUTH-FINAL-07 same hidden participant-gate is gone from touched management routes", () => {
  const files = [
    "app/api/sessions/[sessionId]/analyze/route.ts",
    "app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(source, /resolveSessionManagerActorId/, file);
    assert.doesNotMatch(
      source,
      /if \(!participant\) \{\s*return NextResponse\.json\(\{ error: "Forbidden\." \}/,
      file,
    );
    assert.doesNotMatch(
      source,
      /if \(!facilitator\) \{\s*return NextResponse\.json\(\{ error: "Forbidden\." \}/,
      file,
    );
  }
});

test("AUTH-FINAL-08 UI Управление semantics remain unchanged", () => {
  assert.equal(
    computeSessionListCanManage({
      isAdmin: true,
      userId: "admin-1",
      facilitatorId: "facilitator-1",
      eventHostUserId: null,
      eventFacilitatorUserId: null,
      participantType: null,
    }),
    true,
  );
  assert.equal(
    computeSessionListCanManage({
      isAdmin: false,
      userId: "user-ordinary",
      facilitatorId: "facilitator-1",
      eventHostUserId: null,
      eventFacilitatorUserId: null,
      participantType: "PARTICIPANT",
    }),
    false,
  );
});

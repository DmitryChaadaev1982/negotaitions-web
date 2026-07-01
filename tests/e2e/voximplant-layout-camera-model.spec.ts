import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";

import type { SessionRosterEntry } from "../../lib/room-sidebar-types";
import {
  buildCameraEnablePlan,
  isDuplicateVideoStreamError,
} from "../../lib/voximplant/camera-toggle-logic";
import {
  resolveRemoteMicStateByPolicy,
  resolveConnectionState,
  resolveRosterVisualRoles,
  shouldShowDiagnosticsSection,
} from "../../lib/voximplant/room-layout-model";

function rosterEntry(overrides: Partial<SessionRosterEntry>): SessionRosterEntry {
  return {
    id: overrides.id ?? `p-${Math.random().toString(36).slice(2, 8)}`,
    displayName: overrides.displayName ?? "User",
    participantType: overrides.participantType ?? "OBSERVER",
    caseRoleName: overrides.caseRoleName ?? null,
    userId: overrides.userId ?? null,
    voximplantProviderUsername: overrides.voximplantProviderUsername ?? null,
    joinedAt: overrides.joinedAt ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
    sessionRoleId: overrides.sessionRoleId ?? null,
  };
}

test.describe("Vox roster-first layout model", () => {
  test("keeps participant identity when stream is missing", () => {
    const roster = [
      rosterEntry({ id: "fac", displayName: "Fac", participantType: "FACILITATOR" }),
      rosterEntry({
        id: "pa",
        displayName: "Buyer",
        participantType: "PARTICIPANT",
        caseRoleName: "Participant A",
        sessionRoleId: "role-a",
      }),
      rosterEntry({
        id: "pb",
        displayName: "Seller",
        participantType: "PARTICIPANT",
        caseRoleName: "Participant B",
        sessionRoleId: "role-b",
      }),
    ];

    const zones = resolveRosterVisualRoles(roster);
    expect(zones.get("fac")?.zone).toBe("facilitator");
    expect(zones.get("pa")?.zone).toBe("participant_a");
    expect(zones.get("pb")?.zone).toBe("participant_b");

    const participantNoStreamState = resolveConnectionState({
      hasVideoStream: false,
      isLocal: false,
      isCameraOn: false,
      lastSeenAt: new Date().toISOString(),
    });
    expect(participantNoStreamState).toBe("camera_off");
  });

  test("observer zone includes empty and unassigned users", () => {
    const roster = [
      rosterEntry({
        id: "unassigned",
        displayName: "Unassigned Participant",
        participantType: "PARTICIPANT",
        caseRoleName: null,
        sessionRoleId: null,
      }),
      rosterEntry({
        id: "observer",
        displayName: "Observer",
        participantType: "OBSERVER",
      }),
    ];

    const zones = resolveRosterVisualRoles(roster);
    expect(zones.get("unassigned")?.zone).toBe("observer");
    expect(zones.get("unassigned")?.roleLabel).toContain("unassigned");
    expect(zones.get("observer")?.zone).toBe("observer");
  });

  test("observer section is rendered even when empty", () => {
    const source = readFileSync(
      "components/voximplant-video-layout.tsx",
      "utf-8",
    );
    expect(source).toContain("testId=\"vox-zone-observers\"");
    expect(source).toContain("vox-observers-empty-state");
    expect(source).toContain("Наблюдатели пока не подключены");
    expect(source).toContain("justify-center");
  });

  test("diagnostics section is hidden when no unknown endpoints and debug is off", () => {
    expect(
      shouldShowDiagnosticsSection({
        unknownRosterCount: 0,
        unknownEndpointCount: 0,
        debugEnabled: false,
      }),
    ).toBe(false);
  });

  test("diagnostics section is visible when unknown endpoints are present", () => {
    expect(
      shouldShowDiagnosticsSection({
        unknownRosterCount: 0,
        unknownEndpointCount: 1,
        debugEnabled: false,
      }),
    ).toBe(true);
  });

  test("diagnostics section is visible in explicit debug mode", () => {
    expect(
      shouldShowDiagnosticsSection({
        unknownRosterCount: 0,
        unknownEndpointCount: 0,
        debugEnabled: true,
      }),
    ).toBe(true);
  });

  test("role reassignment recomputes zones without reload", () => {
    const initialRoster = [
      rosterEntry({
        id: "p1",
        displayName: "User 1",
        participantType: "PARTICIPANT",
        sessionRoleId: null,
      }),
      rosterEntry({
        id: "p2",
        displayName: "User 2",
        participantType: "PARTICIPANT",
        sessionRoleId: null,
      }),
    ];

    const initialZones = resolveRosterVisualRoles(initialRoster);
    expect(initialZones.get("p1")?.zone).toBe("observer");
    expect(initialZones.get("p2")?.zone).toBe("observer");

    const reassignedRoster = [
      rosterEntry({
        id: "p1",
        displayName: "User 1",
        participantType: "PARTICIPANT",
        sessionRoleId: "role-a",
        caseRoleName: "Participant A",
      }),
      rosterEntry({
        id: "p2",
        displayName: "User 2",
        participantType: "PARTICIPANT",
        sessionRoleId: "role-b",
        caseRoleName: "Participant B",
      }),
    ];
    const nextZones = resolveRosterVisualRoles(reassignedRoster);
    expect(nextZones.get("p1")?.zone).toBe("participant_a");
    expect(nextZones.get("p2")?.zone).toBe("participant_b");
  });

  test("unmapped role never resolves as facilitator", () => {
    const roster = [
      rosterEntry({
        id: "p1",
        displayName: "Unknown Role",
        participantType: "PARTICIPANT",
        caseRoleName: "Third party advisor",
        sessionRoleId: "role-3",
      }),
      rosterEntry({
        id: "p2",
        displayName: "Another Unknown Role",
        participantType: "PARTICIPANT",
        caseRoleName: "Legal counsel",
        sessionRoleId: "role-4",
      }),
      rosterEntry({
        id: "p3",
        displayName: "Third Unknown Role",
        participantType: "PARTICIPANT",
        caseRoleName: "Mediator",
        sessionRoleId: "role-5",
      }),
    ];
    const zones = resolveRosterVisualRoles(roster);
    const resolvedZones = [...zones.values()].map((item) => item.zone);
    expect(zones.get("p1")?.zone).not.toBe("facilitator");
    expect(zones.get("p2")?.zone).not.toBe("facilitator");
    expect(zones.get("p3")?.zone).not.toBe("facilitator");
    expect(resolvedZones.includes("unknown")).toBe(true);
  });

  test("remote mic state follows room policy fallback", () => {
    expect(
      resolveRemoteMicStateByPolicy({
        negotiationState: "RUNNING",
        participantType: "PARTICIPANT",
      }),
    ).toBe("on");
    expect(
      resolveRemoteMicStateByPolicy({
        negotiationState: "RUNNING",
        participantType: "FACILITATOR",
      }),
    ).toBe("system_muted");
    expect(
      resolveRemoteMicStateByPolicy({
        negotiationState: "PAUSED",
        participantType: "OBSERVER",
      }),
    ).toBe("system_muted");
  });

  test("PREPARATION policy fallback does not keep system mute", () => {
    expect(
      resolveRemoteMicStateByPolicy({
        negotiationState: "PREPARATION",
        participantType: "FACILITATOR",
      }),
    ).toBe("on");
    expect(
      resolveRemoteMicStateByPolicy({
        negotiationState: "PREPARATION",
        participantType: "PARTICIPANT",
      }),
    ).toBe("on");
    expect(
      resolveRemoteMicStateByPolicy({
        negotiationState: "PREPARATION",
        participantType: "OBSERVER",
      }),
    ).toBe("on");
  });
});

test.describe("Vox camera toggle idempotency helpers", () => {
  test("second camera enable reuses existing stream without addStream", () => {
    const plan = buildCameraEnablePlan({
      hasLocalVideoStream: true,
      hasReusableTrack: true,
      videoStreamAlreadyAdded: true,
    });
    expect(plan.shouldReuseExistingTrack).toBe(true);
    expect(plan.shouldCreateVideoStream).toBe(false);
    expect(plan.shouldAddStreamToConference).toBe(false);
  });

  test("duplicate video stream error is treated as recoverable", () => {
    expect(
      isDuplicateVideoStreamError("Stream with type video already exists for endpoint"),
    ).toBe(true);
    expect(isDuplicateVideoStreamError("Permission denied for camera device")).toBe(false);
  });

  test("control bar exposes explicit state labels for accessibility", () => {
    const source = readFileSync(
      "components/voximplant-negotiation-room-page.tsx",
      "utf-8",
    );
    expect(source).toContain("Микрофон включён");
    expect(source).toContain("Микрофон выключен");
    expect(source).toContain("Камера включена");
    expect(source).toContain("Камера выключена");
    expect(source).toContain("Микрофон заблокирован правилами сессии");
    expect(source).toContain("data-state={micState}");
    expect(source).toContain("data-state={cameraState}");
  });

  test("active speaker highlight is not assigned to arbitrary remote tiles", () => {
    const source = readFileSync(
      "components/voximplant-video-layout.tsx",
      "utf-8",
    );
    expect(source).toContain("isSpeaking={tile.isLocal ? isSpeaking : false}");
  });
});

import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";

import type { SessionRosterEntry } from "../../lib/room-sidebar-types";
import {
  buildCameraEnablePlan,
  isDuplicateVideoStreamError,
} from "../../lib/voximplant/camera-toggle-logic";
import {
  getObserverRosterPriorityBucket,
  orderObserverRosterItems,
  resolveRemoteMicStateByPolicy,
  resolveConnectionState,
  resolveRosterVisualRoles,
  shouldShowDiagnosticsSection,
  shouldRenderObserverRailTile,
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
    micEnabled: overrides.micEnabled ?? null,
    cameraEnabled: overrides.cameraEnabled ?? null,
    isLogicallyPresent: overrides.isLogicallyPresent ?? null,
    logicalDisconnectReason: overrides.logicalDisconnectReason ?? null,
    logicalConnectionId: overrides.logicalConnectionId ?? null,
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
    expect(source).toContain("t(\"room.observersNotConnected\")");
    expect(source).toContain("data-testid=\"vox-observer-row\"");
    expect(source).toContain("overflow-x-auto");
    expect(source).not.toContain("flex-wrap");
  });

  test("observer priority bucket is neutral for media state", () => {
    expect(
      getObserverRosterPriorityBucket({
        stableRosterIndex: 0,
        cameraEnabled: true,
        connected: false,
        disconnected: false,
      }),
    ).toBe(0);
    expect(
      getObserverRosterPriorityBucket({
        stableRosterIndex: 0,
        cameraEnabled: false,
        connected: true,
        disconnected: false,
      }),
    ).toBe(0);
    expect(
      getObserverRosterPriorityBucket({
        stableRosterIndex: 0,
        cameraEnabled: false,
        connected: false,
        disconnected: true,
      }),
    ).toBe(0);
  });

  test("observer ordering remains stable roster order across media state", () => {
    const ordered = orderObserverRosterItems([
      {
        id: "first-disconnected",
        stableRosterIndex: 0,
        cameraEnabled: false,
        connected: false,
        disconnected: true,
      },
      {
        id: "first-camera",
        stableRosterIndex: 1,
        cameraEnabled: true,
        connected: true,
        disconnected: false,
      },
      {
        id: "connected-a",
        stableRosterIndex: 2,
        cameraEnabled: false,
        connected: true,
        disconnected: false,
      },
      {
        id: "connected-b",
        stableRosterIndex: 3,
        cameraEnabled: false,
        connected: true,
        disconnected: false,
      },
      {
        id: "second-camera",
        stableRosterIndex: 4,
        cameraEnabled: true,
        connected: true,
        disconnected: false,
      },
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "first-disconnected",
      "first-camera",
      "connected-a",
      "connected-b",
      "second-camera",
    ]);
  });

  test("camera, microphone, and speaking state do not imply observer reordering", () => {
    const before = orderObserverRosterItems([
      {
        id: "observer-1",
        stableRosterIndex: 0,
        cameraEnabled: false,
        connected: true,
        disconnected: false,
        micEnabled: false,
        speaking: false,
      },
      {
        id: "observer-2",
        stableRosterIndex: 1,
        cameraEnabled: true,
        connected: true,
        disconnected: false,
        micEnabled: true,
        speaking: true,
      },
      {
        id: "observer-3",
        stableRosterIndex: 2,
        cameraEnabled: false,
        connected: false,
        disconnected: true,
        micEnabled: false,
        speaking: false,
      },
    ]);
    const after = orderObserverRosterItems([
      {
        id: "observer-1",
        stableRosterIndex: 0,
        cameraEnabled: true,
        connected: true,
        disconnected: false,
        micEnabled: true,
        speaking: true,
      },
      {
        id: "observer-2",
        stableRosterIndex: 1,
        cameraEnabled: false,
        connected: true,
        disconnected: false,
        micEnabled: false,
        speaking: false,
      },
      {
        id: "observer-3",
        stableRosterIndex: 2,
        cameraEnabled: true,
        connected: true,
        disconnected: false,
        micEnabled: true,
        speaking: false,
      },
    ]);

    expect(before.map((item) => item.id)).toEqual(["observer-1", "observer-2", "observer-3"]);
    expect(after.map((item) => item.id)).toEqual(["observer-1", "observer-2", "observer-3"]);
  });

  test("assigned but disconnected users are excluded from active video tiles", () => {
    const source = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
    expect(source).toContain("mediaModel.shouldRenderActiveTile");
    expect(source).toContain("const isLogicallyAbsent = entry.isLogicallyPresent === false");
    expect(source).toContain("connectedSignal: isLocal ? joined : Boolean(matchedRemote) && !isLogicallyAbsent");
  });

  test("observer rail membership follows logical room presence, not media state", () => {
    const activeCameraOffObserver = rosterEntry({
      id: "active-camera-off",
      participantType: "OBSERVER",
      userId: "user-active-camera-off",
      voximplantProviderUsername: "observer-active-camera-off",
      cameraEnabled: false,
      micEnabled: false,
      isLogicallyPresent: true,
      logicalConnectionId: "connection-active-camera-off",
    });
    const activeButProviderDisconnectedObserver = rosterEntry({
      id: "active-provider-disconnected",
      participantType: "OBSERVER",
      userId: "user-active-provider-disconnected",
      voximplantProviderUsername: "observer-provider-disconnected",
      isLogicallyPresent: true,
      logicalConnectionId: "connection-active-provider-disconnected",
    });
    const explicitLeaveObserver = rosterEntry({
      id: "explicit-leave",
      participantType: "OBSERVER",
      userId: "user-explicit-leave",
      voximplantProviderUsername: "observer-explicit-leave",
      isLogicallyPresent: false,
      logicalDisconnectReason: "EXPLICIT_LEAVE",
    });
    const expiredObserver = rosterEntry({
      id: "expired",
      participantType: "OBSERVER",
      userId: "user-expired",
      voximplantProviderUsername: "observer-expired",
      isLogicallyPresent: false,
      logicalDisconnectReason: "EXPIRED",
    });
    const historicalObserverWithoutPresence = rosterEntry({
      id: "known-only",
      participantType: "OBSERVER",
      userId: "user-known-only",
      isLogicallyPresent: null,
    });
    const activeFixtureObserverWithoutProviderIdentity = rosterEntry({
      id: "active-fixture-without-provider",
      participantType: "OBSERVER",
      userId: "user-active-fixture-without-provider",
      isLogicallyPresent: true,
      logicalConnectionId: "connection-active-fixture-without-provider",
    });
    const assignedParticipant = rosterEntry({
      id: "participant-a",
      participantType: "PARTICIPANT",
      sessionRoleId: "role-a",
      caseRoleName: "Participant A",
      isLogicallyPresent: true,
    });

    expect(
      shouldRenderObserverRailTile({
        entry: activeCameraOffObserver,
        zone: "observer",
        hasActiveMediaPresence: true,
      }),
    ).toBe(true);
    expect(
      shouldRenderObserverRailTile({
        entry: activeButProviderDisconnectedObserver,
        zone: "observer",
        hasActiveMediaPresence: false,
      }),
    ).toBe(false);
    expect(
      shouldRenderObserverRailTile({
        entry: explicitLeaveObserver,
        zone: "observer",
        hasActiveMediaPresence: true,
      }),
    ).toBe(false);
    expect(
      shouldRenderObserverRailTile({
        entry: expiredObserver,
        zone: "observer",
        hasActiveMediaPresence: true,
      }),
    ).toBe(false);
    expect(
      shouldRenderObserverRailTile({
        entry: historicalObserverWithoutPresence,
        zone: "observer",
        hasActiveMediaPresence: true,
      }),
    ).toBe(false);
    expect(
      shouldRenderObserverRailTile({
        entry: activeFixtureObserverWithoutProviderIdentity,
        zone: "observer",
        hasActiveMediaPresence: false,
      }),
    ).toBe(true);
    expect(
      shouldRenderObserverRailTile({
        entry: assignedParticipant,
        zone: "participant_a",
        hasActiveMediaPresence: true,
      }),
    ).toBe(false);
  });

  test("room tiles keep name and case role without duplicated role/status subtitle text", () => {
    const source = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
    expect(source).toContain("tile.rosterEntry.caseRoleName ?? undefined");
    expect(source).toContain(
      "title={tile.isLocal ? `${tile.rosterEntry.displayName} (${t(\"common.you\")})` : tile.rosterEntry.displayName}",
    );
    expect(source).toContain("observerTileAriaLabel");
    expect(source).not.toContain("t(\"room.videoOn\")");
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
    ).toBe("on");
    expect(
      resolveRemoteMicStateByPolicy({
        negotiationState: "PAUSED",
        participantType: "PARTICIPANT",
      }),
    ).toBe("on");
  });

  test("room tile media state does not hard-mute all remotes on PAUSED", () => {
    const source = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
    expect(source).not.toContain('controlState.negotiationState === "PAUSED"');
    expect(source).toContain("entry.micEnabled === null || entry.micEnabled === undefined");
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

  test("shared media controls expose explicit state labels and visual states", () => {
    const source = readFileSync("components/voximplant-media-controls.tsx", "utf-8");
    expect(source).toContain("t(\"room.mediaMicOn\")");
    expect(source).toContain("t(\"room.mediaMicOff\")");
    expect(source).toContain("t(\"room.mediaCameraOn\")");
    expect(source).toContain("t(\"room.mediaCameraOff\")");
    expect(source).toContain("t(\"room.mediaCameraBusyOrUnavailable\")");
    expect(source).toContain("data-state={micState}");
    expect(source).toContain("data-state={cameraState}");
    expect(source).toContain("border-emerald-500/60");
    expect(source).toContain("border-rose-500/60");
    expect(source).toContain("border-slate-500/60");
  });

  test("active speaker highlight is not assigned to arbitrary remote tiles", () => {
    const source = readFileSync(
      "components/voximplant-video-layout.tsx",
      "utf-8",
    );
    expect(source).toContain("isRemoteSpeaking(remoteSpeakingById, tile.participant.id)");
  });

  test("every rendered room user resolves speaking through the shared rule", () => {
    const source = readFileSync(
      "components/voximplant-video-layout.tsx",
      "utf-8",
    );
    expect(source).toContain("resolveTileSpeakingHighlight({");
    expect(source).toContain("isSpeaking={resolveSpeakingHighlightForTile(tile)}");
    // Speaking visualization must not depend on role, stage slot, or phase.
    expect(source).not.toMatch(/resolveTileSpeakingHighlight\([\s\S]{0,600}participantType/);
    expect(source).not.toMatch(/resolveTileSpeakingHighlight\([\s\S]{0,600}negotiationState/);
  });

  test("participant tiles render icon-based mic/camera status", () => {
    const source = readFileSync("components/voximplant-participant-tile.tsx", "utf-8");
    expect(source).toContain("participant-tile-mic-status-icon");
    expect(source).toContain("participant-tile-camera-status-icon");
    expect(source).toContain("MediaStatusIconBadge");
  });

  test("lobby layout keeps side panel and video pane independent", () => {
    const source = readFileSync("components/event-lobby-view.tsx", "utf-8");
    expect(source).toContain("fixed inset-0");
    expect(source).toContain("min-h-0");
    expect(source).toContain("overflow-hidden");
    expect(source).toContain("overflow-y-auto");
  });

  test("lobby video grid no longer uses stretching auto-rows-fr", () => {
    const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
    expect(source).not.toContain("auto-rows-fr");
    expect(source).toContain("content-start");
    expect(source).toContain("max-w-[420px]");
  });

  test("lobby and room use Vox lifecycle sequencing for transition", () => {
    const lobbySource = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
    const roomSource = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
    expect(lobbySource).toContain("waitForVoxClientIdle");
    expect(lobbySource).toContain("registerVoxClientDisconnect");
    expect(roomSource).toContain("waitForVoxClientIdle");
    expect(roomSource).toContain("registerVoxClientDisconnect");
  });

  test("required RU/EN media labels exist in dictionaries", () => {
    const ru = readFileSync("lib/i18n/dictionaries/ru.ts", "utf-8");
    const en = readFileSync("lib/i18n/dictionaries/en.ts", "utf-8");
    expect(ru).toContain("mediaMicOn: \"Микрофон включён\"");
    expect(ru).toContain("mediaMicOff: \"Микрофон выключен\"");
    expect(ru).toContain("mediaCameraOn: \"Камера включена\"");
    expect(ru).toContain("mediaCameraOff: \"Камера выключена\"");
    expect(ru).toContain("mediaCameraBusyOrUnavailable: \"Камера занята или недоступна\"");
    expect(en).toContain("mediaMicOn: \"Mic on\"");
    expect(en).toContain("mediaMicOff: \"Mic off\"");
    expect(en).toContain("mediaCameraOn: \"Camera on\"");
    expect(en).toContain("mediaCameraOff: \"Camera off\"");
    expect(en).toContain("mediaCameraBusyOrUnavailable: \"Camera is busy or unavailable\"");
  });
});

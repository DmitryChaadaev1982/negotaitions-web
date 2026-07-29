import type { RoomAccessDecisionOutput } from "@/lib/session-room-access";

export type EventSessionPrimaryActionLabelKey =
  | "events.openRoom"
  | "events.returnToDebrief"
  | "events.openMaterials"
  | "events.openResults";

export type EventSessionPrimaryActionKind =
  | "OPEN_ROOM"
  | "RETURN_TO_DEBRIEF"
  | "OPEN_MATERIALS"
  | "OPEN_RESULTS";

export type EventSessionPrimaryAction = {
  kind: EventSessionPrimaryActionKind;
  href: string;
  labelKey: EventSessionPrimaryActionLabelKey;
};

export function resolveEventSessionPrimaryAction(input: {
  roomAccessDecision: RoomAccessDecisionOutput | null;
  roomHref: string | null;
  materialsHref: string | null;
  redirectHref: string | null;
}): EventSessionPrimaryAction | null {
  if (input.roomAccessDecision === "ALLOW_ACTIVE_ROOM" && input.roomHref) {
    return {
      kind: "OPEN_ROOM",
      href: input.roomHref,
      labelKey: "events.openRoom",
    };
  }
  if (input.roomAccessDecision === "ALLOW_DEBRIEF" && input.roomHref) {
    return {
      kind: "RETURN_TO_DEBRIEF",
      href: input.roomHref,
      labelKey: "events.returnToDebrief",
    };
  }
  if (input.roomAccessDecision === "REDIRECT_MATERIALS") {
    const href = input.redirectHref ?? input.materialsHref;
    if (href) {
      return {
        kind: "OPEN_MATERIALS",
        href,
        labelKey: "events.openMaterials",
      };
    }
  }
  if (input.roomAccessDecision === "REDIRECT_EVENT_RESULTS") {
    const href = input.redirectHref ?? input.materialsHref;
    if (href) {
      return {
        kind: "OPEN_RESULTS",
        href,
        labelKey: "events.openResults",
      };
    }
  }
  return null;
}

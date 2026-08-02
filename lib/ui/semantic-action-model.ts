import type { EventSessionPrimaryActionKind } from "@/lib/event-session-primary-action";

export type SemanticActionKind =
  | "PRIMARY_PROGRESS"
  | "RETURN_TO_ACTIVE"
  | "REVIEW_RESULTS"
  | "NAVIGATION"
  | "MANAGEMENT"
  | "WARNING"
  | "DESTRUCTIVE"
  | "DISABLED";

export type SemanticActionSize = "default" | "compact";

export type SemanticActionPresentation = {
  kind: SemanticActionKind;
  visualVariant:
    | "primary"
    | "return"
    | "review"
    | "navigation"
    | "management"
    | "warning"
    | "destructive"
    | "disabled";
  size: SemanticActionSize;
};

export function semanticKindForEventSessionAction(
  actionKind: EventSessionPrimaryActionKind,
): SemanticActionKind {
  if (actionKind === "OPEN_ROOM") {
    return "PRIMARY_PROGRESS";
  }
  if (actionKind === "RETURN_TO_DEBRIEF") {
    return "RETURN_TO_ACTIVE";
  }
  return "REVIEW_RESULTS";
}

export function getSemanticActionPresentation(
  kind: SemanticActionKind,
  size: SemanticActionSize = "default",
): SemanticActionPresentation {
  switch (kind) {
    case "PRIMARY_PROGRESS":
      return { kind, visualVariant: "primary", size };
    case "RETURN_TO_ACTIVE":
      return { kind, visualVariant: "return", size };
    case "REVIEW_RESULTS":
      return { kind, visualVariant: "review", size };
    case "NAVIGATION":
      return { kind, visualVariant: "navigation", size };
    case "MANAGEMENT":
      return { kind, visualVariant: "management", size };
    case "WARNING":
      return { kind, visualVariant: "warning", size };
    case "DESTRUCTIVE":
      return { kind, visualVariant: "destructive", size };
    case "DISABLED":
    default:
      return { kind, visualVariant: "disabled", size };
  }
}

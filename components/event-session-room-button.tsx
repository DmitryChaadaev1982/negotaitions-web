"use client";

import { SemanticActionLink } from "@/components/semantic-action";
import {
  resolveEventSessionPrimaryAction,
  type EventSessionPrimaryAction,
} from "@/lib/event-session-primary-action";
import type { RoomAccessDecisionOutput } from "@/lib/session-room-access";
import { useI18n } from "@/lib/i18n/useI18n";
import { semanticKindForEventSessionAction } from "@/lib/ui/semantic-action-model";

type EventSessionRoomButtonProps = {
  roomAccessDecision: RoomAccessDecisionOutput | null;
  roomHref: string | null;
  materialsHref: string | null;
  redirectHref?: string | null;
  compact?: boolean;
  testId?: string;
};

export function EventSessionRoomButton({
  roomAccessDecision,
  roomHref,
  materialsHref,
  redirectHref = null,
  compact = false,
  testId = "go-to-session-room-button",
}: EventSessionRoomButtonProps) {
  const { t } = useI18n();
  const action: EventSessionPrimaryAction | null = resolveEventSessionPrimaryAction({
    roomAccessDecision,
    roomHref,
    materialsHref,
    redirectHref,
  });
  if (!action) {
    return null;
  }
  return (
    <SemanticActionLink
      href={action.href}
      actionKind={semanticKindForEventSessionAction(action.kind)}
      actionTarget={action.href}
      size={compact ? "compact" : "default"}
      data-testid={testId}
    >
      {t(action.labelKey)}
    </SemanticActionLink>
  );
}

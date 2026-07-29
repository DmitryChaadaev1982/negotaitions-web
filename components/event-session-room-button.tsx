"use client";

import {
  GradientButtonLink,
} from "@/components/ui/buttons";
import {
  resolveEventSessionPrimaryAction,
  type EventSessionPrimaryAction,
} from "@/lib/event-session-primary-action";
import type { RoomAccessDecisionOutput } from "@/lib/session-room-access";
import { useI18n } from "@/lib/i18n/useI18n";

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
  const className = compact ? "px-2 py-1 text-xs" : undefined;
  return (
    <GradientButtonLink
      href={action.href}
      className={className}
      data-testid={testId}
    >
      {t(action.labelKey)}
    </GradientButtonLink>
  );
}

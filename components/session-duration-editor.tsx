"use client";

import { updateSessionDuration } from "@/app/actions/sessions";
import { NegotiationState } from "@/app/generated/prisma/enums";
import { GradientButton } from "@/components/ui/buttons";
import { inputClassName, labelClassName } from "@/components/ui/form-styles";
import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  secondsToDisplayMinutes,
} from "@/lib/negotiation-duration";
import { useI18n } from "@/lib/i18n/useI18n";
import { useState } from "react";

type SessionDurationEditorProps = {
  sessionId: string;
  durationSeconds: number;
  negotiationState: NegotiationState;
  readOnly?: boolean;
};

export function SessionDurationEditor({
  sessionId,
  durationSeconds,
  negotiationState,
  readOnly = false,
}: SessionDurationEditorProps) {
  const { t } = useI18n();
  const [durationMinutes, setDurationMinutes] = useState(
    secondsToDisplayMinutes(durationSeconds),
  );

  if (readOnly || negotiationState !== NegotiationState.LOBBY) {
    return (
      <p className="text-sm text-slate-400">
        {t("common.negotiationDurationValue", {
          minutes: secondsToDisplayMinutes(durationSeconds),
        })}
      </p>
    );
  }

  return (
    <form action={updateSessionDuration} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <div>
        <label htmlFor="durationMinutes" className={labelClassName}>
          {t("common.negotiationDurationMinutes")}
        </label>
        <input
          id="durationMinutes"
          name="durationMinutes"
          type="number"
          min={MIN_NEGOTIATION_DURATION_MINUTES}
          max={MAX_NEGOTIATION_DURATION_MINUTES}
          required
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(Number(event.target.value))}
          className={`${inputClassName(false)} w-32`}
        />
      </div>
      <GradientButton type="submit">
        {t("common.saveDuration")}
      </GradientButton>
    </form>
  );
}

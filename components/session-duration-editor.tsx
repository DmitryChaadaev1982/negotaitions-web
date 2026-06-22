"use client";

import { updateSessionDuration } from "@/app/actions/sessions";
import { NegotiationState } from "@/app/generated/prisma/enums";
import { GradientButton } from "@/components/ui/buttons";
import { inputClassName, labelClassName } from "@/components/ui/form-styles";
import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MAX_PREPARATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  MIN_PREPARATION_DURATION_MINUTES,
  secondsToDisplayMinutes,
} from "@/lib/negotiation-duration";
import { useI18n } from "@/lib/i18n/useI18n";
import { useState } from "react";

const EDITABLE_DURATION_STATES: NegotiationState[] = [
  NegotiationState.PREPARATION,
  NegotiationState.PREPARATION_RUNNING,
  NegotiationState.PREPARATION_PAUSED,
  NegotiationState.READY_TO_START,
];

type SessionDurationEditorProps = {
  sessionId: string;
  durationSeconds: number;
  preparationDurationSeconds: number;
  negotiationState: NegotiationState;
  readOnly?: boolean;
};

export function SessionDurationEditor({
  sessionId,
  durationSeconds,
  preparationDurationSeconds,
  negotiationState,
  readOnly = false,
}: SessionDurationEditorProps) {
  const { t } = useI18n();
  const [negotiationDurationMinutes, setNegotiationDurationMinutes] = useState(
    secondsToDisplayMinutes(durationSeconds),
  );
  const [preparationDurationMinutes, setPreparationDurationMinutes] = useState(
    secondsToDisplayMinutes(preparationDurationSeconds),
  );

  if (readOnly || !EDITABLE_DURATION_STATES.includes(negotiationState)) {
    return (
      <div className="space-y-1 text-sm text-slate-400">
        <p>
          {t("common.preparationDurationValue", {
            minutes: secondsToDisplayMinutes(preparationDurationSeconds),
          })}
        </p>
        <p>
          {t("common.negotiationDurationValue", {
            minutes: secondsToDisplayMinutes(durationSeconds),
          })}
        </p>
      </div>
    );
  }

  return (
    <form action={updateSessionDuration} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <div>
        <label htmlFor="preparationDurationMinutes" className={labelClassName}>
          {t("common.preparationDurationMinutes")}
        </label>
        <input
          id="preparationDurationMinutes"
          name="preparationDurationMinutes"
          type="number"
          min={MIN_PREPARATION_DURATION_MINUTES}
          max={MAX_PREPARATION_DURATION_MINUTES}
          required
          value={preparationDurationMinutes}
          onChange={(event) =>
            setPreparationDurationMinutes(Number(event.target.value))
          }
          className={`${inputClassName(false)} w-32`}
        />
      </div>
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
          value={negotiationDurationMinutes}
          onChange={(event) =>
            setNegotiationDurationMinutes(Number(event.target.value))
          }
          className={`${inputClassName(false)} w-32`}
        />
      </div>
      <GradientButton type="submit">
        {t("common.saveDuration")}
      </GradientButton>
    </form>
  );
}

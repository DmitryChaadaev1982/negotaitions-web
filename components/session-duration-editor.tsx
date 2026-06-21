"use client";

import { updateSessionDuration } from "@/app/actions/sessions";
import { NegotiationState } from "@/app/generated/prisma/enums";
import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  secondsToDisplayMinutes,
} from "@/lib/negotiation-duration";
import { useState } from "react";

type SessionDurationEditorProps = {
  sessionId: string;
  durationSeconds: number;
  negotiationState: NegotiationState;
};

export function SessionDurationEditor({
  sessionId,
  durationSeconds,
  negotiationState,
}: SessionDurationEditorProps) {
  const [durationMinutes, setDurationMinutes] = useState(
    secondsToDisplayMinutes(durationSeconds),
  );

  if (negotiationState !== NegotiationState.LOBBY) {
    return (
      <p className="text-sm text-slate-600">
        Negotiation duration: {secondsToDisplayMinutes(durationSeconds)} minutes
      </p>
    );
  }

  return (
    <form action={updateSessionDuration} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <div>
        <label
          htmlFor="durationMinutes"
          className="mb-1.5 block text-sm font-medium text-slate-700"
        >
          Negotiation duration (minutes)
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
          className="block w-32 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
        />
      </div>
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
      >
        Save duration
      </button>
    </form>
  );
}

import { normalizeTimeZone, zonedDateTimeInputToUtcDate } from "@/lib/timezones";

type ScheduleResolutionErrorKey =
  | "invalidDateTime"
  | "scheduledAtRequiredOnUpdate";

export type ScheduleResolution =
  | {
      ok: true;
      scheduledAt: Date | null;
      timeZone: string;
    }
  | {
      ok: false;
      errorKey: ScheduleResolutionErrorKey;
    };

export function resolveCreateEventSchedule(params: {
  scheduledAt: string | null;
  timeZone: string;
  now: Date;
}): ScheduleResolution {
  const normalizedTimeZone = normalizeTimeZone(params.timeZone);

  if (!params.scheduledAt) {
    return {
      ok: true,
      scheduledAt: params.now,
      timeZone: normalizedTimeZone,
    };
  }

  const converted = zonedDateTimeInputToUtcDate(
    params.scheduledAt,
    normalizedTimeZone,
  );
  if (!converted) {
    return { ok: false, errorKey: "invalidDateTime" };
  }

  return {
    ok: true,
    scheduledAt: converted,
    timeZone: normalizedTimeZone,
  };
}
export function resolveUpdateEventSchedule(params: {
  scheduledAtFieldPresent: boolean;
  scheduledAt: string | null;
  isExplicitClear: boolean;
  timeZone: string;
  existingScheduledAt: Date | null;
  existingTimeZone: string;
}): ScheduleResolution {
  if (!params.scheduledAtFieldPresent) {
    return {
      ok: true,
      scheduledAt: params.existingScheduledAt,
      timeZone: params.existingTimeZone,
    };
  }

  if (params.isExplicitClear) {
    return { ok: false, errorKey: "scheduledAtRequiredOnUpdate" };
  }

  if (!params.scheduledAt) {
    return { ok: false, errorKey: "invalidDateTime" };
  }

  const normalizedTimeZone = normalizeTimeZone(params.timeZone);
  const converted = zonedDateTimeInputToUtcDate(
    params.scheduledAt,
    normalizedTimeZone,
  );
  if (!converted) {
    return { ok: false, errorKey: "invalidDateTime" };
  }

  return {
    ok: true,
    scheduledAt: converted,
    timeZone: normalizedTimeZone,
  };
}

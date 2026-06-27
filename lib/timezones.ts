export const DEFAULT_EVENT_TIME_ZONE = "UTC";

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: string) => string[];
};

function datePartsToEpochMinutes(parts: DateTimeParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  ) / 60000;
}

function getDateTimePartsInTimeZone(date: Date, timeZone: string): DateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour"),
    minute: lookup("minute"),
  };
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(input: string | null | undefined) {
  const candidate = input?.trim();
  if (!candidate) {
    return DEFAULT_EVENT_TIME_ZONE;
  }
  return isValidTimeZone(candidate) ? candidate : DEFAULT_EVENT_TIME_ZONE;
}

export function getSupportedTimeZones() {
  const intlWithSupported = Intl as IntlWithSupportedValues;
  const supported = intlWithSupported.supportedValuesOf?.("timeZone") ?? [];
  const zones = supported.length > 0 ? supported : [DEFAULT_EVENT_TIME_ZONE];
  return zones.includes(DEFAULT_EVENT_TIME_ZONE)
    ? zones
    : [DEFAULT_EVENT_TIME_ZONE, ...zones];
}

export function getClientTimeZone() {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return normalizeTimeZone(resolved);
}

export function zonedDateTimeInputToUtcDate(
  localDateTime: string,
  timeZone: string,
): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime.trim());
  if (!match) {
    return null;
  }

  const target: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };

  let timestamp = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );
  const targetMinutes = datePartsToEpochMinutes(target);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getDateTimePartsInTimeZone(new Date(timestamp), timeZone);
    const diffMinutes = targetMinutes - datePartsToEpochMinutes(actual);
    if (diffMinutes === 0) {
      return new Date(timestamp);
    }
    timestamp += diffMinutes * 60_000;
  }

  return new Date(timestamp);
}


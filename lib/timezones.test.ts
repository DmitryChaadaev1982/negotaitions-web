import assert from "node:assert/strict";
import test from "node:test";

import { zonedDateTimeInputToUtcDate } from "@/lib/timezones";

test("converts valid local datetime + IANA timezone to UTC instant", () => {
  const converted = zonedDateTimeInputToUtcDate(
    "2026-06-15T12:30",
    "Europe/Berlin",
  );

  assert.ok(converted instanceof Date);
  assert.equal(converted?.toISOString(), "2026-06-15T10:30:00.000Z");
});

test("rejects malformed datetime input", () => {
  assert.equal(
    zonedDateTimeInputToUtcDate("not-a-datetime", "Europe/Berlin"),
    null,
  );
});

test("rejects impossible calendar datetime input", () => {
  assert.equal(
    zonedDateTimeInputToUtcDate("2026-02-30T10:00", "Europe/Berlin"),
    null,
  );
});

test("rejects nonexistent DST wall-clock time instead of coercing", () => {
  assert.equal(
    zonedDateTimeInputToUtcDate("2026-03-08T02:30", "America/New_York"),
    null,
  );
});

test("ambiguous DST fallback wall-clock is resolved deterministically", () => {
  const first = zonedDateTimeInputToUtcDate(
    "2026-11-01T01:30",
    "America/New_York",
  );
  const second = zonedDateTimeInputToUtcDate(
    "2026-11-01T01:30",
    "America/New_York",
  );

  assert.ok(first instanceof Date);
  assert.ok(second instanceof Date);
  assert.equal(first?.toISOString(), second?.toISOString());
});

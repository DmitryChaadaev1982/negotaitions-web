import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCreateEventSchedule,
  resolveUpdateEventSchedule,
} from "@/lib/event-scheduling";

test("create defaults missing scheduledAt to current server time", () => {
  const now = new Date("2026-08-14T10:15:00.000Z");
  const resolved = resolveCreateEventSchedule({
    scheduledAt: null,
    timeZone: "Europe/Berlin",
    now,
  });

  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.scheduledAt?.toISOString(), now.toISOString());
    assert.equal(resolved.timeZone, "Europe/Berlin");
  }
});

test("create resolves explicit valid datetime to UTC", () => {
  const resolved = resolveCreateEventSchedule({
    scheduledAt: "2026-06-15T12:30",
    timeZone: "Europe/Berlin",
    now: new Date("2026-08-14T10:15:00.000Z"),
  });

  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.scheduledAt?.toISOString(), "2026-06-15T10:30:00.000Z");
  }
});

test("create rejects explicit invalid datetime and does not fallback to now", () => {
  const resolved = resolveCreateEventSchedule({
    scheduledAt: "2026-03-08T02:30",
    timeZone: "America/New_York",
    now: new Date("2026-08-14T10:15:00.000Z"),
  });

  assert.deepEqual(resolved, { ok: false, errorKey: "invalidDateTime" });
});

test("update preserves existing schedule when datetime field is omitted", () => {
  const existing = new Date("2026-05-01T08:00:00.000Z");
  const resolved = resolveUpdateEventSchedule({
    scheduledAtFieldPresent: false,
    scheduledAt: null,
    isExplicitClear: false,
    timeZone: "America/New_York",
    existingScheduledAt: existing,
    existingTimeZone: "Europe/Berlin",
  });

  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.scheduledAt?.toISOString(), existing.toISOString());
    assert.equal(resolved.timeZone, "Europe/Berlin");
  }
});

test("update accepts explicit valid schedule replacement", () => {
  const resolved = resolveUpdateEventSchedule({
    scheduledAtFieldPresent: true,
    scheduledAt: "2026-06-15T12:30",
    isExplicitClear: false,
    timeZone: "Europe/Berlin",
    existingScheduledAt: new Date("2026-05-01T08:00:00.000Z"),
    existingTimeZone: "UTC",
  });

  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.scheduledAt?.toISOString(), "2026-06-15T10:30:00.000Z");
    assert.equal(resolved.timeZone, "Europe/Berlin");
  }
});

test("update rejects explicit clear attempt", () => {
  const resolved = resolveUpdateEventSchedule({
    scheduledAtFieldPresent: true,
    scheduledAt: null,
    isExplicitClear: true,
    timeZone: "UTC",
    existingScheduledAt: new Date("2026-05-01T08:00:00.000Z"),
    existingTimeZone: "UTC",
  });

  assert.deepEqual(resolved, {
    ok: false,
    errorKey: "scheduledAtRequiredOnUpdate",
  });
});

test("update rejects explicit invalid datetime without rewriting schedule", () => {
  const resolved = resolveUpdateEventSchedule({
    scheduledAtFieldPresent: true,
    scheduledAt: "invalid",
    isExplicitClear: false,
    timeZone: "UTC",
    existingScheduledAt: new Date("2026-05-01T08:00:00.000Z"),
    existingTimeZone: "UTC",
  });

  assert.deepEqual(resolved, { ok: false, errorKey: "invalidDateTime" });
});

test("legacy null scheduledAt remains compatible on unrelated update omission", () => {
  const resolved = resolveUpdateEventSchedule({
    scheduledAtFieldPresent: false,
    scheduledAt: null,
    isExplicitClear: false,
    timeZone: "Europe/Berlin",
    existingScheduledAt: null,
    existingTimeZone: "UTC",
  });

  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.scheduledAt, null);
    assert.equal(resolved.timeZone, "UTC");
  }
});

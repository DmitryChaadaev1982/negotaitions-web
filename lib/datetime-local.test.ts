import assert from "node:assert/strict";
import test from "node:test";

import { formatDateTimeLocalInputValue } from "@/lib/datetime-local";

test("formats current local Date into datetime-local input value", () => {
  const localDate = new Date(2026, 7, 14, 16, 5, 33);

  assert.equal(
    formatDateTimeLocalInputValue(localDate),
    "2026-08-14T16:05",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { parseResetTokenFragment } from "@/lib/auth/reset-fragment";

const VALID_TOKEN = "a1".repeat(32);
const OTHER_VALID_TOKEN = "b2".repeat(32);

test("reset fragment accepts exactly one valid token", () => {
  assert.equal(
    parseResetTokenFragment(`#token=${VALID_TOKEN.toUpperCase()}`),
    VALID_TOKEN,
  );
});

test("reset fragment rejects duplicate token parameters in either order", () => {
  assert.equal(
    parseResetTokenFragment(`#token=bad&token=${VALID_TOKEN}`),
    null,
  );
  assert.equal(
    parseResetTokenFragment(`#token=${VALID_TOKEN}&token=bad`),
    null,
  );
  assert.equal(
    parseResetTokenFragment(
      `#token=${VALID_TOKEN}&token=${OTHER_VALID_TOKEN}`,
    ),
    null,
  );
});

test("reset fragment rejects malformed, empty, and unrelated fields", () => {
  assert.equal(parseResetTokenFragment("#token=%E0%A4%A"), null);
  assert.equal(parseResetTokenFragment("#token="), null);
  assert.equal(
    parseResetTokenFragment(`#token=${VALID_TOKEN}&source=email`),
    null,
  );
  assert.equal(parseResetTokenFragment(`#source=${VALID_TOKEN}`), null);
  assert.equal(parseResetTokenFragment(""), null);
});

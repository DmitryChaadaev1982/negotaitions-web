import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
} from "@/lib/auth/password-policy";

test("FOUND-01 canonical policy owner preserves minLength 8", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.deepEqual(validateNewPassword({ password: "1234567" }), {
    ok: false,
    codes: ["too_short"],
  });
  assert.deepEqual(
    validateNewPassword({ password: "12345678", confirmation: "12345678" }),
    { ok: true },
  );
  assert.deepEqual(
    validateNewPassword({ password: "12345678", confirmation: "12345679" }),
    { ok: false, codes: ["mismatch"] },
  );
  assert.deepEqual(
    validateNewPassword({ password: "short", confirmation: "other" }),
    { ok: false, codes: ["too_short", "mismatch"] },
  );
});

test("FOUND-02 FOUND-03 FOUND-04 password actions import the canonical policy owner", async () => {
  const root = process.cwd();
  const files = [
    "app/actions/auth.ts",
    "app/actions/password-reset.ts",
    "app/actions/account.ts",
  ];
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.match(source, /validateNewPassword/);
    assert.doesNotMatch(source, /length\s*<\s*8/);
    assert.doesNotMatch(source, /length\s*<\s*10/);
  }
});

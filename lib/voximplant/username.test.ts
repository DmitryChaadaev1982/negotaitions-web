import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildVoximplantUsernameForUser,
  GENERATED_VOXIMPLANT_USERNAME_PATTERN,
  isGeneratedVoximplantUsername,
} from "@/lib/voximplant/username";

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

test("production username algorithm stays in username.ts and is re-exported by identity.ts", () => {
  const usernameSource = readRepoFile("lib/voximplant/username.ts");
  const identitySource = readRepoFile("lib/voximplant/identity.ts");

  assert.match(
    usernameSource,
    /export function buildVoximplantUsernameForUser\(userId: string\): string \{\r?\n  const digest = createHash\("sha256"\)\.update\(userId\)\.digest\("hex"\)\.slice\(0, 16\);\r?\n  return `ng_u_\$\{digest\}`;\r?\n\}/,
  );
  assert.match(identitySource, /export \{ buildVoximplantUsernameForUser \}/);
  assert.doesNotMatch(
    identitySource,
    /createHash\("sha256"\)\.update\(userId\)/,
  );
  assert.doesNotMatch(
    readRepoFile("lib/voximplant/orphan-user-cleanup.ts"),
    /createHash\("sha256"\)\.update\(userId\)/,
  );
});

test("buildVoximplantUsernameForUser matches sha256 prefix contract", () => {
  const userId = "e2e_managed_vox_participant_01";
  const expected = `ng_u_${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;
  assert.equal(buildVoximplantUsernameForUser(userId), expected);
  assert.match(expected, GENERATED_VOXIMPLANT_USERNAME_PATTERN);
  assert.equal(isGeneratedVoximplantUsername(expected), true);
  assert.equal(isGeneratedVoximplantUsername("participant-a"), false);
  assert.equal(isGeneratedVoximplantUsername("ng_u_fixture_abc"), false);
  assert.equal(isGeneratedVoximplantUsername("ng_u_147f7343afa8773d"), true);
});

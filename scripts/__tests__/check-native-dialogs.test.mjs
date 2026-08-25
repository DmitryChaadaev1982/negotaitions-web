import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkNativeDialogs,
  findDialogCalls,
  parseAllowlist,
} from "../check-native-dialogs-lib.mjs";

function writeAllowlist(dir, exceptions) {
  const allowlistPath = path.join(dir, "allowlist.json");
  fs.writeFileSync(
    allowlistPath,
    JSON.stringify({ exceptions }, null, 2),
    "utf8",
  );
  return allowlistPath;
}

function writeSource(dir, relativePath, source) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, source, "utf8");
  return { fullPath, relativePath: relativePath.split(path.sep).join("/") };
}

function exception(file, api, reason, expectedCount = 1) {
  return { file, api, reason, expectedCount };
}

test("current repository allowlist passes with zero production exceptions", () => {
  const result = checkNativeDialogs({ repositoryRoot: process.cwd() });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.unexpected.length, 0);
  assert.equal(result.stale.length, 0);
  assert.equal(result.countMismatches.length, 0);
  assert.equal(result.occurrences.length, 0);
});

test("new non-allowlisted alert fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-alert-"));
  const files = [
    writeSource(dir, "components/new-alert.tsx", "window.alert('no');\n"),
  ];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, []),
    files,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Unexpected native dialog: components\/new-alert.tsx : alert/);
});

test("new non-allowlisted confirm fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-confirm-"));
  const files = [
    writeSource(dir, "components/new-confirm.tsx", "if (window.confirm('ok')) {}\n"),
  ];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, []),
    files,
  });
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /Unexpected native dialog: components\/new-confirm.tsx : confirm/,
  );
});

test("new non-allowlisted prompt fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-prompt-"));
  const files = [
    writeSource(dir, "components/new-prompt.tsx", "window.prompt('copy', 'url');\n"),
  ];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, []),
    files,
  });
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /Unexpected native dialog: components\/new-prompt.tsx : prompt/,
  );
});

test("stale allowlist entry fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-stale-"));
  const files = [
    writeSource(dir, "components/copy-join-link-button.tsx", "window.prompt('copy');\n"),
  ];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, [
      exception("components/copy-join-link-button.tsx", "prompt", "copy fallback"),
      exception("components/gone.tsx", "alert", "no longer present"),
    ]),
    files,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Stale native-dialog allowlist entry: components\/gone.tsx : alert/);
});

test("allowlisted occurrence passes and comments are ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-ok-"));
  const files = [
    writeSource(
      dir,
      "components/copy-join-link-button.tsx",
      [
        "// do not add window.alert(",
        "/* window.confirm( */",
        "window.prompt('copy', url);",
        "",
      ].join("\n"),
    ),
  ];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, [
      exception("components/copy-join-link-button.tsx", "prompt", "copy fallback"),
    ]),
    files,
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(
    result.occurrences.map((item) => `${item.file} : ${item.api}`),
    ["components/copy-join-link-button.tsx : prompt"],
  );
});

test("one allowlisted confirm with expectedCount 1 passes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-one-confirm-"));
  const files = [
    writeSource(dir, "components/events-list-view.tsx", "if (window.confirm('ok')) {}\n"),
  ];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, [
      exception("components/events-list-view.tsx", "confirm", "legacy complete"),
    ]),
    files,
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.countMismatches.length, 0);
  assert.equal(result.occurrences.length, 1);
});

test("second confirm in already allowlisted file fails when expectedCount is 1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-dup-confirm-"));
  const files = [
    writeSource(
      dir,
      "components/events-list-view.tsx",
      "if (window.confirm('one')) {}\nif (window.confirm('two')) {}\n",
    ),
  ];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, [
      exception("components/events-list-view.tsx", "confirm", "legacy complete"),
    ]),
    files,
  });
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /Native-dialog count mismatch: components\/events-list-view.tsx : confirm expected 1, found 2/,
  );
  assert.equal(result.unexpected.length, 0);
});

test("zero confirms with expectedCount 1 fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-dialogs-zero-confirm-"));
  const files = [writeSource(dir, "components/events-list-view.tsx", "export function List() {}\n")];
  const result = checkNativeDialogs({
    repositoryRoot: dir,
    allowlistPath: writeAllowlist(dir, [
      exception("components/events-list-view.tsx", "confirm", "legacy complete"),
    ]),
    files,
  });
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /Native-dialog count mismatch: components\/events-list-view.tsx : confirm expected 1, found 0/,
  );
  assert.match(
    result.errors.join("\n"),
    /Stale native-dialog allowlist entry: components\/events-list-view.tsx : confirm/,
  );
});

test("parseAllowlist rejects invalid api values", () => {
  const parsed = parseAllowlist(
    JSON.stringify({
      exceptions: [
        { file: "components/foo.tsx", api: "dialog", reason: "no", expectedCount: 1 },
      ],
    }),
  );
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join("\n"), /api must be one of alert, confirm, prompt/);
});

test("parseAllowlist requires a positive integer expectedCount", () => {
  const parsed = parseAllowlist(
    JSON.stringify({
      exceptions: [{ file: "components/foo.tsx", api: "confirm", reason: "legacy" }],
    }),
  );
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join("\n"), /expectedCount must be a positive integer/);
});

test("findDialogCalls ignores javascript:alert XSS fixtures", () => {
  const matches = findDialogCalls('const bad = "javascript:alert(1)";\n');
  assert.deepEqual(matches, []);
});

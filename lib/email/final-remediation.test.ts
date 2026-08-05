import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CredentialDispatchFenceError,
  DEFAULT_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS,
  resolveCredentialDispatchFenceTimeoutMs,
} from "@/lib/auth/credential-dispatch-fence";
import {
  parseEmailCanaryArguments,
  parsePasswordResetQuarantineArguments,
} from "@/lib/email/operational-cli";
import {
  resolvePasswordResetProviderRecipient,
  SensitivePayloadError,
} from "@/lib/email/sensitive-payload";

test("password-reset provider recipient is canonical and authenticated", () => {
  assert.equal(
    resolvePasswordResetProviderRecipient({
      recipientEmail: "  User@Example.COM ",
      recipientEmailNormalized: "user@example.com",
      authenticatedRecipientNormalized: "user@example.com",
    }),
    "user@example.com",
  );
});

test("password-reset provider recipient rejects replacement and malformed identity", () => {
  assert.throws(
    () =>
      resolvePasswordResetProviderRecipient({
        recipientEmail: "other@example.com",
        recipientEmailNormalized: "user@example.com",
        authenticatedRecipientNormalized: "user@example.com",
      }),
    SensitivePayloadError,
  );
  assert.throws(
    () =>
      resolvePasswordResetProviderRecipient({
        recipientEmail: "user@example.com",
        recipientEmailNormalized: " User@Example.com ",
        authenticatedRecipientNormalized: "user@example.com",
      }),
    SensitivePayloadError,
  );
  assert.throws(
    () =>
      resolvePasswordResetProviderRecipient({
        recipientEmail: "usér@example.com",
        recipientEmailNormalized: "user@example.com",
        authenticatedRecipientNormalized: "user@example.com",
      }),
    SensitivePayloadError,
  );
});

test("credential dispatch timeout configuration is bounded and fails closed", () => {
  assert.equal(
    resolveCredentialDispatchFenceTimeoutMs(""),
    DEFAULT_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS,
  );
  assert.equal(resolveCredentialDispatchFenceTimeoutMs("50"), 50);
  assert.equal(resolveCredentialDispatchFenceTimeoutMs("30000"), 30_000);
  for (const invalid of ["0", "49", "30001", "1.5", "invalid"]) {
    assert.throws(
      () => resolveCredentialDispatchFenceTimeoutMs(invalid),
      CredentialDispatchFenceError,
    );
  }
});

test("one-message canary arguments require exactly one strict id", () => {
  assert.deepEqual(
    parseEmailCanaryArguments(["--message-id", "cm1234567890"]),
    { messageId: "cm1234567890" },
  );
  assert.deepEqual(
    parseEmailCanaryArguments(["--message-id=cm1234567890"]),
    { messageId: "cm1234567890" },
  );
  assert.throws(() => parseEmailCanaryArguments([]));
  assert.throws(() =>
    parseEmailCanaryArguments([
      "--message-id",
      "cm1234567890",
      "--message-id",
      "cm0987654321",
    ]),
  );
  assert.throws(() =>
    parseEmailCanaryArguments(["--message-id", "not valid"]),
  );
  assert.throws(() => parseEmailCanaryArguments(["--limit", "10"]));
});

test("quarantine arguments are dry-run by default and strictly bounded", () => {
  assert.deepEqual(parsePasswordResetQuarantineArguments([]), {
    apply: false,
    limit: 100,
  });
  assert.deepEqual(
    parsePasswordResetQuarantineArguments([
      "--apply",
      "--batch-size",
      "25",
    ]),
    { apply: true, limit: 25 },
  );
  assert.throws(() =>
    parsePasswordResetQuarantineArguments(["--batch-size", "0"]),
  );
  assert.throws(() =>
    parsePasswordResetQuarantineArguments(["--batch-size", "501"]),
  );
  assert.throws(() =>
    parsePasswordResetQuarantineArguments(["--apply", "--apply"]),
  );
});

test("operational CLI wrappers propagate only parsed bounded arguments", async () => {
  const canarySource = await readFile(
    path.join(process.cwd(), "scripts", "ops", "email-delivery-canary.ts"),
    "utf8",
  );
  assert.match(canarySource, /messageId:\s*parsed\.messageId/);
  assert.ok(!canarySource.includes("email:delivery:sweep"));

  const quarantineSource = await readFile(
    path.join(
      process.cwd(),
      "scripts",
      "ops",
      "password-reset-backlog-quarantine.ts",
    ),
    "utf8",
  );
  assert.match(quarantineSource, /apply:\s*parsed\.apply/);
  assert.match(quarantineSource, /limit:\s*parsed\.limit/);

  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.equal(
    packageJson.scripts["email:delivery:canary"],
    "tsx scripts/ops/email-delivery-canary.ts",
  );
  assert.equal(
    packageJson.scripts["email:backlog:quarantine"],
    "tsx scripts/ops/password-reset-backlog-quarantine.ts",
  );
});

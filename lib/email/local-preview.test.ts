import assert from "node:assert/strict";
import test from "node:test";

import type { EmailConfig } from "@/lib/email/config";
import {
  isLocalEmailPreviewAvailable,
  LOCAL_EMAIL_PREVIEW_MAX_LIMIT,
  LocalEmailPreviewInputError,
  maskEmailRecipient,
  parseLocalEmailPreviewLimit,
  parseLocalEmailPreviewListQuery,
  parseLocalEmailPreviewType,
} from "@/lib/email/local-preview";

const localConfig: Pick<
  EmailConfig,
  "provider" | "localPreviewEnabled" | "canonicalBaseUrl"
> = {
  provider: "fake",
  localPreviewEnabled: true,
  canonicalBaseUrl: "https://local.negotaitions.ru",
};

test("local email preview is available only for the exact local configuration", () => {
  assert.equal(
    isLocalEmailPreviewAvailable({
      nodeEnv: "development",
      config: localConfig,
    }),
    true,
  );
  assert.equal(
    isLocalEmailPreviewAvailable({
      nodeEnv: "production",
      config: localConfig,
    }),
    false,
  );
  assert.equal(
    isLocalEmailPreviewAvailable({
      nodeEnv: "development",
      config: { ...localConfig, localPreviewEnabled: false },
    }),
    false,
  );
  assert.equal(
    isLocalEmailPreviewAvailable({
      nodeEnv: "development",
      config: { ...localConfig, provider: "disabled" },
    }),
    false,
  );
  assert.equal(
    isLocalEmailPreviewAvailable({
      nodeEnv: "development",
      config: {
        ...localConfig,
        canonicalBaseUrl: "https://negotaitions.ru",
      },
    }),
    false,
  );
});

test("local email preview query accepts only allowlisted types and bounded limits", () => {
  assert.deepEqual(parseLocalEmailPreviewListQuery(new URLSearchParams()), {
    limit: LOCAL_EMAIL_PREVIEW_MAX_LIMIT,
    type: undefined,
  });
  assert.deepEqual(
    parseLocalEmailPreviewListQuery(
      new URLSearchParams({ limit: "1", type: "PASSWORD_RESET" }),
    ),
    { limit: 1, type: "PASSWORD_RESET" },
  );
  assert.equal(parseLocalEmailPreviewLimit("20"), 20);
  assert.equal(
    parseLocalEmailPreviewType("ACCOUNT_RECOVERY_DENIED"),
    "ACCOUNT_RECOVERY_DENIED",
  );

  for (const value of ["0", "21", "1.5", "-1", "all"]) {
    assert.throws(
      () => parseLocalEmailPreviewLimit(value),
      LocalEmailPreviewInputError,
    );
  }
  assert.throws(
    () => parseLocalEmailPreviewType("SYSTEM_TEST"),
    LocalEmailPreviewInputError,
  );
  assert.throws(
    () =>
      parseLocalEmailPreviewListQuery(
        new URLSearchParams({ recipient: "user@example.com" }),
      ),
    LocalEmailPreviewInputError,
  );
});

test("local email preview masks recipients", () => {
  assert.equal(maskEmailRecipient("alice@example.com"), "a***@e***.com");
  assert.equal(maskEmailRecipient("x@localhost"), "****@l***");
  assert.equal(maskEmailRecipient(null), "(unavailable)");
  assert.equal(maskEmailRecipient("invalid"), "***");
});

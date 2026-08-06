import { expect, test } from "@playwright/test";

import { getAdminEnvironmentDisplayGroups } from "../../lib/services/admin-env-display";

test.describe("admin diagnostics env display", () => {
  test("no reversible masking is exposed and secrets serialize as null @smoke", async () => {
    // Reversible prefix/suffix masking leaked key material to every admin
    // session, so the helper was removed rather than tightened.
    const exported: Record<string, unknown> = await import(
      "../../lib/services/admin-env-display"
    );
    expect("maskSecretValue" in exported).toBe(false);

    const groups = getAdminEnvironmentDisplayGroups();
    const secrets = groups
      .flatMap((group) => group.items)
      .filter((item) => item.isSecret);
    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) expect(secret.value).toBeNull();
    expect(JSON.stringify(groups)).not.toMatch(/\*{2,}/);
  });

  test("defaulted runtime values are shown as defaults, not missing", async () => {
    const previous = new Map<string, string | undefined>();
    for (const key of [
      "PASSWORD_RESET_TOKEN_TTL_MINUTES",
      "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
      "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
      "YANDEX_POSTBOX_REGION",
      "YANDEX_POSTBOX_ENDPOINT",
    ]) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
    try {
      const groups = getAdminEnvironmentDisplayGroups();
      const rows = groups.flatMap((group) => group.items);
      expect(rows.find((row) => row.key === "PASSWORD_RESET_TOKEN_TTL_MINUTES")).toMatchObject({
        status: "using_effective_default",
        value: "30",
        valueSource: "default",
      });
      expect(rows.find((row) => row.key === "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS")).toMatchObject({
        status: "using_effective_default",
        value: "60",
        valueSource: "default",
      });
      expect(rows.find((row) => row.key === "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR")).toMatchObject({
        status: "using_effective_default",
        value: "5",
        valueSource: "default",
      });
      expect(rows.find((row) => row.key === "YANDEX_POSTBOX_REGION")).toMatchObject({
        status: "using_effective_default",
        value: "ru-central1",
      });
      expect(rows.find((row) => row.key === "YANDEX_POSTBOX_ENDPOINT")).toMatchObject({
        status: "using_effective_default",
        value: "https://postbox.cloud.yandex.net",
      });
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("diagnostics distinguish applicability, freshness, and secret state @smoke", async () => {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({
      TRUSTED_PROXY_ENABLED: "true",
      EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: undefined,
      YANDEX_DATA_STREAMS_ACCESS_KEY_ID: "access-key-value",
      YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: "secret-key-value",
      YANDEX_POSTBOX_CONFIGURATION_SET: undefined,
    })) {
      previous.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      const groups = getAdminEnvironmentDisplayGroups();
      const rows = groups.flatMap((group) => group.items);
      expect(rows.find((row) => row.key === "TRUSTED_PROXY_ENABLED")).toMatchObject({
        status: "configured",
        value: "true",
      });
      expect(rows.find((row) => row.key === "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED")).toMatchObject({
        status: "disabled_by_design",
        value: "false",
      });
      expect(rows.find((row) => row.key === "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY")).toMatchObject({
        status: "not_applicable",
        value: null,
        isSecret: true,
      });
      expect(rows.find((row) => row.key === "YANDEX_POSTBOX_CONFIGURATION_SET")).toMatchObject({
        status: "not_applicable",
      });
      expect(JSON.stringify(groups)).not.toContain("secret-key-value");
      expect(JSON.stringify(groups)).not.toContain("access-key-value");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("grouped diagnostics cover scoped runtime consumers without obsolete raw rows", async () => {
    const groups = getAdminEnvironmentDisplayGroups();
    const names = groups.map((group) => group.group);

    expect(names).toContain("Database / Auth");
    expect(names).toContain("Password reset");
    expect(names).toContain("Email foundation");
    expect(names).toContain("Provider-event ingestion");

    const rows = groups.flatMap((group) => group.items);
    for (const row of rows) {
      expect(row.consumer).toMatch(/^lib\//);
      expect(row).not.toHaveProperty("rawValue");
      if (row.isSecret) expect(row.value).toBeNull();
    }
    expect(rows.some((row) => row.key === "NEXT_PUBLIC_APP_URL")).toBe(false);
  });
});

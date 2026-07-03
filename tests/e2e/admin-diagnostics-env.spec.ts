import { expect, test } from "@playwright/test";

import {
  getAdminEnvironmentDisplayGroups,
  maskSecretValue,
} from "../../lib/services/admin-env-display";

test.describe("admin diagnostics env display", () => {
  test("secret masking helper masks keys/passwords/tokens", async () => {
    expect(maskSecretValue("sh")).toBe("s********");
    expect(maskSecretValue("abcd1234")).toBe("ab********");
    expect(maskSecretValue("abcdef123456xyz")).toBe("abc********xyz");
  });

  test("non-secret values are shown", async () => {
    const previous = process.env.VOXIMPLANT_SCENARIO_NAME;
    process.env.VOXIMPLANT_SCENARIO_NAME = "neg-conf.main-room";
    try {
      const groups = getAdminEnvironmentDisplayGroups();
      const voximplantGroup = groups.find((group) => group.group === "Voximplant");
      const scenario = voximplantGroup?.items.find(
        (item) => item.key === "VOXIMPLANT_SCENARIO_NAME",
      );
      expect(scenario?.value).toBe("neg-conf.main-room");
    } finally {
      process.env.VOXIMPLANT_SCENARIO_NAME = previous;
    }
  });

  test("grouped diagnostics include Voximplant and Yandex vars", async () => {
    const groups = getAdminEnvironmentDisplayGroups();
    const names = groups.map((group) => group.group);

    expect(names).toContain("Voximplant");
    expect(names).toContain("Yandex SpeechKit");
    expect(names).toContain("Yandex AI / DeepSeek");
  });
});

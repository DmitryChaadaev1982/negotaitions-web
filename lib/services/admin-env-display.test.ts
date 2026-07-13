import assert from "node:assert/strict";
import test from "node:test";

import { getAdminEnvironmentDisplayGroups } from "@/lib/services/admin-env-display";

test("admin env display includes transcript auto-run flag", () => {
  const groups = getAdminEnvironmentDisplayGroups();
  const flatItems = groups.flatMap((group) => group.items);
  assert.equal(
    flatItems.some((item) => item.key === "TRANSCRIPT_ENHANCEMENT_AUTO_RUN"),
    true,
  );
});

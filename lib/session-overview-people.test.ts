import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { resolveSessionOwnerFacilitatorDisplay } from "@/lib/session-overview-people";

test("OVERVIEW-01 facilitator shown when present", () => {
  const display = resolveSessionOwnerFacilitatorDisplay({
    facilitatorId: "user-1",
    facilitatorName: "Anna Facilitator",
    facilitatorEmail: "anna@example.com",
  });
  assert.equal(display.missing, false);
  assert.equal(display.facilitatorLabel, "Anna Facilitator");
  assert.equal(display.facilitatorUserId, "user-1");
});

test("OVERVIEW-02 owner shown when present", () => {
  const display = resolveSessionOwnerFacilitatorDisplay({
    facilitatorId: "user-1",
    facilitatorName: "Anna Facilitator",
    facilitatorEmail: "anna@example.com",
  });
  assert.equal(display.ownerUserId, "user-1");
  assert.equal(display.ownerLabel, "Anna Facilitator");
  assert.equal(display.displayLabel, "Anna Facilitator");
});

test("OVERVIEW-03 missing historical facilitator/owner handled safely", () => {
  const display = resolveSessionOwnerFacilitatorDisplay({
    facilitatorId: "user-missing",
    facilitatorName: null,
    facilitatorEmail: null,
  });
  assert.equal(display.missing, true);
  assert.equal(display.displayLabel, null);
  assert.equal(display.ownerLabel, null);
  assert.equal(display.facilitatorLabel, null);

  const listView = readFileSync(
    join(process.cwd(), "components/sessions-list-view.tsx"),
    "utf8",
  );
  assert.match(listView, /data-testid="session-owner-label"/);
  assert.match(listView, /sessions\.facilitatorOwnerUnknown/);
  assert.doesNotMatch(
    listView,
    /session\.visibility === "PRIVATE" && session\.ownerLabel/,
  );
});

test("OVERVIEW-04 same owner + facilitator remains understandable", () => {
  const display = resolveSessionOwnerFacilitatorDisplay({
    facilitatorId: "user-1",
    facilitatorName: "Same Person",
    facilitatorEmail: "same@example.com",
  });
  assert.equal(display.samePerson, true);
  assert.equal(display.ownerLabel, display.facilitatorLabel);
  assert.equal(display.displayLabel, "Same Person");

  const detailView = readFileSync(
    join(process.cwd(), "components/session-detail-view.tsx"),
    "utf8",
  );
  assert.match(detailView, /data-testid="session-facilitator-owner-label"/);
  assert.match(detailView, /sessions\.facilitatorOwnerLabel/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCredentialMutationHooksForTests,
  runAfterPasswordVerifiedHook,
  runBeforePasswordUpdateHook,
  runBeforeSessionCreateHook,
  setCredentialMutationHooksForTests,
  StaleCredentialError,
} from "@/lib/auth/credential-concurrency";

test("StaleCredentialError has correct name and message", () => {
  const err = new StaleCredentialError();
  assert.equal(err.name, "StaleCredentialError");
  assert.ok(err.message.length > 0);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof StaleCredentialError);
});

test("StaleCredentialError accepts custom message", () => {
  const err = new StaleCredentialError("custom message");
  assert.equal(err.message, "custom message");
  assert.equal(err.name, "StaleCredentialError");
});

test("hooks are no-ops when not set", async () => {
  clearCredentialMutationHooksForTests();
  await assert.doesNotReject(() => runAfterPasswordVerifiedHook());
  await assert.doesNotReject(() => runBeforeSessionCreateHook());
  await assert.doesNotReject(() => runBeforePasswordUpdateHook());
});

test("afterPasswordVerified hook is invoked and can record state", async () => {
  const events: string[] = [];
  setCredentialMutationHooksForTests({
    afterPasswordVerified: () => {
      events.push("afterPasswordVerified");
    },
  });
  try {
    await runAfterPasswordVerifiedHook();
    assert.deepEqual(events, ["afterPasswordVerified"]);
    await runBeforeSessionCreateHook();
    await runBeforePasswordUpdateHook();
    assert.equal(events.length, 1, "only afterPasswordVerified should have fired");
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("beforeSessionCreate hook is invoked and can reject", async () => {
  let called = false;
  setCredentialMutationHooksForTests({
    beforeSessionCreate: async () => {
      called = true;
      throw new StaleCredentialError("injected stale");
    },
  });
  try {
    await assert.rejects(() => runBeforeSessionCreateHook(), StaleCredentialError);
    assert.ok(called);
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("beforePasswordUpdate hook is invoked and can reject", async () => {
  let called = false;
  setCredentialMutationHooksForTests({
    beforePasswordUpdate: async () => {
      called = true;
      throw new StaleCredentialError("injected stale update");
    },
  });
  try {
    await assert.rejects(() => runBeforePasswordUpdateHook(), StaleCredentialError);
    assert.ok(called);
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("clearCredentialMutationHooksForTests restores no-op behaviour", async () => {
  const events: string[] = [];
  setCredentialMutationHooksForTests({
    afterPasswordVerified: () => {
      events.push("a");
    },
    beforeSessionCreate: () => {
      events.push("b");
    },
    beforePasswordUpdate: () => {
      events.push("c");
    },
  });
  clearCredentialMutationHooksForTests();
  await runAfterPasswordVerifiedHook();
  await runBeforeSessionCreateHook();
  await runBeforePasswordUpdateHook();
  assert.equal(events.length, 0);
});

test("login-vs-reset race: afterPasswordVerified barrier allows concurrent reset to win first", async () => {
  /**
   * Simulates the window between password-verification and session-create.
   * A racing reset sets hooks to record the ordering and throws StaleCredentialError
   * to prove the session is rejected.
   *
   * Because this is a pure unit test (no DB), we simulate the race with a barrier
   * function that fires mid-login.
   */
  const events: string[] = [];
  let resetCommitted = false;

  setCredentialMutationHooksForTests({
    afterPasswordVerified: () => {
      events.push("login:afterPasswordVerified");
      // Simulate: reset commits here, bumping credentialGeneration.
      resetCommitted = true;
    },
    beforeSessionCreate: () => {
      events.push("login:beforeSessionCreate");
      if (resetCommitted) {
        throw new StaleCredentialError("credential changed before session create");
      }
    },
  });

  try {
    await runAfterPasswordVerifiedHook();
    await assert.rejects(
      () => runBeforeSessionCreateHook(),
      StaleCredentialError,
    );
    assert.deepEqual(events, ["login:afterPasswordVerified", "login:beforeSessionCreate"]);
    assert.ok(resetCommitted, "reset must have committed before session create");
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("password-change-vs-reset race: beforePasswordUpdate barrier detects stale credential", async () => {
  /**
   * Simulates: authenticated password-change verified old password, then a
   * concurrent reset committed before the hash update fires.
   */
  const events: string[] = [];
  let resetDoneBeforeUpdate = false;

  setCredentialMutationHooksForTests({
    afterPasswordVerified: () => {
      events.push("change:afterPasswordVerified");
    },
    beforePasswordUpdate: () => {
      events.push("change:beforePasswordUpdate");
      if (resetDoneBeforeUpdate) {
        throw new StaleCredentialError("credential changed; update rejected");
      }
    },
  });

  try {
    await runAfterPasswordVerifiedHook();
    // Simulate reset commits here (between verification and update).
    resetDoneBeforeUpdate = true;
    await assert.rejects(
      () => runBeforePasswordUpdateHook(),
      StaleCredentialError,
    );
    assert.deepEqual(events, [
      "change:afterPasswordVerified",
      "change:beforePasswordUpdate",
    ]);
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("afterUserRowLockedForSession hook fires and can pause", async () => {
  let called = false;
  setCredentialMutationHooksForTests({
    afterUserRowLockedForSession: async () => {
      called = true;
    },
  });
  try {
    const { runAfterUserRowLockedForSessionHook } = await import(
      "@/lib/auth/credential-concurrency"
    );
    await runAfterUserRowLockedForSessionHook();
    assert.ok(called);
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("afterUserRowLockedForCredentialMutation hook fires", async () => {
  let called = false;
  setCredentialMutationHooksForTests({
    afterUserRowLockedForCredentialMutation: () => {
      called = true;
    },
  });
  try {
    const { runAfterUserRowLockedForCredentialMutationHook } = await import(
      "@/lib/auth/credential-concurrency"
    );
    await runAfterUserRowLockedForCredentialMutationHook();
    assert.ok(called);
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("hooks can be async and await properly", async () => {
  let asyncDone = false;
  setCredentialMutationHooksForTests({
    afterPasswordVerified: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      asyncDone = true;
    },
  });
  try {
    await runAfterPasswordVerifiedHook();
    assert.ok(asyncDone, "async hook must be awaited");
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

test("successive hook registrations replace the previous set entirely", async () => {
  const first: string[] = [];
  const second: string[] = [];

  setCredentialMutationHooksForTests({
    afterPasswordVerified: () => {
      first.push("first");
    },
  });
  setCredentialMutationHooksForTests({
    afterPasswordVerified: () => {
      second.push("second");
    },
  });

  try {
    await runAfterPasswordVerifiedHook();
    assert.equal(first.length, 0, "first hook must have been replaced");
    assert.equal(second.length, 1);
  } finally {
    clearCredentialMutationHooksForTests();
  }
});

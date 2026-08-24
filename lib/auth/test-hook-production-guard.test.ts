import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  clearCredentialMutationHooksForTests,
  runAfterPasswordVerifiedHook,
  setCredentialMutationHooksForTests,
} from "@/lib/auth/credential-concurrency";
import {
  clearCredentialDispatchFenceHooksForTests,
  setCredentialDispatchFenceHooksForTests,
} from "@/lib/auth/credential-dispatch-fence";
import {
  clearUserSessionCookieWriterForTests,
  setUserSessionCookieWriterForTests,
} from "@/lib/auth/session";
import { setSessionLifecycleConcurrencyHooksForTests } from "@/lib/session-lifecycle-concurrency-hooks";

// `process.env.NODE_ENV` is declared read-only, so mutate through the index
// signature to simulate a production runtime.
const mutableEnv = process.env as Record<string, string | undefined>;

async function withProductionNodeEnv(
  operation: () => Promise<void> | void,
): Promise<void> {
  const original = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    await operation();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(mutableEnv, "NODE_ENV");
    } else {
      mutableEnv.NODE_ENV = original;
    }
  }
}

test("credential mutation hooks refuse installation in production", async () => {
  let invoked = 0;
  await withProductionNodeEnv(() => {
    assert.throws(
      () =>
        setCredentialMutationHooksForTests({
          afterPasswordVerified: () => {
            invoked += 1;
          },
        }),
      /unavailable in production/,
    );
  });
  await runAfterPasswordVerifiedHook();
  assert.equal(invoked, 0);
});

test("credential dispatch fence hooks refuse installation in production", async () => {
  await withProductionNodeEnv(() => {
    assert.throws(
      () =>
        setCredentialDispatchFenceHooksForTests({
          afterFenceAcquired: () => undefined,
        }),
      /unavailable in production/,
    );
  });
});

test("session lifecycle concurrency hooks refuse installation in production", async () => {
  await withProductionNodeEnv(() => {
    assert.throws(
      () =>
        setSessionLifecycleConcurrencyHooksForTests({
          afterAutomaticPolicyDue: () => undefined,
        }),
      /unavailable in production/,
    );
  });
});

test("session cookie test hook keeps its production refusal", async () => {
  await withProductionNodeEnv(() => {
    assert.throws(
      () => setUserSessionCookieWriterForTests(async () => undefined),
      /unavailable in production/,
    );
  });
});

test("test hooks install, run, and clear outside production", async () => {
  let verified = 0;
  let fenced = 0;
  setCredentialMutationHooksForTests({
    afterPasswordVerified: () => {
      verified += 1;
    },
  });
  setCredentialDispatchFenceHooksForTests({
    afterFenceAcquired: () => {
      fenced += 1;
    },
  });
  await runAfterPasswordVerifiedHook();
  assert.equal(verified, 1);

  clearCredentialMutationHooksForTests();
  clearCredentialDispatchFenceHooksForTests();
  clearUserSessionCookieWriterForTests();
  await runAfterPasswordVerifiedHook();
  assert.equal(verified, 1);
  assert.equal(fenced, 0);
});

test("no production runtime path installs an account-security test hook", async () => {
  const setters = [
    "setCredentialMutationHooksForTests",
    "setCredentialDispatchFenceHooksForTests",
    "setUserSessionCookieWriterForTests",
    "setSessionLifecycleConcurrencyHooksForTests",
  ];
  const repoRoot = process.cwd();

  async function productionFiles(directory: string): Promise<string[]> {
    const output: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        entry.name === "generated" ||
        entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".test.tsx")
      ) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        output.push(...(await productionFiles(absolute)));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        output.push(absolute);
      }
    }
    return output;
  }

  const files = [
    ...(await productionFiles(path.join(repoRoot, "app"))),
    ...(await productionFiles(path.join(repoRoot, "lib"))),
  ];
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const setter of setters) {
      if (!source.includes(setter)) continue;
      assert.match(
        source,
        new RegExp(`export function ${setter}`),
        `${file} calls ${setter} outside its definition`,
      );
    }
  }
});

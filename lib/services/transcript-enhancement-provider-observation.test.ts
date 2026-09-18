import assert from "node:assert/strict";
import test from "node:test";

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  notifyEnhancementProviderCall,
  resolveEnhancementProviderCallObserver,
  setEnhancementProviderCallObserver,
  type EnhancementProviderCallObservation,
} from "@/lib/services/transcript-enhancement-provider-observation";

const sample: EnhancementProviderCallObservation = {
  runId: "run-1",
  transcriptId: "tr-1",
  chunkIndex: 0,
  requestStartedAt: "2026-09-15T17:40:24.175Z",
  responseReceivedAt: null,
  httpClass: null,
  schemaValid: null,
  checkpointAccepted: null,
  checkpointRejectionReason: null,
};

test("production default has no provider-call observer", () => {
  setEnhancementProviderCallObserver(null);
  assert.equal(resolveEnhancementProviderCallObserver(), null);
});

test("injected observer wins over the process registry", async () => {
  const seen: string[] = [];
  setEnhancementProviderCallObserver(() => {
    seen.push("registered");
  });
  await notifyEnhancementProviderCall((event) => {
    seen.push(`injected:${event.chunkIndex}`);
  }, sample);
  assert.deepEqual(seen, ["injected:0"]);
  setEnhancementProviderCallObserver(null);
});

test("observer exceptions do not escape notify", async () => {
  await notifyEnhancementProviderCall(() => {
    throw new Error("observer must not fail enhancement");
  }, sample);
});

test("OBS-BIND-01 process-global observer is visible across file-URL and alias imports", async () => {
  const seen: string[] = [];
  setEnhancementProviderCallObserver((event) => {
    seen.push(`alias:${event.runId}:${event.chunkIndex}`);
  });
  const native = (await import(
    pathToFileURL(path.join(process.cwd(), "lib/services/transcript-enhancement-provider-observation.ts")).href
  )) as typeof import("@/lib/services/transcript-enhancement-provider-observation");
  const observer = native.getEnhancementProviderCallObserver();
  assert.equal(typeof observer, "function");
  await native.notifyEnhancementProviderCall(native.resolveEnhancementProviderCallObserver(), {
    ...sample,
    runId: "obs-bind-01",
    chunkIndex: 3,
  });
  assert.deepEqual(seen, ["alias:obs-bind-01:3"]);
  setEnhancementProviderCallObserver(null);
});

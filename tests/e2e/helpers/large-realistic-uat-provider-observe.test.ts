import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { getEnhancementProviderCallObserver, setEnhancementProviderCallObserver } from "@/lib/services/transcript-enhancement-provider-observation";
import { uatProviderObserverHelperHref } from "../../../lib/instrumentation/node-runtime";

import {
  installLargeRealisticUatProviderObserver,
  isLargeRealisticUatProviderObserveEnabled,
  LARGE_UAT_PROVIDER_CALLS_FILE,
  recordLargeUatProviderCallEvent,
} from "./large-realistic-uat-provider-observe";

test("provider observe is off in production and when the UAT flag is unset", () => {
  assert.equal(
    isLargeRealisticUatProviderObserveEnabled({
      NODE_ENV: "production",
      LARGE_REALISTIC_UAT_PROVIDER_OBSERVE: "1",
    }),
    false,
  );
  assert.equal(isLargeRealisticUatProviderObserveEnabled({ NODE_ENV: "development" }), false);
});

test("production cannot install the Large UAT observer", () => {
  setEnhancementProviderCallObserver(null);
  assert.equal(
    installLargeRealisticUatProviderObserver({
      NODE_ENV: "production",
      LARGE_REALISTIC_UAT_PROVIDER_OBSERVE: "1",
    }),
    false,
  );
  assert.equal(getEnhancementProviderCallObserver(), null);
});

test("records a late response and checkpoint rejection without provider text", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "large-uat-observe-"));
  const env = {
    NODE_ENV: "development",
    LARGE_REALISTIC_UAT_PROVIDER_OBSERVE: "1",
    LARGE_REALISTIC_UAT_PROVIDER_OBSERVE_DIR: dir,
  };
  const wrote = await recordLargeUatProviderCallEvent(
    {
      runId: "run-late",
      transcriptId: "tr-1",
      chunkIndex: 9,
      requestStartedAt: "2026-09-15T17:40:24.175Z",
      responseReceivedAt: "2026-09-15T17:40:40.000Z",
      httpClass: null,
      schemaValid: true,
      checkpointAccepted: false,
      checkpointRejectionReason: "execution_not_in_flight",
    },
    env,
  );
  assert.equal(wrote, true);
  const raw = await readFile(path.join(dir, LARGE_UAT_PROVIDER_CALLS_FILE), "utf8");
  assert.equal(raw.includes("execution_not_in_flight"), true);
  assert.equal(raw.includes("cleanedText"), false);
  assert.equal(raw.includes("провайдер"), false);
});

function nativeEval(source: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--no-warnings", "--input-type=module", "-e", source],
      { cwd: process.cwd(), env, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("OBS-ESM-01 native file-URL load of large-realistic-uat-provider-observe.ts succeeds", async () => {
  const href = uatProviderObserverHelperHref();
  const result = await nativeEval(`
    const mod = await import(${JSON.stringify(href)});
    if (typeof mod.installLargeRealisticUatProviderObserver !== "function") {
      throw new Error("missing installLargeRealisticUatProviderObserver");
    }
    if (typeof mod.recordLargeUatProviderCallEvent !== "function") {
      throw new Error("missing recordLargeUatProviderCallEvent");
    }
    console.log("OBS-ESM-01");
  `);
  assert.equal(result.stderr, "", result.stderr);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OBS-ESM-01/u);
});

test("OBS-ESM-02 native observer installs the observation seam without a provider call", async () => {
  const href = uatProviderObserverHelperHref();
  const observationHref = pathToFileURL(
    path.join(process.cwd(), "lib/services/transcript-enhancement-provider-observation.ts"),
  ).href;
  const dir = await mkdtemp(path.join(tmpdir(), "obs-esm-"));
  const result = await nativeEval(`
    process.env.NODE_ENV = "development";
    process.env.LARGE_REALISTIC_UAT_PROVIDER_OBSERVE = "1";
    process.env.LARGE_REALISTIC_UAT_PROVIDER_OBSERVE_DIR = ${JSON.stringify(dir)};
    const observe = await import(${JSON.stringify(href)});
    const seam = await import(${JSON.stringify(observationHref)});
    const installed = observe.installLargeRealisticUatProviderObserver(
      process.env,
      seam.setEnhancementProviderCallObserver,
    );
    if (installed !== true) throw new Error("expected observer install");
    if (typeof seam.getEnhancementProviderCallObserver() !== "function") {
      throw new Error("expected observation seam");
    }
    const wrote = await observe.recordLargeUatProviderCallEvent({
      runId: "obs-esm-02",
      transcriptId: "tr-obs-esm",
      chunkIndex: 0,
      requestStartedAt: null,
      responseReceivedAt: null,
      httpClass: null,
      schemaValid: null,
      checkpointAccepted: null,
      checkpointRejectionReason: null,
    });
    if (wrote !== true) throw new Error("expected local jsonl write");
    console.log("OBS-ESM-02");
  `);
  assert.equal(result.stderr, "", result.stderr);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OBS-ESM-02/u);
  const raw = await readFile(path.join(dir, LARGE_UAT_PROVIDER_CALLS_FILE), "utf8");
  assert.equal(raw.includes("obs-esm-02"), true);
  assert.equal(raw.includes("yandex"), false);
  assert.equal(raw.includes("https://"), false);
});

test("OBS-JSONL-01 production notify seam writes start and completion for the same runId", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "obs-jsonl-"));
  const env = {
    NODE_ENV: "development",
    LARGE_REALISTIC_UAT_PROVIDER_OBSERVE: "1",
    LARGE_REALISTIC_UAT_PROVIDER_OBSERVE_DIR: dir,
  };
  setEnhancementProviderCallObserver(async (event) => {
    await recordLargeUatProviderCallEvent(event, env);
  });
  const observationHref = pathToFileURL(
    path.join(process.cwd(), "lib/services/transcript-enhancement-provider-observation.ts"),
  ).href;
  const providerGraph = (await import(observationHref)) as typeof import("@/lib/services/transcript-enhancement-provider-observation");
  const start = {
    runId: "obs-jsonl-01",
    transcriptId: "tr-obs-jsonl",
    chunkIndex: 4,
    requestStartedAt: "2026-09-17T15:32:57.885Z",
    responseReceivedAt: null,
    httpClass: null,
    schemaValid: null,
    checkpointAccepted: true,
    checkpointRejectionReason: null,
  };
  const complete = {
    ...start,
    responseReceivedAt: "2026-09-17T15:33:12.000Z",
    httpClass: "2xx",
    schemaValid: true,
    checkpointAccepted: false,
    checkpointRejectionReason: "execution_not_in_flight",
  };
  await providerGraph.notifyEnhancementProviderCall(
    providerGraph.resolveEnhancementProviderCallObserver(),
    start,
  );
  await providerGraph.notifyEnhancementProviderCall(
    providerGraph.resolveEnhancementProviderCallObserver(),
    complete,
  );
  const raw = await readFile(path.join(dir, LARGE_UAT_PROVIDER_CALLS_FILE), "utf8");
  const rows = raw
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line) as typeof start);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.runId, "obs-jsonl-01");
  assert.equal(rows[0]?.requestStartedAt, start.requestStartedAt);
  assert.equal(rows[0]?.responseReceivedAt, null);
  assert.equal(rows[1]?.runId, "obs-jsonl-01");
  assert.equal(rows[1]?.responseReceivedAt, complete.responseReceivedAt);
  assert.equal(rows[1]?.checkpointAccepted, false);
  assert.equal(raw.includes("yandex"), false);
  setEnhancementProviderCallObserver(null);
});

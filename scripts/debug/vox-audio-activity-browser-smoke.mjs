#!/usr/bin/env node
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { chromium } from "@playwright/test";
import pg from "pg";

const { Pool } = pg;

const DEFAULTS = {
  url: "https://local.negotaitions.ru/room/cmr96oy370000b0uaqk0oyaoe?debugRecording=1",
  secondUrl: null,
  sessionId: "cmr96oy370000b0uaqk0oyaoe",
  durationMs: 45_000,
  headed: true,
  fakeMic: false,
  profileDir: ".debug/playwright-vox-profile",
  secondProfileDir: ".debug/playwright-vox-profile-2",
  labelA: "A",
  labelB: "B",
  outDir: ".debug/vox-audio-activity",
};

const MANUAL_STAGE_WINDOWS = [
  { fromSec: 0, toSec: 10, label: "0-10s: setup/silence" },
  { fromSec: 10, toSec: 25, label: "10-25s: A speaks, B muted" },
  { fromSec: 25, toSec: 35, label: "25-35s: silence" },
  { fromSec: 35, toSec: 50, label: "35-50s: B speaks, A muted" },
  { fromSec: 50, toSec: 60, label: "50-60s: silence" },
  { fromSec: 60, toSec: 75, label: "60-75s: A speaks, B muted" },
  { fromSec: 75, toSec: 90, label: "75-90s: B speaks, A muted" },
];

function printUsage() {
  console.log(`
Usage:
  node scripts/debug/vox-audio-activity-browser-smoke.mjs [options]

Options:
  --url <url>
  --second-url <url>
  --session-id <id>
  --duration-ms <number>
  --headed <true|false>
  --fake-mic
  --real-mic
  --profile-dir <path>
  --second-profile-dir <path>
  --label-a <label>
  --label-b <label>
  --out-dir <path>
`);
}

function parseBool(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, sessionIdProvided: false };
  const args = [...argv];

  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }

    if (token === "--fake-mic") {
      options.fakeMic = true;
      options.headed = true;
      continue;
    }

    if (token === "--real-mic") {
      options.fakeMic = false;
      options.headed = true;
      continue;
    }

    const value = args.shift();
    if (value === undefined) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    if (token === "--url") {
      options.url = value;
      continue;
    }
    if (token === "--second-url") {
      options.secondUrl = value;
      continue;
    }
    if (token === "--session-id") {
      options.sessionId = value;
      options.sessionIdProvided = true;
      continue;
    }
    if (token === "--duration-ms") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --duration-ms value: ${value}`);
      }
      options.durationMs = Math.floor(parsed);
      continue;
    }
    if (token === "--headed") {
      options.headed = parseBool(value, options.headed);
      continue;
    }
    if (token === "--profile-dir") {
      options.profileDir = value;
      continue;
    }
    if (token === "--second-profile-dir") {
      options.secondProfileDir = value;
      continue;
    }
    if (token === "--label-a") {
      options.labelA = value;
      continue;
    }
    if (token === "--label-b") {
      options.labelB = value;
      continue;
    }
    if (token === "--out-dir") {
      options.outDir = value;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function parseRoomSessionId(pathname) {
  const match = pathname.match(/^\/room\/([^/]+)$/);
  return match ? match[1] : null;
}

function validateTarget(options) {
  let parsedUrl;
  try {
    parsedUrl = new URL(options.url);
  } catch (error) {
    return {
      isValid: false,
      isRoomUrl: false,
      pathname: null,
      urlSessionId: null,
      providedSessionId: options.sessionId,
      effectiveSessionId: options.sessionId,
      error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const pathname = parsedUrl.pathname;
  const isRoomUrl = pathname.startsWith("/room/");
  const urlSessionId = parseRoomSessionId(pathname);
  const providedSessionId = options.sessionId;

  if (!isRoomUrl || !urlSessionId) {
    return {
      isValid: false,
      isRoomUrl: false,
      pathname,
      urlSessionId,
      providedSessionId,
      effectiveSessionId: providedSessionId,
      error: `Invalid telemetry smoke URL: expected /room/<sessionId>, got ${pathname}.`,
    };
  }

  if (options.sessionIdProvided && providedSessionId !== urlSessionId) {
    return {
      isValid: false,
      isRoomUrl: true,
      pathname,
      urlSessionId,
      providedSessionId,
      effectiveSessionId: providedSessionId,
      error: `Session ID mismatch: --session-id=${providedSessionId} but URL has ${urlSessionId}.`,
    };
  }

  return {
    isValid: true,
    isRoomUrl: true,
    pathname,
    urlSessionId,
    providedSessionId,
    effectiveSessionId: options.sessionIdProvided ? providedSessionId : urlSessionId,
    error: null,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function safeStamp(isoString) {
  return isoString.replace(/[:.]/g, "-");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getManualStageLabel(elapsedMs) {
  const elapsedSec = elapsedMs / 1000;
  const stage = MANUAL_STAGE_WINDOWS.find(
    (item) => elapsedSec >= item.fromSec && elapsedSec < item.toSec,
  );
  if (!stage) return "outside-manual-window";
  return stage.label;
}

function toAbsolutePath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

async function readResponseBody(response) {
  try {
    const text = await response.text();
    if (text.length > 16_000) {
      return `${text.slice(0, 16_000)}\n...[truncated ${text.length - 16_000} chars]`;
    }
    return text;
  } catch (error) {
    return `[unavailable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

async function waitForCaptureStartOrCountdown() {
  console.log("Open both browsers, start recording manually, then press Enter to start capture.");
  console.log("If Enter is not pressed, capture starts automatically after a 10-second countdown.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let stdinDone = false;
  try {
    const waitForEnter = rl.question("").then(() => {
      stdinDone = true;
      return "enter";
    });
    const waitForCountdown = (async () => {
      for (let sec = 10; sec > 0; sec -= 1) {
        console.log(`Capture starts in ${sec}s...`);
        await delay(1_000);
      }
      return "countdown";
    })();
    return await Promise.race([waitForEnter, waitForCountdown]);
  } finally {
    if (!stdinDone) {
      rl.write("\n");
    }
    rl.close();
  }
}

function clampString(value, max = 4_000) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated ${value.length - max} chars]`;
}

function normalizeBlockReason(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.toLowerCase() === "none") return null;
  return text;
}

function createWavTone({
  filePath,
  durationMs = 8_000,
  sampleRate = 16_000,
  frequencyHz = 440,
  amplitude = 0.2,
}) {
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor((durationMs / 1_000) * sampleRate);
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t);
    const int16 = Math.max(-1, Math.min(1, sample * amplitude)) * 0x7fff;
    buffer.writeInt16LE(int16 | 0, 44 + i * 2);
  }

  return fs.writeFile(filePath, buffer);
}

function readDebugField(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  return snapshot[key];
}

function deriveMicChanged(snapshots) {
  const numeric = snapshots
    .map((item) => readDebugField(item.debug, "micLevel"))
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (numeric.length < 2) return false;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  return Math.abs(max - min) > 0.01;
}

async function captureDebugSnapshot(page) {
  const snapshotResult = await page.evaluate(() => {
    const currentUrl = window.location.href;
    const debugObj = window.__voxSpeakingTrackerDebug;
    if (debugObj === undefined) {
      return { present: false, debug: null, currentUrl };
    }

    let safeCopy = debugObj;
    try {
      safeCopy = JSON.parse(JSON.stringify(debugObj));
    } catch {
      safeCopy = debugObj;
    }

    return { present: true, debug: safeCopy, currentUrl };
  });
  return {
    ts: nowIso(),
    ...snapshotResult,
  };
}

async function runPreflight(page, report, { timeoutMs = 30_000, pollMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const observed = {
    debugSamples: 0,
    disabledSamples: 0,
    localMissingSamples: 0,
    participantMissingSamples: 0,
    latestBlockReason: null,
  };

  while (Date.now() < deadline) {
    let snapshot;
    try {
      snapshot = await captureDebugSnapshot(page);
    } catch (error) {
      snapshot = {
        ts: nowIso(),
        present: false,
        debug: null,
        pollError: error instanceof Error ? error.message : String(error),
      };
    }
    snapshot.phase = "preflight";
    report.debugSnapshots.push(snapshot);

    const debug = snapshot.present && snapshot.debug && typeof snapshot.debug === "object" ? snapshot.debug : null;
    if (debug) {
      observed.debugSamples += 1;
      const blockReason = normalizeBlockReason(readDebugField(debug, "blockReason"));
      observed.latestBlockReason = blockReason;
      if (blockReason === "disabled") observed.disabledSamples += 1;
      if (
        readDebugField(debug, "localAudioStreamPresent") !== true ||
        blockReason === "local-stream-missing"
      ) {
        observed.localMissingSamples += 1;
      }
      const participantId = readDebugField(debug, "sessionParticipantId");
      if (
        !(typeof participantId === "string" && participantId.length > 0) ||
        blockReason === "participant-id-missing"
      ) {
        observed.participantMissingSamples += 1;
      }

      const hasParticipantId = typeof participantId === "string" && participantId.length > 0;
      const hasLocalStream = readDebugField(debug, "localAudioStreamPresent") === true;
      const hasClearBlockReason = blockReason === null;
      if (hasParticipantId && hasLocalStream && hasClearBlockReason) {
        return {
          status: "passed",
          classification: "PRECHECK_PASSED",
          reason: "preflight requirements satisfied",
          elapsedMs: timeoutMs - Math.max(0, deadline - Date.now()),
          observed,
          latestDebug: debug,
        };
      }
    }

    await delay(pollMs);
  }

  let classification = "PRECHECK_FAILED_TIMEOUT";
  let reason = "preflight timed out before ready state";
  if (observed.debugSamples > 0 && observed.disabledSamples === observed.debugSamples) {
    classification = "PRECHECK_FAILED_DISABLED";
    reason = "blockReason=disabled for entire preflight window";
  } else if (
    observed.debugSamples > 0 &&
    observed.localMissingSamples > 0 &&
    observed.localMissingSamples === observed.debugSamples
  ) {
    classification = "PRECHECK_FAILED_LOCAL_STREAM";
    reason = "local audio stream missing during preflight window";
  } else if (
    observed.debugSamples > 0 &&
    observed.participantMissingSamples > 0 &&
    observed.participantMissingSamples === observed.debugSamples
  ) {
    classification = "PRECHECK_FAILED_PARTICIPANT_ID";
    reason = "participant id missing during preflight window";
  } else if (observed.debugSamples === 0) {
    classification = "PRECHECK_FAILED_DEBUG_OBJECT";
    reason = "window.__voxSpeakingTrackerDebug not found during preflight window";
  }

  return {
    status: "failed",
    classification,
    reason,
    elapsedMs: timeoutMs,
    observed,
    latestDebug: null,
  };
}

function classify(report) {
  const snapshots = report.debugSnapshots;
  const presentSnapshots = snapshots.filter((item) => item.present && item.debug && typeof item.debug === "object");
  const trackerPresent = presentSnapshots.length > 0;
  const latestDebug = presentSnapshots[presentSnapshots.length - 1]?.debug ?? null;
  const blockReasons = presentSnapshots
    .map((item) => readDebugField(item.debug, "blockReason"))
    .filter((value) => typeof value === "string" && value.length > 0);
  const lastBlockReason = blockReasons[blockReasons.length - 1] ?? null;
  const enabledValues = presentSnapshots
    .map((item) => readDebugField(item.debug, "enabled"))
    .filter((value) => typeof value === "boolean");
  const anyEnabledFalse = enabledValues.includes(false);
  const localAudioTrue = presentSnapshots.some((item) => readDebugField(item.debug, "localAudioStreamPresent") === true);
  const sessionParticipantIdPresent = presentSnapshots.some((item) => {
    const value = readDebugField(item.debug, "sessionParticipantId");
    return typeof value === "string" && value.length > 0;
  });
  const speakingTrue = presentSnapshots.some((item) => readDebugField(item.debug, "speaking") === true);
  const micLevelChanged = deriveMicChanged(presentSnapshots);
  const audioPosts = report.audioActivityRequests;
  const anyAudioPost = audioPosts.length > 0;
  const anyAudioPostFailure = audioPosts.some(
    (item) => typeof item.status === "number" && item.status >= 400,
  );
  const anyAudioPost2xx = audioPosts.some(
    (item) => typeof item.status === "number" && item.status >= 200 && item.status < 300,
  );
  const dbRows = Number(report.db?.count ?? 0);

  let category = "L";

  if (!trackerPresent) category = "A";
  else if (lastBlockReason === "local-stream-missing") category = "C";
  else if (lastBlockReason === "participant-id-missing") category = "D";
  else if (lastBlockReason === "disabled") category = "E";
  else if (anyEnabledFalse) category = "B";
  else if (anyAudioPostFailure) category = "I";
  else if (anyAudioPost2xx && dbRows === 0) category = "J";
  else if (dbRows > 0) category = "K";
  else if (speakingTrue && !anyAudioPost) category = "H";
  else if (!lastBlockReason && !micLevelChanged) category = "F";
  else if (micLevelChanged && !speakingTrue) category = "G";

  return {
    category,
    facts: {
      trackerPresent,
      localAudioTrue,
      sessionParticipantIdPresent,
      micLevelChanged,
      speakingTrue,
      anyAudioPost,
      lastAudioPostStatus: audioPosts[audioPosts.length - 1]?.status ?? null,
      lastAudioPostResponse: audioPosts[audioPosts.length - 1]?.responseBody ?? null,
      dbRows,
      lastBlockReason,
      latestDebug,
    },
  };
}

function summarize(report, classification) {
  const facts = classification.facts;
  const preflightStatus = report.preflight?.status ?? "not-run";
  const preflightClassification = report.preflight?.classification ?? "n/a";
  const preflightReason = report.preflight?.reason ?? "n/a";
  return [
    `Session ID: ${report.sessionId}`,
    `URL: ${report.url}`,
    `Started: ${report.startedAt}`,
    `Ended: ${report.endedAt}`,
    "",
    "Target URL validation:",
    `isRoomUrl: ${report.urlValidation?.isRoomUrl === true ? "true" : "false"}`,
    `urlSessionId: ${report.urlValidation?.urlSessionId ?? "n/a"}`,
    `providedSessionId: ${report.urlValidation?.providedSessionId ?? "n/a"}`,
    `urlValidationError: ${report.urlValidation?.error ?? "none"}`,
    "",
    "Preflight:",
    `status: ${preflightStatus}`,
    `classification: ${preflightClassification}`,
    `reason: ${preflightReason}`,
    "",
    "Answers:",
    `1. Was window.__voxSpeakingTrackerDebug present? ${facts.trackerPresent ? "yes" : "no"}`,
    `2. Was localAudioStreamPresent true? ${facts.localAudioTrue ? "yes" : "no"}`,
    `3. Was sessionParticipantId present? ${facts.sessionParticipantIdPresent ? "yes" : "no"}`,
    `4. Did micLevel change while speaking? ${facts.micLevelChanged ? "yes" : "no"}`,
    `5. Did POST /audio-activity appear? ${facts.anyAudioPost ? "yes" : "no"}`,
    `6. What was POST status/response? status=${facts.lastAudioPostStatus ?? "n/a"} response=${clampString(String(facts.lastAudioPostResponse ?? "n/a"), 300)}`,
    `7. Did DB rows appear? ${facts.dbRows > 0 ? `yes (${facts.dbRows})` : "no (0)"}`,
    `8. Exact likely break point: ${classification.category}`,
    "",
    `Primary classification: ${classification.category}`,
    `Last blockReason: ${facts.lastBlockReason ?? "none"}`,
    `Audio activity requests captured: ${report.audioActivityRequests.length}`,
    `Debug snapshots captured: ${report.debugSnapshots.length}`,
    `Failed requests captured: ${report.failedRequests.length}`,
    "",
    "Category legend:",
    "preflight_failed preflight requirements were not satisfied; A-L classification is skipped",
    "A tracker debug object missing / tracker not mounted",
    "B tracker mounted but enabled=false",
    "C tracker mounted but blockReason=local-stream-missing",
    "D tracker mounted but blockReason=participant-id-missing",
    "E tracker mounted but blockReason=disabled",
    "F tracker mounted, no blockReason, but micLevel never changes",
    "G micLevel changes, but speaking never becomes true",
    "H speaking becomes true, but no POST /audio-activity",
    "I POST /audio-activity sent but route returns 4xx/5xx",
    "J POST /audio-activity returns 2xx but DB rows remain 0",
    "K DB rows appear; previous failure was stale/runtime/session-specific",
    "L inconclusive",
  ].join("\n");
}

function buildClassification(report) {
  if (!report.urlValidation?.isValid) {
    return {
      category: "invalid_target",
      facts: {
        trackerPresent: false,
        localAudioTrue: false,
        sessionParticipantIdPresent: false,
        micLevelChanged: false,
        speakingTrue: false,
        anyAudioPost: false,
        lastAudioPostStatus: null,
        lastAudioPostResponse: null,
        dbRows: 0,
        lastBlockReason: null,
        latestDebug: null,
      },
    };
  }
  if (report.preflight?.status === "failed") {
    const latestDebug = report.preflight?.latestDebug ?? null;
    return {
      category: "preflight_failed",
      preflightCategory: report.preflight.classification,
      facts: {
        trackerPresent: !!latestDebug,
        localAudioTrue: readDebugField(latestDebug, "localAudioStreamPresent") === true,
        sessionParticipantIdPresent:
          typeof readDebugField(latestDebug, "sessionParticipantId") === "string" &&
          readDebugField(latestDebug, "sessionParticipantId").length > 0,
        micLevelChanged: deriveMicChanged(report.debugSnapshots),
        speakingTrue: readDebugField(latestDebug, "speaking") === true,
        anyAudioPost: false,
        lastAudioPostStatus: null,
        lastAudioPostResponse: null,
        dbRows: 0,
        lastBlockReason: normalizeBlockReason(readDebugField(latestDebug, "blockReason")),
        latestDebug,
      },
    };
  }
  return classify(report);
}

async function queryDb(sessionId) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      ok: false,
      error: "DATABASE_URL is not set",
      count: 0,
      grouped: [],
      rawIntervals: [],
    };
  }

  const pool = new Pool({ connectionString: dbUrl });
  try {
    const countResult = await pool.query(
      `select count(*)::int as count
       from "SessionParticipantAudioActivity"
       where "sessionId" = $1`,
      [sessionId],
    );
    let groupedResult;
    let rawResult;
    try {
      groupedResult = await pool.query(
        `select "sessionParticipantId",
                count(*)::int as intervals,
                min("startMs") as first_start_ms,
                max("endMs") as last_end_ms,
                sum(greatest(0, "endMs" - "startMs"))::bigint as total_activity_ms,
                round(avg(greatest(0, "endMs" - "startMs")))::bigint as avg_activity_ms
         from "SessionParticipantAudioActivity"
         where "sessionId" = $1
         group by "sessionParticipantId"
         order by intervals desc`,
        [sessionId],
      );
      rawResult = await pool.query(
        `select "sessionParticipantId",
                "startMs",
                "endMs",
                greatest(0, "endMs" - "startMs") as duration_ms,
                "createdAt"
         from "SessionParticipantAudioActivity"
         where "sessionId" = $1
         order by "startMs", "createdAt"`,
        [sessionId],
      );
    } catch {
      groupedResult = await pool.query(
        `select "sessionParticipantId",
                count(*)::int as intervals,
                min("startedOffsetSeconds") as first_start_ms,
                max("endedOffsetSeconds") as last_end_ms,
                round(sum(greatest(0, extract(epoch from (coalesce("endedAt","startedAt") - "startedAt")) * 1000)))::bigint as total_activity_ms,
                round(avg(greatest(0, extract(epoch from (coalesce("endedAt","startedAt") - "startedAt")) * 1000)))::bigint as avg_activity_ms
         from "SessionParticipantAudioActivity"
         where "sessionId" = $1
         group by "sessionParticipantId"
         order by intervals desc`,
        [sessionId],
      );
      rawResult = await pool.query(
        `select "sessionParticipantId",
                "startedOffsetSeconds",
                "endedOffsetSeconds",
                round(greatest(0, extract(epoch from (coalesce("endedAt","startedAt") - "startedAt")) * 1000))::bigint as duration_ms,
                "startedAt",
                "endedAt",
                "createdAt"
         from "SessionParticipantAudioActivity"
         where "sessionId" = $1
         order by "startedOffsetSeconds", "createdAt"`,
        [sessionId],
      );
    }

    return {
      ok: true,
      count: Number(countResult.rows[0]?.count ?? 0),
      grouped: groupedResult.rows,
      rawIntervals: rawResult.rows,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      count: 0,
      grouped: [],
      rawIntervals: [],
    };
  } finally {
    await pool.end();
  }
}

async function waitForLoginAndContinue(page, targetUrl) {
  if (!page.url().includes("/login")) {
    return;
  }

  console.log('Log in in the opened browser, then press Enter in terminal.');
  console.log("Auto-continue will trigger after login redirect.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let stdinDone = false;
  try {
    const waitForEnter = rl.question("").then(() => {
      stdinDone = true;
      return "enter";
    });
    const waitForLoginRedirect = (async () => {
      for (let i = 0; i < 600; i += 1) {
        if (!page.url().includes("/login")) return "redirect";
        await delay(1_000);
      }
      return "timeout";
    })();
    const winner = await Promise.race([waitForEnter, waitForLoginRedirect]);
    if (winner === "timeout") {
      throw new Error("Login wait timed out after 10 minutes.");
    }
  } finally {
    if (!stdinDone) {
      rl.write("\n");
    }
    rl.close();
  }
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

function routeCategory(url, sessionId) {
  const target = `/api/sessions/${sessionId}`;
  if (url.includes(`${target}/audio-activity`)) return "audioActivity";
  if (url.includes(`${target}/voximplant/access`)) return "voximplantAccess";
  if (url.includes(`${target}/control-state`)) return "controlState";
  if (url.includes("/api/livekit/sidebar")) return "livekitSidebar";
  if (url.includes("/recording-control")) return "recordingControl";
  if (url.includes("voximplant")) return "voximplantDomain";
  return null;
}

function createBrowserReport(label, targetUrl, sessionId) {
  return {
    label,
    url: targetUrl,
    sessionId,
    preflight: null,
    debugSnapshots: [],
    trackedRequests: [],
    audioActivityRequests: [],
    failedRequests: [],
    pageErrors: [],
    consoleEvents: [],
    summary: null,
    classification: null,
  };
}

function deriveBrowserFacts(browserReport) {
  const snapshots = browserReport.debugSnapshots;
  const presentSnapshots = snapshots.filter((item) => item.present && item.debug && typeof item.debug === "object");
  const latestDebug = presentSnapshots[presentSnapshots.length - 1]?.debug ?? null;
  const latestSnapshot = snapshots[snapshots.length - 1] ?? null;
  const micLevelValues = presentSnapshots
    .map((item) => readDebugField(item.debug, "micLevel"))
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const speakingTrue = presentSnapshots.some(
    (item) => readDebugField(item.debug, "speaking") === true,
  );
  const micLevelChanged = deriveMicChanged(presentSnapshots);
  const sessionParticipantId = readDebugField(latestDebug, "sessionParticipantId") ?? null;
  const participantIdentity = readDebugField(latestDebug, "participantIdentity") ?? null;
  const localAudioStreamPresent =
    readDebugField(latestDebug, "localAudioStreamPresent") === true;
  const enabled = readDebugField(latestDebug, "enabled") === true;
  const muted = readDebugField(latestDebug, "muted") === true;
  const blockReason = normalizeBlockReason(readDebugField(latestDebug, "blockReason"));
  const intervalOpen = readDebugField(latestDebug, "intervalOpen") === true;
  const speakingCurrent = readDebugField(latestDebug, "speaking") === true;
  const postCount = Number(
    readDebugField(latestDebug, "postCount") ??
      browserReport.audioActivityRequests.length,
  );
  const lastReq =
    browserReport.audioActivityRequests[browserReport.audioActivityRequests.length - 1] ??
    null;
  const consoleWarnings = browserReport.consoleEvents.filter((event) => event.type === "warning").length;
  const consoleErrors = browserReport.consoleEvents.filter((event) => event.type === "error").length;
  return {
    currentUrl: latestSnapshot?.currentUrl ?? browserReport.url,
    trackerDebugPresent: presentSnapshots.length > 0,
    participantIdentity: typeof participantIdentity === "string" ? participantIdentity : null,
    sessionParticipantId:
      typeof sessionParticipantId === "string" ? sessionParticipantId : null,
    enabled,
    blockReason,
    localAudioStreamPresent,
    muted,
    micLevelChanged,
    micLevelCurrent:
      micLevelValues.length > 0 ? micLevelValues[micLevelValues.length - 1] : null,
    speakingTrue,
    speakingCurrent,
    intervalOpen,
    micLevelMin: micLevelValues.length ? Math.min(...micLevelValues) : null,
    micLevelMax: micLevelValues.length ? Math.max(...micLevelValues) : null,
    postCount,
    lastPostPayload: lastReq?.postData ?? null,
    lastPostStatus: lastReq?.status ?? readDebugField(latestDebug, "lastPostStatus") ?? null,
    lastPostResponse:
      lastReq?.responseBody ??
      readDebugField(latestDebug, "lastPostResponse") ??
      null,
    audioActivityRequestCount: browserReport.audioActivityRequests.length,
    failedRequestCount: browserReport.failedRequests.length,
    consoleWarningCount: consoleWarnings,
    consoleErrorCount: consoleErrors,
  };
}

function classifyDualBrowser(browserReport, facts, dbGroupedRows) {
  if (browserReport.preflight?.status === "failed") {
    return browserReport.preflight.classification;
  }
  if (!facts.localAudioStreamPresent) return "PRECHECK_FAILED_LOCAL_STREAM";
  if (!facts.sessionParticipantId) return "PRECHECK_FAILED_PARTICIPANT_ID";
  if (!facts.enabled || facts.blockReason === "disabled") return "PRECHECK_FAILED_DISABLED";
  if (!facts.micLevelChanged) return "MIC_LEVEL_ZERO";
  if (facts.audioActivityRequestCount === 0) return "NO_POST";
  if (
    typeof facts.lastPostStatus === "number" &&
    (facts.lastPostStatus < 200 || facts.lastPostStatus >= 300)
  ) {
    return "POST_REJECTED";
  }
  const participantRow = facts.sessionParticipantId
    ? dbGroupedRows.find((row) => row.sessionParticipantId === facts.sessionParticipantId)
    : null;
  const rowsForParticipant = Number(participantRow?.intervals ?? 0);
  const avgActivityMs = Number(participantRow?.avg_activity_ms ?? 0);
  if (rowsForParticipant === 0) return "DB_MISSING";
  if (rowsForParticipant > 0 && avgActivityMs > 0 && avgActivityMs <= 10) {
    return "J_MICRO_FRAGMENTS";
  }
  if (!facts.speakingTrue) return "SPEAKING_NEVER_TRUE";
  return `${browserReport.label}_OK_POSTING`;
}

function summarizeDualReport(report) {
  const lines = [
    `Session ID: ${report.sessionId}`,
    `Primary URL: ${report.url}`,
    `Second URL: ${report.secondUrl}`,
    `Started: ${report.startedAt}`,
    `Ended: ${report.endedAt}`,
    "",
    "Manual stage timer:",
    ...MANUAL_STAGE_WINDOWS.map((stage) => stage.label),
    "",
  ];
  for (const browser of report.browsers) {
    const facts = browser.summary;
    lines.push(`[${browser.label}]`);
    lines.push(`classification: ${browser.classification}`);
    lines.push(`currentUrl: ${facts.currentUrl ?? "n/a"}`);
    lines.push(`trackerDebugPresent: ${facts.trackerDebugPresent ? "true" : "false"}`);
    lines.push(`participantIdentity: ${facts.participantIdentity ?? "n/a"}`);
    lines.push(`sessionParticipantId: ${facts.sessionParticipantId ?? "n/a"}`);
    lines.push(`enabled: ${facts.enabled ? "true" : "false"}`);
    lines.push(`blockReason: ${facts.blockReason ?? "none"}`);
    lines.push(
      `localAudioStreamPresent: ${facts.localAudioStreamPresent ? "true" : "false"}`,
    );
    lines.push(`muted: ${facts.muted ? "true" : "false"}`);
    lines.push(`micLevelChanged: ${facts.micLevelChanged ? "true" : "false"}`);
    lines.push(`micLevelCurrent: ${facts.micLevelCurrent ?? "n/a"}`);
    lines.push(`micLevelMax: ${facts.micLevelMax ?? "n/a"}`);
    lines.push(`speakingBecameTrue: ${facts.speakingTrue ? "true" : "false"}`);
    lines.push(`speakingCurrent: ${facts.speakingCurrent ? "true" : "false"}`);
    lines.push(`intervalOpen: ${facts.intervalOpen ? "true" : "false"}`);
    lines.push(`postCount: ${facts.postCount}`);
    lines.push(
      `lastPostPayload: ${clampString(String(facts.lastPostPayload ?? "n/a"), 240)}`,
    );
    lines.push(
      `lastPostStatus/Response: ${facts.lastPostStatus ?? "n/a"} / ${clampString(String(facts.lastPostResponse ?? "n/a"), 240)}`,
    );
    lines.push(`audioActivityRequestCount: ${facts.audioActivityRequestCount}`);
    lines.push(`failedRequestCount: ${facts.failedRequestCount}`);
    lines.push(`consoleWarningCount: ${facts.consoleWarningCount}`);
    lines.push(`consoleErrorCount: ${facts.consoleErrorCount}`);
    lines.push("");
  }
  lines.push("DB grouped rows:");
  lines.push(JSON.stringify(report.db?.grouped ?? [], null, 2));
  lines.push("");
  lines.push("DB raw intervals:");
  lines.push(JSON.stringify(report.db?.rawIntervals ?? [], null, 2));
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetValidation = validateTarget(options);
  if (!targetValidation.isValid) {
    throw new Error(targetValidation.error);
  }
  options.sessionId = targetValidation.effectiveSessionId;

  const startedAt = nowIso();
  const stamp = safeStamp(startedAt);
  const outputDir = toAbsolutePath(options.outDir);
  const profileDir = toAbsolutePath(options.profileDir);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const report = {
    sessionId: options.sessionId,
    url: options.url,
    urlValidation: targetValidation,
    startedAt,
    endedAt: null,
    options: {
      durationMs: options.durationMs,
      headed: options.headed,
      fakeMic: options.fakeMic,
      profileDir,
      outDir: outputDir,
    },
    consoleEvents: [],
    pageErrors: [],
    failedRequests: [],
    trackedRequests: [],
    audioActivityRequests: [],
    voximplantAccessRequests: [],
    controlStateRequests: [],
    livekitSidebarRequests: [],
    recordingControlRequests: [],
    voximplantDomainRequests: [],
    websocketEvents: [],
    debugSnapshots: [],
    preflight: null,
    db: null,
    classification: null,
  };

  if (options.secondUrl) {
    const secondParsedUrl = new URL(options.secondUrl);
    const secondSessionId = parseRoomSessionId(secondParsedUrl.pathname);
    if (!secondSessionId) {
      throw new Error(
        `Invalid --second-url path: expected /room/<sessionId>, got ${secondParsedUrl.pathname}`,
      );
    }
    if (secondSessionId !== options.sessionId) {
      throw new Error(
        `Session mismatch between --url (${options.sessionId}) and --second-url (${secondSessionId})`,
      );
    }

    const dualReport = {
      ...report,
      secondUrl: options.secondUrl,
      options: {
        ...report.options,
        secondProfileDir: toAbsolutePath(options.secondProfileDir),
        labelA: options.labelA,
        labelB: options.labelB,
      },
      browsers: [
        createBrowserReport(options.labelA, options.url, options.sessionId),
        createBrowserReport(options.labelB, options.secondUrl, options.sessionId),
      ],
      mode: "two_browser",
    };

    const browserSpecs = [
      {
        index: 0,
        origin: new URL(options.url).origin,
        url: options.url,
        profileDir: toAbsolutePath(options.profileDir),
      },
      {
        index: 1,
        origin: new URL(options.secondUrl).origin,
        url: options.secondUrl,
        profileDir: toAbsolutePath(options.secondProfileDir),
      },
    ];

    const launchArgs = [];
    if (options.fakeMic) {
      launchArgs.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
      try {
        const wavPath = path.join(outputDir, `${stamp}-fake-mic-tone.wav`);
        await createWavTone({ filePath: wavPath });
        launchArgs.push(`--use-file-for-fake-audio-capture=${wavPath}`);
        console.log(`Fake mic tone ready: ${wavPath}`);
      } catch (error) {
        console.warn(
          `Failed to generate fake mic WAV (${error instanceof Error ? error.message : String(error)}). Continuing without --use-file-for-fake-audio-capture.`,
        );
      }
    }

    const contexts = [];
    const pages = [];
    try {
      for (const spec of browserSpecs) {
        await fs.mkdir(spec.profileDir, { recursive: true });
        const context = await chromium.launchPersistentContext(spec.profileDir, {
          headless: !options.headed,
          args: launchArgs,
          ignoreHTTPSErrors: true,
          viewport: { width: 1600, height: 1000 },
        });
        contexts.push(context);
        await context.grantPermissions(["microphone"], { origin: spec.origin });
        pages.push(context.pages()[0] ?? (await context.newPage()));
      }

      const trackedMaps = [new Map(), new Map()];
      for (const spec of browserSpecs) {
        const browserReport = dualReport.browsers[spec.index];
        const page = pages[spec.index];
        const trackedByRequest = trackedMaps[spec.index];

        page.on("console", (msg) => {
          browserReport.consoleEvents.push({
            ts: nowIso(),
            type: msg.type(),
            text: msg.text(),
            location: msg.location(),
          });
        });
        page.on("pageerror", (error) => {
          browserReport.pageErrors.push({
            ts: nowIso(),
            name: error.name,
            message: error.message,
            stack: error.stack,
          });
        });
        page.on("requestfailed", (request) => {
          browserReport.failedRequests.push({
            ts: nowIso(),
            method: request.method(),
            url: request.url(),
            resourceType: request.resourceType(),
            failure: request.failure(),
          });
        });
        page.on("request", (request) => {
          const category = routeCategory(request.url(), options.sessionId);
          if (category !== "audioActivity") return;
          const reqEntry = {
            ts: nowIso(),
            method: request.method(),
            url: request.url(),
            resourceType: request.resourceType(),
            headers: request.headers(),
            postData: clampString(request.postData() ?? null),
            category,
            status: null,
            responseBody: null,
          };
          browserReport.trackedRequests.push(reqEntry);
          trackedByRequest.set(request, reqEntry);
        });
        page.on("response", async (response) => {
          const request = response.request();
          const tracked = trackedByRequest.get(request);
          if (!tracked) return;
          tracked.status = response.status();
          tracked.responseBody = clampString(await readResponseBody(response));
          browserReport.audioActivityRequests.push({
            ...tracked,
            responseHeaders: response.headers(),
          });
        });
      }

      await Promise.all(
        browserSpecs.map((spec, idx) =>
          pages[idx].goto(spec.url, { waitUntil: "domcontentloaded", timeout: 90_000 }),
        ),
      );
      await Promise.all(
        browserSpecs.map((spec, idx) => waitForLoginAndContinue(pages[idx], spec.url)),
      );

      for (const spec of browserSpecs) {
        const browserReport = dualReport.browsers[spec.index];
        browserReport.preflight = await runPreflight(pages[spec.index], browserReport, {
          timeoutMs: 30_000,
          pollMs: 1_000,
        });
      }

      await waitForCaptureStartOrCountdown();
      const captureStartedAtMs = Date.now();
      const stopAt = captureStartedAtMs + options.durationMs;
      let lastStageLabel = null;
      while (Date.now() < stopAt) {
        const elapsedMs = Date.now() - captureStartedAtMs;
        const stageLabel = getManualStageLabel(elapsedMs);
        if (stageLabel !== lastStageLabel) {
          lastStageLabel = stageLabel;
          console.log(`Stage: ${stageLabel}`);
        }
        for (const spec of browserSpecs) {
          const browserReport = dualReport.browsers[spec.index];
          try {
            const snapshot = await captureDebugSnapshot(pages[spec.index]);
            snapshot.phase = "capture";
            snapshot.elapsedMs = elapsedMs;
            snapshot.manualStage = stageLabel;
            browserReport.debugSnapshots.push(snapshot);
          } catch (error) {
            browserReport.debugSnapshots.push({
              ts: nowIso(),
              phase: "capture",
              elapsedMs,
              manualStage: stageLabel,
              present: false,
              debug: null,
              pollError: error instanceof Error ? error.message : String(error),
            });
          }
        }
        await delay(1_000);
      }
    } finally {
      dualReport.db = await queryDb(options.sessionId);
      dualReport.endedAt = nowIso();
      for (const browserReport of dualReport.browsers) {
        browserReport.summary = deriveBrowserFacts(browserReport);
        browserReport.classification = classifyDualBrowser(
          browserReport,
          browserReport.summary,
          dualReport.db?.grouped ?? [],
        );
      }
      dualReport.classification = {
        mode: "two_browser",
        byBrowser: dualReport.browsers.map((item) => ({
          label: item.label,
          classification: item.classification,
        })),
      };
      const summaryText = summarizeDualReport(dualReport);
      const reportPath = path.join(outputDir, `${stamp}-report.json`);
      const summaryPath = path.join(outputDir, `${stamp}-summary.txt`);
      await fs.writeFile(reportPath, `${JSON.stringify(dualReport, null, 2)}\n`, "utf8");
      await fs.writeFile(summaryPath, `${summaryText}\n`, "utf8");
      console.log(`Report JSON: ${reportPath}`);
      console.log(`Summary TXT: ${summaryPath}`);
      console.log(
        `Classifications: ${dualReport.browsers.map((item) => `${item.label}=${item.classification}`).join(", ")}`,
      );

      await Promise.all(
        contexts.map(async (context) => {
          await context.close();
        }),
      );
    }
    return;
  }

  const origin = new URL(options.url).origin;
  const launchArgs = [];

  if (options.fakeMic) {
    launchArgs.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
    try {
      const wavPath = path.join(outputDir, `${stamp}-fake-mic-tone.wav`);
      await createWavTone({ filePath: wavPath });
      launchArgs.push(`--use-file-for-fake-audio-capture=${wavPath}`);
      console.log(`Fake mic tone ready: ${wavPath}`);
    } catch (error) {
      console.warn(
        `Failed to generate fake mic WAV (${error instanceof Error ? error.message : String(error)}). Continuing without --use-file-for-fake-audio-capture.`,
      );
    }
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: !options.headed,
      args: launchArgs,
      ignoreHTTPSErrors: true,
      viewport: { width: 1600, height: 1000 },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const browserMissing =
      message.includes("Executable doesn't exist") ||
      message.includes("Please run the following command") ||
      message.includes("playwright install");
    if (browserMissing) {
      console.error("Playwright Chromium binary is missing.");
      console.error("Run: npx playwright install chromium");
    }
    throw error;
  }

  try {
    await context.grantPermissions(["microphone"], { origin });
    const page = context.pages()[0] ?? (await context.newPage());

    const trackedByRequest = new Map();

    page.on("console", (msg) => {
      report.consoleEvents.push({
        ts: nowIso(),
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
      });
    });

    page.on("pageerror", (error) => {
      report.pageErrors.push({
        ts: nowIso(),
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    });

    page.on("requestfailed", (request) => {
      report.failedRequests.push({
        ts: nowIso(),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        failure: request.failure(),
      });
    });

    page.on("websocket", (ws) => {
      const wsEvent = {
        ts: nowIso(),
        url: ws.url(),
        events: [{ ts: nowIso(), type: "open" }],
      };
      report.websocketEvents.push(wsEvent);
      ws.on("close", () => wsEvent.events.push({ ts: nowIso(), type: "close" }));
      ws.on("socketerror", (err) =>
        wsEvent.events.push({
          ts: nowIso(),
          type: "socketerror",
          message: String(err),
        }),
      );
    });

    page.on("request", (request) => {
      const category = routeCategory(request.url(), options.sessionId);
      if (!category) return;
      const reqEntry = {
        ts: nowIso(),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        headers: request.headers(),
        postData: clampString(request.postData() ?? null),
        category,
        status: null,
        responseBody: null,
      };
      report.trackedRequests.push(reqEntry);
      trackedByRequest.set(request, reqEntry);
    });

    page.on("response", async (response) => {
      const request = response.request();
      const tracked = trackedByRequest.get(request);
      if (!tracked) return;

      tracked.status = response.status();
      tracked.responseBody = clampString(await readResponseBody(response));

      const payload = {
        ...tracked,
        responseHeaders: response.headers(),
      };

      if (tracked.category === "audioActivity") {
        report.audioActivityRequests.push(payload);
      } else if (tracked.category === "voximplantAccess") {
        report.voximplantAccessRequests.push(payload);
      } else if (tracked.category === "controlState") {
        report.controlStateRequests.push(payload);
      } else if (tracked.category === "livekitSidebar") {
        report.livekitSidebarRequests.push(payload);
      } else if (tracked.category === "recordingControl") {
        report.recordingControlRequests.push(payload);
      } else if (tracked.category === "voximplantDomain") {
        report.voximplantDomainRequests.push(payload);
      }
    });

    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForLoginAndContinue(page, options.url);

    report.preflight = await runPreflight(page, report, { timeoutMs: 30_000, pollMs: 1_000 });
    if (report.preflight.status === "failed") {
      console.warn(
        `Preflight failed: ${report.preflight.classification} (${report.preflight.reason})`,
      );
      return;
    }

    console.log("Speak into the microphone for 20 seconds, then mute/stop speaking for 10 seconds.");

    const stopAt = Date.now() + options.durationMs;
    while (Date.now() < stopAt) {
      try {
        const snapshot = await captureDebugSnapshot(page);
        snapshot.phase = "capture";
        report.debugSnapshots.push(snapshot);
      } catch (error) {
        report.debugSnapshots.push({
          ts: nowIso(),
          phase: "capture",
          present: false,
          debug: null,
          pollError: error instanceof Error ? error.message : String(error),
        });
      }

      await delay(1_000);
    }
  } finally {
    if (report.preflight?.status === "passed") {
      report.db = await queryDb(options.sessionId);
    } else {
      report.db = {
        ok: false,
        skipped: true,
        reason: "preflight_failed",
        count: 0,
        grouped: [],
      };
    }
    report.endedAt = nowIso();
    report.classification = buildClassification(report);
    const summaryText = summarize(report, report.classification);

    const reportPath = path.join(outputDir, `${stamp}-report.json`);
    const summaryPath = path.join(outputDir, `${stamp}-summary.txt`);

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(summaryPath, `${summaryText}\n`, "utf8");

    console.log(`Report JSON: ${reportPath}`);
    console.log(`Summary TXT: ${summaryPath}`);
    console.log(`Classification: ${report.classification.category}`);

    if (context) {
      await context.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

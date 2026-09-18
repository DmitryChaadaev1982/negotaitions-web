import "dotenv/config";

import { chromium } from "@playwright/test";

import { seedCookieConsent } from "../tests/e2e/helpers/cookie-consent";
import { LARGE_REALISTIC_UAT_DEFAULT_PORT } from "../tests/e2e/helpers/large-realistic-uat-constants";
import {
  LARGE_REALISTIC_FIXTURE_STATS,
  validateLargeRealisticFixture,
} from "../tests/e2e/helpers/large-realistic-uat-fixture";
import {
  countSegmentEnhancementProvenance,
  enhancementUxInputFromMetadata,
} from "../lib/post-processing/enhancement-ux-presentation";
import { parseTranscriptEnhancementPublication } from "../lib/services/transcript-enhancement-publication";
import {
  formatDuration,
  loadLatestFixtureObservation,
  loadProviderCallObservations,
  loadTranscriptObservation,
  readLatestUatReport,
  writeUatReport,
  type LargeRealisticUatReport,
} from "../tests/e2e/helpers/large-realistic-uat-observe";
import {
  summarizeProviderSkipObservability,
  summarizeSkipEvidence,
} from "../tests/e2e/helpers/large-realistic-uat-metrics";
import { runLargeRealisticUatPreflight } from "../tests/e2e/helpers/large-realistic-uat-preflight";
import { installLargeRealisticUatProviderObserver } from "../tests/e2e/helpers/large-realistic-uat-provider-observe";
import { setEnhancementProviderCallObserver } from "../lib/services/transcript-enhancement-provider-observation";
import {
  commandMayStopOwnedRuntime,
  startUatNextServer,
  stopChildTree,
  stopLabOwnedRuntime,
} from "../tests/e2e/helpers/large-realistic-uat-runtime";
import {
  applyFrozenEnhancementEnv,
  assertIsolatedUatDatabase,
  assertNotProductionRuntime,
  bindProcessToIsolatedUatDatabase,
  LargeRealisticUatSafetyError,
} from "../tests/e2e/helpers/large-realistic-uat-safety";
import {
  deleteLargeRealisticUatSessions,
  seedLargeRealisticUatSession,
} from "../tests/e2e/helpers/large-realistic-uat-seed";
import {
  formatChunkIndexList,
  RECOVERY_HANDOFF,
  RESUME_SEMANTICS,
  SKIP_SEMANTICS,
  summarizeRecoveryProviderCalls,
} from "../tests/e2e/helpers/large-realistic-uat-skip-resume";

type Command = "provider" | "manual" | "report" | "cleanup" | "preflight" | "resume" | "recovery";
type ManualMode = "default" | "resume" | "recovery";

const COMMANDS = new Set(["provider", "manual", "report", "cleanup", "preflight", "resume", "recovery"]);

function parseArgs(argv: string[]): {
  command: Command;
  mode: ManualMode;
  latest: boolean;
} {
  const flags = argv.filter((token) => token.startsWith("--"));
  const rest = argv
    .filter((token) => !token.startsWith("--"))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => COMMANDS.has(token));
  const rawCommand = rest[0] ?? "provider";
  const modeFlag = flags.find((token) => token.startsWith("--mode="));
  const modeValue = modeFlag?.split("=")[1];
  const mode: ManualMode =
    modeValue === "recovery" || rawCommand === "recovery"
      ? "recovery"
      : modeValue === "resume" || rawCommand === "resume"
        ? "resume"
        : "default";
  return {
    command: rawCommand === "resume" || rawCommand === "recovery" ? "manual" : (rawCommand as Command),
    mode,
    latest: flags.includes("--latest"),
  };
}

function repoRoot(): string {
  return process.cwd();
}

function printSkipVsResume(): void {
  console.log("");
  console.log("SKIP != RESUME");
  console.log(
    `SKIP / ${SKIP_SEMANTICS.operation}: ${SKIP_SEMANTICS.description}`,
  );
  console.log(
    `RETRY / ${RESUME_SEMANTICS.operation}: ${RESUME_SEMANTICS.description}`,
  );
}

function printPreflight(preflight: ReturnType<typeof runLargeRealisticUatPreflight>): void {
  const stats = preflight.dataset;
  console.log("LARGE_UAT_PREFLIGHT =", preflight.verdict);
  console.log(
    [
      `rawChars=${stats.rawChars}`,
      `words=${stats.words}`,
      `segments=${stats.segments}`,
      `estimatedDuration=${stats.estimatedDurationSeconds}s`,
      `ratioVsHistorical9592=${stats.ratioVsHistorical9592}`,
      `plannedChunks=${preflight.plannedChunks}`,
      `longTurn1=${stats.longTurn1.speakerLabel} idx ${stats.longTurn1.startOrderIndex}-${stats.longTurn1.endOrderIndex} ${stats.longTurn1.segmentCount} segs ${stats.longTurn1.durationSeconds}s`,
      `longTurn2=${stats.longTurn2.speakerLabel} idx ${stats.longTurn2.startOrderIndex}-${stats.longTurn2.endOrderIndex} ${stats.longTurn2.segmentCount} segs ${stats.longTurn2.durationSeconds}s`,
      `frozen=${preflight.frozen.chunkMaxChars}/${preflight.frozen.chunkMaxSegments}/${preflight.frozen.perJobConcurrency}/${preflight.frozen.globalConcurrency}/${preflight.frozen.fairness}`,
      `db=${preflight.database.host}:${preflight.database.port}/${preflight.database.databaseMasked}`,
      `realYandexCredentials=${preflight.realYandexCredentialsPresent}`,
      `syntheticOnly=${preflight.syntheticOnly}`,
    ].join("\n"),
  );
  if (preflight.issues.length > 0) {
    console.log("PREFLIGHT_ISSUES");
    for (const issue of preflight.issues) console.log(`- ${issue}`);
  }
}

function toReport(params: {
  kind: LargeRealisticUatReport["kind"];
  sessionId: string;
  transcriptId: string;
  sessionUrl: string | null;
  run: {
    totalT2Ms: number;
    startedAtMs: number;
    finishedAtMs: number;
    calls: LargeRealisticUatReport extends never ? never : {
      calls: number;
      p50: number | null;
      p95: number | null;
      max: number | null;
      retries: number;
      http429: number;
      http5xx: number;
      networkFailures: number;
      schemaFailures: number;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      firstCallAt: string | null;
      lastCallAt: string | null;
    };
    observation: Awaited<ReturnType<typeof loadTranscriptObservation>>;
    realProductProviderPath: string;
  };
  extra?: Partial<LargeRealisticUatReport>;
}): LargeRealisticUatReport {
  const { observation, calls } = params.run;
  return {
    kind: params.kind,
    sessionId: params.sessionId,
    transcriptId: params.transcriptId,
    runId: observation.summary.runId,
    sessionUrl: params.sessionUrl,
    rawChars: LARGE_REALISTIC_FIXTURE_STATS.rawChars,
    words: LARGE_REALISTIC_FIXTURE_STATS.words,
    segments: LARGE_REALISTIC_FIXTURE_STATS.segments,
    estimatedDurationSeconds: LARGE_REALISTIC_FIXTURE_STATS.estimatedDurationSeconds,
    chunksTotal: observation.summary.chunksTotal,
    chunksCompleted: observation.summary.chunksCompleted,
    chunksFailed: observation.summary.chunksFailed,
    calls: calls.calls,
    p50: calls.p50,
    p95: calls.p95,
    max: calls.max,
    retries: calls.retries,
    http429: calls.http429,
    http5xx: calls.http5xx,
    networkFailures: calls.networkFailures,
    schemaFailures: calls.schemaFailures,
    inputTokens: calls.inputTokens,
    outputTokens: calls.outputTokens,
    totalTokens: calls.totalTokens,
    firstProviderCall: calls.firstCallAt,
    lastProviderCall: calls.lastCallAt,
    startedAt: observation.summary.startedAt ?? new Date(params.run.startedAtMs).toISOString(),
    finishedAt: observation.summary.finishedAt ?? new Date(params.run.finishedAtMs).toISOString(),
    totalT2Ms: params.run.totalT2Ms,
    executionStatus: observation.summary.executionStatus,
    terminalQuality: observation.summary.terminalQuality,
    publicationEligible: observation.summary.publicationEligible,
    publicationOutcome: observation.summary.publicationOutcome,
    skipTime: observation.job.cancelledAt,
    segmentsTotal: observation.textChange.segmentsTotal,
    segmentsTextChanged: observation.textChange.segmentsTextChanged,
    segmentsTextUnchanged: observation.textChange.segmentsTextUnchanged,
    failedOrErrorSegments: observation.summary.chunksFailed,
    realYandex: true,
    realProductProviderPath: params.run.realProductProviderPath,
    createdAt: new Date().toISOString(),
    ...params.extra,
  };
}

function printLiveReport(report: LargeRealisticUatReport): void {
  console.log("");
  console.log("LIVE_YANDEX");
  console.log(
    [
      `SESSION_ID=${report.sessionId}`,
      `RUN_ID=${report.runId ?? "n/a"}`,
      `RAW_CHARS=${report.rawChars}`,
      `SEGMENTS=${report.segments}`,
      `CHUNKS=${report.chunksTotal}`,
      `START=${report.startedAt ?? "n/a"}`,
      `FIRST_PROVIDER_CALL=${report.firstProviderCall ?? "n/a"}`,
      `LAST_PROVIDER_CALL=${report.lastProviderCall ?? "n/a"}`,
      `TOTAL_T2=${formatDuration(report.totalT2Ms)}`,
      `COMPLETED_CHUNKS=${report.chunksCompleted}`,
      `FAILED_CHUNKS=${report.chunksFailed}`,
      `CALLS=${report.calls}`,
      `P50=${report.p50 ?? "n/a"}`,
      `P95=${report.p95 ?? "n/a"}`,
      `MAX=${report.max ?? "n/a"}`,
      `RETRIES=${report.retries}`,
      `429=${report.http429}`,
      `5XX=${report.http5xx}`,
      `SCHEMA_FAILURES=${report.schemaFailures}`,
      `TOKENS/USAGE input=${report.inputTokens ?? "n/a"} output=${report.outputTokens ?? "n/a"} total=${report.totalTokens ?? "n/a"}`,
      `EXECUTION_STATUS=${report.executionStatus}`,
      `TERMINAL_QUALITY=${report.terminalQuality ?? "n/a"}`,
      `PUBLICATION_OUTCOME=${report.publicationOutcome ?? "n/a"}`,
      `SEGMENTS_CHANGED=${report.segmentsTextChanged}`,
      `SEGMENTS_UNCHANGED=${report.segmentsTextUnchanged}`,
      `SKIP_TIME=${report.skipTime ?? "n/a"}`,
      `REAL_YANDEX=YES`,
      `PROVIDER_PATH=${report.realProductProviderPath}`,
    ].join("\n"),
  );
}

function printOptionalArtifactSnapshot(report: LargeRealisticUatReport): void {
  console.log("");
  console.log("OPTIONAL_ARTIFACT_SNAPSHOT");
  console.log(
    [
      "authority=historical file latest.json; not current DB state",
      `ARTIFACT_CREATED_AT=${report.createdAt}`,
      `KIND=${report.kind}`,
      `SESSION_ID=${report.sessionId}`,
      `RUN_ID=${report.runId ?? "n/a"}`,
      `EXECUTION_STATUS=${report.executionStatus}`,
      `PUBLICATION_OUTCOME=${report.publicationOutcome ?? "n/a"}`,
      `SKIP_TIME=${report.skipTime ?? "n/a"}`,
      `CHUNKS=${report.chunksCompleted}/${report.chunksTotal}`,
      `CALLS=${report.calls}`,
      `FIRST_PROVIDER_CALL=${report.firstProviderCall ?? "n/a"}`,
      `LAST_PROVIDER_CALL=${report.lastProviderCall ?? "n/a"}`,
      `TOTAL_T2=${formatDuration(report.totalT2Ms)}`,
    ].join("\n"),
  );
}

function isInfraFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ENOTFOUND|fetch failed|socket|timed out|timeout|E2E_DATABASE|credentials|configuration is missing/i.test(
    message,
  );
}

function qualifyProvider(report: LargeRealisticUatReport): "PASS" | "PASS_WITH_FINDINGS" | "FAIL" {
  const reliabilityOk =
    report.executionStatus === "COMPLETED" &&
    report.terminalQuality === "COMPLETED" &&
    report.chunksFailed === 0;
  if (!reliabilityOk) return "FAIL";
  if (report.segmentsTextChanged > 0 && report.segmentsTextUnchanged > 0) return "PASS";
  return "PASS_WITH_FINDINGS";
}

async function runProviderCommand(): Promise<void> {
  const runOnce = async () => {
    const seeded = await seedLargeRealisticUatSession("provider");
    bindProcessToIsolatedUatDatabase();
    const { runBackgroundProviderQualification } = await import(
      "../tests/e2e/helpers/large-realistic-uat-live"
    );
    return runBackgroundProviderQualification(seeded);
  };
  let run: Awaited<ReturnType<typeof runOnce>>;
  try {
    run = await runOnce();
  } catch (error) {
    if (!isInfraFailure(error)) throw error;
    console.warn("First live provider run failed due to infrastructure. Retrying once.");
    run = await runOnce();
  }
  const report = toReport({
    kind: "provider",
    sessionId: run.seeded.sessionId,
    transcriptId: run.seeded.transcriptId,
    sessionUrl: null,
    run,
  });
  const filePath = await writeUatReport(repoRoot(), report);
  printLiveReport(report);
  console.log(`REPORT_FILE=${filePath}`);
  console.log(`PROVIDER_QUALIFICATION=${qualifyProvider(report)}`);
}

async function runResumeCommand(): Promise<void> {
  const seeded = await seedLargeRealisticUatSession("resume");
  bindProcessToIsolatedUatDatabase();
  const { runControlledResumeHarness } = await import(
    "../tests/e2e/helpers/large-realistic-uat-live"
  );
  const run = await runControlledResumeHarness(seeded);
  const report = toReport({
    kind: "resume",
    sessionId: run.seeded.sessionId,
    transcriptId: run.seeded.transcriptId,
    sessionUrl: null,
    run,
    extra: {
      initialCallChunks: run.initialCallChunks,
      resumeCallChunks: run.resumeCallChunks,
      completedBeforeResume: run.completedBeforeResume,
      completedChunksCalledAgain: run.completedChunksCalledAgain,
    },
  });
  const filePath = await writeUatReport(repoRoot(), report);
  printLiveReport(report);
  printSkipVsResume();
  console.log("");
  console.log("RESUME_UNFINISHED_HARNESS");
  console.log(
    [
      `mechanism=${run.mechanism}`,
      `INITIAL_CALL_CHUNKS=${run.initialCallChunks.join(",") || "(none)"}`,
      `RESUME_CALL_CHUNKS=${run.resumeCallChunks.join(",") || "(none)"}`,
      `COMPLETED_BEFORE_RESUME=${run.completedBeforeResume.join(",") || "(none)"}`,
      `RETRYABLE_FAILED_BEFORE_RESUME=${run.retryableFailedBeforeResume.join(",") || "(none)"}`,
      `PENDING_BEFORE_RESUME=${run.pendingBeforeResume.join(",") || "(none)"}`,
      `intersection(COMPLETED_BEFORE_RESUME, RESUME_CALL_CHUNKS)=${run.completedChunksCalledAgain.join(",") || "empty"}`,
      `final executionStatus=${report.executionStatus}`,
      `final terminalQuality=${report.terminalQuality ?? "n/a"}`,
    ].join("\n"),
  );
  console.log(`REPORT_FILE=${filePath}`);
}

async function waitForOperatorStop(): Promise<void> {
  console.log("");
  console.log("Harness has stopped controlling the workflow.");
  console.log("Operator has free control. Press Ctrl+C when finished.");
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runManualCommand(): Promise<void> {
  const port = LARGE_REALISTIC_UAT_DEFAULT_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startUatNextServer({
    repoRoot: repoRoot(),
    port,
    restartIfObserveEnvRequired: true,
  });
  try {
    const seeded = await seedLargeRealisticUatSession("manual");
    const observation = await loadTranscriptObservation(seeded.transcriptId);
    const sessionUrl = `${baseUrl}/sessions/${seeded.sessionId}/materials`;
    const statusUrl = `${baseUrl}/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.facilitator.joinToken}`;
    const statusResponse = await fetch(statusUrl, {
      headers: { Cookie: seeded.facilitator.authCookie },
    });
    const statusType = statusResponse.headers.get("content-type") ?? "";
    const statusText = await statusResponse.text();
    if (!statusType.includes("json") || /<html/i.test(statusText)) {
      throw new Error(
        `materials/status returned non-JSON (${statusResponse.status} ${statusType}). Stale .next-e2e cache suspected.`,
      );
    }
    const statusJson = JSON.parse(statusText) as {
      transcription?: {
        status?: string;
        enhancement?: {
          executionStatus?: string;
          status?: string;
          inProgress?: boolean;
        };
      };
      session?: { status?: string; negotiationState?: string };
    };
    const enhancementStatus = statusJson.transcription?.enhancement;
    if (
      observation.summary.executionStatus !== "NOT_STARTED" ||
      enhancementStatus?.inProgress === true ||
      enhancementStatus?.executionStatus === "RUNNING" ||
      enhancementStatus?.executionStatus === "QUEUED"
    ) {
      throw new Error("Manual session started enhancement automatically. Stopping without Product changes.");
    }

    const browser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"],
    });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await seedCookieConsent(page);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await context.addCookies([
      {
        name: "auth_session",
        value: seeded.facilitator.authCookie.slice("auth_session=".length),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(sessionUrl, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) {
      throw new Error(
        `Manual session redirected to login (${page.url()}). Auth cookie did not bind to the Product page.`,
      );
    }
    const startButton = page.getByTestId("post-processing-run-transcript-enhancement-button").first();
    await startButton.waitFor({ state: "visible", timeout: 30_000 });

    const report = toReport({
      kind: "manual",
      sessionId: seeded.sessionId,
      transcriptId: seeded.transcriptId,
      sessionUrl,
      run: {
        totalT2Ms: 0,
        startedAtMs: Date.now(),
        finishedAtMs: Date.now(),
        calls: {
          calls: 0,
          p50: null,
          p95: null,
          max: null,
          retries: 0,
          http429: 0,
          http5xx: 0,
          networkFailures: 0,
          schemaFailures: 0,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          firstCallAt: null,
          lastCallAt: null,
        },
        observation,
        realProductProviderPath:
          "POST /api/sessions/[id]/materials/enhance-transcript -> executeTranscriptEnhancement -> enhanceTranscriptWithYandexAi",
      },
    });
    await writeUatReport(repoRoot(), report);

    const db = assertIsolatedUatDatabase().descriptor;
    console.log("");
    console.log("LARGE_UAT_MANUAL = READY");
    console.log(
      [
        `SESSION_ID=${seeded.sessionId}`,
        `SESSION_URL=${sessionUrl}`,
        `RAW_CHARS=${seeded.stats.rawChars}`,
        `SEGMENTS=${seeded.stats.segments}`,
        `ESTIMATED_DURATION=${seeded.stats.estimatedDurationSeconds}s`,
        `REAL_YANDEX=YES`,
        "",
        "START_STATE:",
        "SESSION=FINISHED",
        "TRANSCRIPTION=READY",
        "ENHANCEMENT=NOT_STARTED",
        "AI_ANALYSIS=NOT_STARTED",
        `enhancement.executionStatus=${observation.summary.executionStatus}`,
        `enhancement.publicationEligible=${observation.summary.publicationEligible}`,
        `materials/status enhancement=${enhancementStatus?.executionStatus ?? "n/a"} ui=${enhancementStatus?.status ?? "n/a"}`,
        "enhancement started automatically = NO",
        `DB=${db.normalizedHost}:${db.port}/${db.databaseMasked}`,
        `browser/control handed to operator = YES`,
        `server_reused=${server.reused ? "YES" : "NO"}`,
        "provider_observe=LARGE_REALISTIC_UAT_PROVIDER_OBSERVE=1",
        "",
        "Product start control label is «Запустить ИИ-улучшение»; after a prior attempt it is «Повторить ИИ-улучшение»",
        `(testid post-processing-run-transcript-enhancement-button).`,
        "Do not treat Skip as Resume.",
      ].join("\n"),
    );
    printSkipVsResume();
    await waitForOperatorStop();
    await browser.close();
  } finally {
    await stopChildTree(server.child);
  }
}

async function runManualRecoveryCommand(): Promise<void> {
  process.env.LARGE_REALISTIC_UAT_PROVIDER_OBSERVE = "1";
  installLargeRealisticUatProviderObserver(process.env, setEnhancementProviderCallObserver);
  const port = LARGE_REALISTIC_UAT_DEFAULT_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startUatNextServer({
    repoRoot: repoRoot(),
    port,
    restartIfObserveEnvRequired: true,
  });
  try {
    const seeded = await seedLargeRealisticUatSession("recovery");
    const db = bindProcessToIsolatedUatDatabase();
    const { expireControlledEnhancementLease, prepareControlledRecoveryState } = await import(
      "../tests/e2e/helpers/large-realistic-uat-live"
    );
    const prepared = await prepareControlledRecoveryState(seeded, { lease: "held" });
    if (
      prepared.completedBeforeResume.join(",") !== "0,1,2" ||
      prepared.retryableFailed.join(",") !== "20" ||
      prepared.pending.length !== 17
    ) {
      throw new Error(
        `Recovery seed shape mismatch completed=${prepared.completedBeforeResume.join(",")} pending=${prepared.pending.join(",")} retryable=${prepared.retryableFailed.join(",")}`,
      );
    }
    if (prepared.executionStatus !== "RUNNING" || prepared.publicationEligible !== true) {
      throw new Error(
        `Recovery seed is not in-flight/eligible (${prepared.executionStatus}, publicationEligible=${prepared.publicationEligible}).`,
      );
    }
    if (!prepared.runId) {
      throw new Error("Recovery seed lost runId. Stopping; current same-job assumption failed.");
    }

    const sessionUrl = `${baseUrl}/sessions/${seeded.sessionId}/materials`;
    const statusUrl = `${baseUrl}/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.facilitator.joinToken}`;
    const statusResponse = await fetch(statusUrl, {
      headers: { Cookie: seeded.facilitator.authCookie },
    });
    const statusType = statusResponse.headers.get("content-type") ?? "";
    const statusText = await statusResponse.text();
    if (!statusType.includes("json") || /<html/i.test(statusText)) {
      throw new Error(
        `materials/status returned non-JSON (${statusResponse.status} ${statusType}). Stale .next-e2e cache suspected.`,
      );
    }
    const statusJson = JSON.parse(statusText) as {
      transcription?: {
        enhancement?: {
          executionStatus?: string;
          status?: string;
          publicationEligible?: boolean;
          progress?: { completedChunks?: number; totalChunks?: number };
        };
      };
    };
    const enhancementStatus = statusJson.transcription?.enhancement;
    if (
      enhancementStatus?.executionStatus === "COMPLETED" ||
      enhancementStatus?.publicationEligible === false
    ) {
      throw new Error("Recovery session started or finished enhancement during held-lease validation.");
    }

    const browser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"],
    });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await seedCookieConsent(page);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await context.addCookies([
      {
        name: "auth_session",
        value: seeded.facilitator.authCookie.slice("auth_session=".length),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(sessionUrl, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) {
      throw new Error(
        `Recovery session redirected to login (${page.url()}). Auth cookie did not bind to the Product page.`,
      );
    }
    const progress = page.getByTestId("enhancement-progress").first();
    await progress.waitFor({ state: "visible", timeout: 30_000 });
    const progressText = (await progress.textContent()) ?? "";
    if (!/3\s*из\s*21|3\s*\/\s*21/.test(progressText)) {
      throw new Error(`Expected durable 3/21 progress before recovery handoff. Saw: ${progressText}`);
    }
    const publishedKind = page.getByTestId("enhancement-published-kind").first();
    const publishedKindValue = await publishedKind.getAttribute("data-published-kind");
    if (publishedKindValue && publishedKindValue !== "raw") {
      throw new Error(`Published kind before recovery must stay raw. Saw ${publishedKindValue}`);
    }

    await expireControlledEnhancementLease(seeded.transcriptId);
    const recoveryStart = new Date().toISOString();
    const observation = await loadTranscriptObservation(seeded.transcriptId);

    const report = toReport({
      kind: "recovery",
      sessionId: seeded.sessionId,
      transcriptId: seeded.transcriptId,
      sessionUrl,
      run: {
        totalT2Ms: 0,
        startedAtMs: Date.now(),
        finishedAtMs: Date.now(),
        calls: {
          calls: 0,
          p50: null,
          p95: null,
          max: null,
          retries: 0,
          http429: 0,
          http5xx: 0,
          networkFailures: 0,
          schemaFailures: 0,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          firstCallAt: null,
          lastCallAt: null,
        },
        observation,
        realProductProviderPath:
          "materials/status reconcileTranscriptEnhancementTimeout -> runTranscriptEnhancementRecoveryTick -> runAdmittedEnhancementJob -> enhanceTranscriptWithYandexAi",
      },
      extra: {
        recoveryMode: true,
        recoveryStart,
        completedBeforeRecovery: prepared.completedBeforeResume,
        pendingBeforeRecovery: prepared.pending,
        retryableBeforeRecovery: prepared.retryableFailed,
        completedBeforeResume: prepared.completedBeforeResume,
      },
    });
    await writeUatReport(repoRoot(), report);

    console.log("");
    console.log("LARGE_UAT_RECOVERY = READY");
    console.log(
      [
        `SESSION_ID=${seeded.sessionId}`,
        `SESSION_URL=${sessionUrl}`,
        `RUN_ID=${prepared.runId}`,
        "",
        "COMPLETED_BEFORE_RECOVERY=0,1,2",
        `PENDING_BEFORE_RECOVERY=${formatChunkIndexList(prepared.pending)}`,
        `RETRYABLE_BEFORE_RECOVERY=${formatChunkIndexList(prepared.retryableFailed)}`,
        `RECOVERY_TRIGGER=${RECOVERY_HANDOFF.trigger}`,
        `RECOVERY_START=${recoveryStart}`,
        "REAL_YANDEX=YES",
        "",
        "START_STATE:",
        "SESSION=FINISHED",
        "TRANSCRIPTION=READY",
        `enhancement.executionStatus=${observation.summary.executionStatus}`,
        `enhancement.publicationEligible=${observation.summary.publicationEligible}`,
        `enhancement.terminalQuality=${observation.summary.terminalQuality ?? "null"}`,
        "published transcript=RAW",
        "partial publication=NO",
        `materials/status enhancement=${enhancementStatus?.executionStatus ?? "n/a"} ui=${enhancementStatus?.status ?? "n/a"}`,
        `progress=${progressText.trim()}`,
        `DB=${db.descriptor.normalizedHost}:${db.descriptor.port}/${db.descriptor.databaseMasked}`,
        `browser/control handed to operator = YES`,
        `server_reused=${server.reused ? "YES" : "NO"}`,
        "provider_observe=LARGE_REALISTIC_UAT_PROVIDER_OBSERVE=1",
        "",
        RECOVERY_HANDOFF.operatorAction,
        `Product path: ${RESUME_SEMANTICS.productPath}`,
        "Do not treat Skip as Resume. Do not start a new Improve.",
      ].join("\n"),
    );
    printSkipVsResume();
    await waitForOperatorStop();
    await browser.close();
  } finally {
    await stopChildTree(server.child);
  }
}

async function runReportCommand(): Promise<void> {
  const latest = await loadLatestFixtureObservation();
  const fileReport = await readLatestUatReport(repoRoot());
  if (!latest && !fileReport) {
    console.log("No large-realistic UAT fixture session or artifact snapshot found.");
    return;
  }
  if (latest) {
    const skip = summarizeSkipEvidence(latest.observation.job);
    const ux = enhancementUxInputFromMetadata(latest.observation.processingMetadata);
    const provenance = countSegmentEnhancementProvenance({
      publication: parseTranscriptEnhancementPublication(
        latest.observation.processingMetadata,
      ),
      currentRetranscribeCount: latest.observation.job.retranscribeCount ?? 0,
      segments: latest.observation.segments.map((segment, orderIndex) => ({
        orderIndex,
        text: segment.text,
      })),
    });
    const providerCalls = await loadProviderCallObservations(repoRoot());
    const provider = summarizeProviderSkipObservability(
      providerCalls,
      skip.skipTime,
      skip.runId,
    );
    const lateResultsPublished = provider.completedAfterSkip.length > 0 && provenance.applied > 0;
    console.log("");
    console.log("CURRENT_DB_STATE");
    console.log("authority=isolated E2E DB session; primary for --latest");
    console.log(
      [
        `SESSION_ID=${latest.sessionId}`,
        `TRANSCRIPT_ID=${latest.transcriptId}`,
        `KIND=${latest.kind ?? "n/a"}`,
        `RUN_ID=${skip.runId ?? "n/a"}`,
        `START=${skip.startedAt ?? "n/a"}`,
        `SKIP_TIME=${skip.skipTime ?? "n/a"}`,
        `PROVIDER_IN_FLIGHT_AT_SKIP=${provider.inFlightAtSkip.join(",") || "(none)"}`,
        `PROVIDER_COMPLETED_AFTER_SKIP=${provider.completedAfterSkip.length}`,
        `LATE_CHUNK_IDS=${provider.completedAfterSkip.join(",") || "(none)"}`,
        `LATE_CHECKPOINT_ACCEPTED=${
          provider.lateCheckpointAccepted == null
            ? "n/a"
            : provider.lateCheckpointAccepted
              ? "YES"
              : "NO"
        }`,
        `LATE_RESULTS_PUBLISHED=${lateResultsPublished ? "YES" : "NO"}`,
        `PUBLISHED_ENHANCED_SEGMENTS=${provenance.applied}`,
        `PUBLICATION_ELIGIBLE=${skip.publicationEligible}`,
        `EXECUTION_STATUS=${skip.executionStatus}`,
        `PUBLICATION_OUTCOME=${skip.publicationOutcome ?? "n/a"}`,
        `TERMINAL_QUALITY=${latest.observation.summary.terminalQuality ?? "n/a"}`,
        `CHUNKS_TOTAL=${skip.chunksTotal}`,
        `COMPLETED_BEFORE_SKIP=${skip.completedBeforeSkip.join(",") || "(none)"}`,
        `IN_FLIGHT_AT_SKIP=${skip.inFlightAtSkip.join(",") || "(none)"}`,
        `COMPLETED_AFTER_SKIP=${skip.completedAfterSkip.join(",") || "(none)"}`,
        `PENDING_AFTER_SKIP=${skip.pendingAfterSkip.join(",") || "(none)"}`,
        `FAILED=${skip.failed.join(",") || "(none)"}`,
        `CHUNKS=${latest.observation.summary.chunksCompleted}/${latest.observation.summary.chunksTotal}`,
        `FAILED_CHUNKS=${latest.observation.summary.chunksFailed}`,
        `SEGMENTS_CHANGED=${latest.observation.textChange.segmentsTextChanged}`,
        `SEGMENTS_UNCHANGED=${latest.observation.textChange.segmentsTextUnchanged}`,
      ].join("\n"),
    );
  } else {
    console.log("CURRENT_DB_STATE");
    console.log("No fixture-marked session found in the isolated E2E DB.");
  }
  if (fileReport) {
    printOptionalArtifactSnapshot(fileReport);
    if (fileReport.initialCallChunks || fileReport.resumeCallChunks) {
      console.log("");
      console.log("RESUME_CALL_SET");
      console.log(`INITIAL_CALL_CHUNKS=${(fileReport.initialCallChunks ?? []).join(",") || "(none)"}`);
      console.log(`RESUME_CALL_CHUNKS=${(fileReport.resumeCallChunks ?? []).join(",") || "(none)"}`);
      console.log(
        `COMPLETED_CHUNKS_CALLED_AGAIN=${(fileReport.completedChunksCalledAgain ?? []).join(",") || "empty"}`,
      );
    }
    if (fileReport.recoveryMode || fileReport.kind === "recovery") {
      const providerCalls = await loadProviderCallObservations(repoRoot());
      const recovery = summarizeRecoveryProviderCalls({
        records: providerCalls,
        runId: fileReport.runId,
        recoveryStart: fileReport.recoveryStart ?? null,
        completedBeforeRecovery: fileReport.completedBeforeRecovery ?? [0, 1, 2],
      });
      const live = latest?.observation;
      console.log("");
      console.log("RECOVERY_SESSION");
      console.log(
        [
          `RUN_ID=${fileReport.runId ?? live?.summary.runId ?? "n/a"}`,
          "RECOVERY_MODE=YES",
          `RECOVERY_START=${fileReport.recoveryStart ?? "n/a"}`,
          `COMPLETED_BEFORE_RECOVERY=${formatChunkIndexList(fileReport.completedBeforeRecovery ?? [0, 1, 2])}`,
          `PENDING_BEFORE_RECOVERY=${formatChunkIndexList(fileReport.pendingBeforeRecovery ?? [])}`,
          `RETRYABLE_BEFORE_RECOVERY=${formatChunkIndexList(fileReport.retryableBeforeRecovery ?? [])}`,
          `RECOVERY_PROVIDER_CALL_CHUNKS=${formatChunkIndexList(recovery.recoveryProviderCallChunks)}`,
          `RECALLED_COMPLETED_CHUNKS=${formatChunkIndexList(recovery.recalledCompletedChunks)}`,
          `CHUNKS_TOTAL=${live?.summary.chunksTotal ?? fileReport.chunksTotal}`,
          `CHUNKS_COMPLETED=${live?.summary.chunksCompleted ?? fileReport.chunksCompleted}`,
          `FAILED_CHUNKS=${live?.summary.chunksFailed ?? fileReport.chunksFailed}`,
          `EXECUTION_STATUS=${live?.summary.executionStatus ?? fileReport.executionStatus}`,
          `TERMINAL_QUALITY=${live?.summary.terminalQuality ?? fileReport.terminalQuality ?? "n/a"}`,
          `PUBLICATION_OUTCOME=${live?.summary.publicationOutcome ?? fileReport.publicationOutcome ?? "n/a"}`,
          `SEGMENTS_CHANGED=${live?.textChange.segmentsTextChanged ?? fileReport.segmentsTextChanged}`,
          `SEGMENTS_UNCHANGED=${live?.textChange.segmentsTextUnchanged ?? fileReport.segmentsTextUnchanged}`,
        ].join("\n"),
      );
    }
  }
}

async function runCleanupCommand(): Promise<void> {
  const result = await deleteLargeRealisticUatSessions();
  console.log(
    `Deleted ${result.sessionsDeleted} fixture-marked session(s) and ${result.usersDeleted} fixture-marked user(s) from isolated E2E DB.`,
  );
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  assertNotProductionRuntime();

  if (parsed.command === "report") {
    console.log(`LARGE_UAT_REPORT latest=${parsed.latest ? "YES" : "NO"}`);
    assertIsolatedUatDatabase();
    await runReportCommand();
    return;
  }

  console.log(`LARGE_UAT_LAUNCHER command=${parsed.command} mode=${parsed.mode}`);
  if (commandMayStopOwnedRuntime(parsed.command, parsed.mode)) {
    const stopped = await stopLabOwnedRuntime({ repoRoot: repoRoot() });
    if (stopped.stoppedPids.length > 0) {
      console.log(`Stopped registry-proven Large-UAT-owned pids: ${stopped.stoppedPids.join(", ")}`);
    } else {
      console.log("No registry-proven Large-UAT-owned runtime was active.");
      for (const verdict of stopped.verdicts.filter((entry) => !entry.owned)) {
        console.log(`Left running: pid ${verdict.pid} (${verdict.reason}).`);
      }
    }
  } else {
    console.log(`Command ${parsed.command}/${parsed.mode} never stops a browser or dev server.`);
  }

  applyFrozenEnhancementEnv();

  if (parsed.command === "cleanup") {
    assertIsolatedUatDatabase();
    await runCleanupCommand();
    return;
  }

  const fixture = validateLargeRealisticFixture();
  if (!fixture.ok) {
    console.error("Deterministic fixture failed preflight.");
    for (const issue of fixture.issues) console.error(`- ${issue.code}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  const preflight = runLargeRealisticUatPreflight();
  printPreflight(preflight);
  if (!preflight.ok) {
    process.exitCode = 1;
    return;
  }

  if (parsed.command === "preflight") return;

  if (parsed.command === "provider") {
    await runProviderCommand();
    return;
  }

  if (parsed.command === "manual" && parsed.mode === "resume") {
    await runResumeCommand();
    return;
  }

  if (parsed.command === "manual" && parsed.mode === "recovery") {
    await runManualRecoveryCommand();
    return;
  }

  if (parsed.command === "manual") {
    await runManualCommand();
    return;
  }

  console.error(`Unknown Large UAT command: ${parsed.command}`);
  process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof LargeRealisticUatSafetyError) {
    console.error(`BLOCKED: ${message}`);
  } else {
    console.error(message);
  }
  process.exit(1);
});

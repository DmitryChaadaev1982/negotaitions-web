import fs from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const { Client } = pg;

function parseArgs(argv) {
  let sessionId = null;
  let envFile = null;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sessionId") {
      sessionId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--env-file") {
      envFile = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!sessionId) {
    throw new Error(
      "Usage: node scripts/debug/session-pause-source-audio-forensics.mjs --sessionId <id> [--env-file .env]",
    );
  }
  return { sessionId, envFile };
}

function ensureDatabaseUrl(envFile) {
  if (envFile) {
    loadEnv({ path: envFile, override: false });
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
  }
}

function csvEscape(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

function toCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

async function main() {
  const { sessionId, envFile } = parseArgs(process.argv);
  ensureDatabaseUrl(envFile);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sessionRes = await client.query(
      `select id, "negotiationStartedAt", "negotiationEndedAt"
       from "Session"
       where id = $1`,
      [sessionId],
    );
    if (sessionRes.rowCount === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const recordingRes = await client.query(
      `select id, status, "startedAt", "endedAt", "fileName", "fileKey"
       from "Recording"
       where "sessionId" = $1`,
      [sessionId],
    );
    const transcriptRes = await client.query(
      `select id, status, "processingMetadata"
       from "Transcript"
       where "sessionId" = $1`,
      [sessionId],
    );
    const pauseRes = await client.query(
      `select "startedAt", "endedAt"
       from "SessionPauseInterval"
       where "sessionId" = $1
       order by "startedAt" asc`,
      [sessionId],
    );
    const activityRes = await client.query(
      `select id, "sessionParticipantId", source, "startedOffsetSeconds", "endedOffsetSeconds", confidence
       from "SessionParticipantAudioActivity"
       where "sessionId" = $1
       order by "startedAt" asc`,
      [sessionId],
    );

    const recording = recordingRes.rows[0] ?? null;
    const transcript = transcriptRes.rows[0] ?? null;
    const pauseIntervals = pauseRes.rows;
    const metadata = asObject(transcript?.processingMetadata);
    const pauseProcessing = asObject(metadata?.pauseProcessing);
    const activeTimelineMap = asObject(pauseProcessing?.activeTimelineMap);
    const activeTimeline = Array.isArray(activeTimelineMap?.activeIntervals)
      ? activeTimelineMap.activeIntervals
      : [];
    const pauseMode = pauseProcessing?.mode ?? "transcript_interval_filter";

    const normalizedTelemetryRows =
      pauseMode === "source_audio_cut" && activeTimeline.length > 0
        ? activityRes.rows.flatMap((row) => {
            const startMs = Math.round((row.startedOffsetSeconds ?? 0) * 1000);
            const endMs = Math.round((row.endedOffsetSeconds ?? row.startedOffsetSeconds ?? 0) * 1000);
            const pieces = [];
            for (const interval of activeTimeline) {
              const overlapStart = Math.max(startMs, interval.realStartMs);
              const overlapEnd = Math.min(endMs, interval.realEndMs);
              if (overlapEnd <= overlapStart) continue;
              const shiftedStartMs =
                interval.activeStartMs + (overlapStart - interval.realStartMs);
              const shiftedEndMs =
                interval.activeStartMs + (overlapEnd - interval.realStartMs);
              pieces.push({
                activityId: row.id,
                sessionParticipantId: row.sessionParticipantId,
                source: row.source,
                originalStartSeconds: row.startedOffsetSeconds,
                originalEndSeconds: row.endedOffsetSeconds,
                normalizedStartSeconds: shiftedStartMs / 1000,
                normalizedEndSeconds: shiftedEndMs / 1000,
              });
            }
            return pieces;
          })
        : activityRes.rows.map((row) => ({
            activityId: row.id,
            sessionParticipantId: row.sessionParticipantId,
            source: row.source,
            originalStartSeconds: row.startedOffsetSeconds,
            originalEndSeconds: row.endedOffsetSeconds,
            normalizedStartSeconds: row.startedOffsetSeconds,
            normalizedEndSeconds: row.endedOffsetSeconds,
          }));

    const excludedTelemetryCount = Math.max(
      0,
      activityRes.rows.length - normalizedTelemetryRows.length,
    );

    const outputDir = path.join(".debug", "session-forensics", sessionId);
    await fs.mkdir(outputDir, { recursive: true });

    const summary = {
      sessionId,
      pauseMode,
      recording: recording
        ? {
            id: recording.id,
            status: recording.status,
            startedAt: recording.startedAt,
            endedAt: recording.endedAt,
            fileName: recording.fileName,
            fileKey: recording.fileKey,
          }
        : null,
      pauseIntervals,
      activeTimeline,
      transcriptPauseProcessing: pauseProcessing ?? null,
      telemetry: {
        rawRows: activityRes.rows.length,
        normalizedRows: normalizedTelemetryRows.length,
        excludedRows: excludedTelemetryCount,
      },
      pausedSpeechCouldReachSpeechKit:
        pauseMode === "source_audio_cut" ? "no (source cut mode)" : "possible",
      edgeCases: {
        multiplePauses: pauseIntervals.length > 1,
        pauseToEnd: pauseIntervals.some((interval) => interval.endedAt == null),
        noPause: pauseIntervals.length === 0,
      },
    };

    const summaryMd = [
      `# Pause Source-Audio Forensics (${sessionId})`,
      "",
      `- Pause mode: ${summary.pauseMode}`,
      `- Pause intervals: ${pauseIntervals.length}`,
      `- Active intervals: ${activeTimeline.length}`,
      `- Telemetry rows raw/normalized/excluded: ${summary.telemetry.rawRows}/${summary.telemetry.normalizedRows}/${summary.telemetry.excludedRows}`,
      `- Paused speech could reach SpeechKit: ${summary.pausedSpeechCouldReachSpeechKit}`,
      "",
      "## Recording",
      recording
        ? `- id=${recording.id}, status=${recording.status}, file=${recording.fileName ?? "n/a"}`
        : "- not found",
      "",
      "## Edge Cases",
      `- multiple pauses: ${summary.edgeCases.multiplePauses}`,
      `- pause->end: ${summary.edgeCases.pauseToEnd}`,
      `- no pause: ${summary.edgeCases.noPause}`,
      "",
    ].join("\n");

    await fs.writeFile(
      path.join(outputDir, "pause-source-audio-summary.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(outputDir, "pause-source-audio-summary.md"),
      summaryMd,
      "utf8",
    );
    await fs.writeFile(
      path.join(outputDir, "active-timeline.csv"),
      toCsv(activeTimeline, [
        "partIndex",
        "realStartMs",
        "realEndMs",
        "activeStartMs",
        "activeEndMs",
        "durationMs",
      ]),
      "utf8",
    );
    await fs.writeFile(
      path.join(outputDir, "normalized-telemetry.csv"),
      toCsv(normalizedTelemetryRows, [
        "activityId",
        "sessionParticipantId",
        "source",
        "originalStartSeconds",
        "originalEndSeconds",
        "normalizedStartSeconds",
        "normalizedEndSeconds",
      ]),
      "utf8",
    );

    console.log(`Wrote forensics artifacts to ${outputDir}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

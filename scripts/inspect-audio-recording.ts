import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
};

type FfprobeFormat = {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
};

type FfprobePayload = {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
};

function resolveFfprobeCommand() {
  const custom = process.env.FFPROBE_BIN?.trim();
  if (custom) {
    const check = spawnSync(custom, ["-version"], { encoding: "utf8" });
    if (!check.error && check.status === 0) return custom;
  }
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const resolved = spawnSync(lookup, ["ffprobe"], { encoding: "utf8" });
  if (resolved.error || resolved.status !== 0) return null;
  const first = resolved.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first ?? null;
}

function formatSeconds(raw: string | undefined) {
  const value = Number(raw ?? "0");
  return Number.isFinite(value) ? value.toFixed(3) : "unknown";
}

function formatKbps(raw: string | undefined) {
  const value = Number(raw ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.round(value / 1000).toString() : "unknown";
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npm run inspect:audio -- <path-to-recording-file>");
    process.exit(1);
  }

  const filePath = path.resolve(input);
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(filePath).size;
  } catch {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const ffprobe = resolveFfprobeCommand();
  if (!ffprobe) {
    console.error("ffprobe is not available.");
    console.error("Install FFmpeg and ensure ffprobe is in PATH (or set FFPROBE_BIN).");
    console.error("Windows: choco install ffmpeg  |  winget install Gyan.FFmpeg");
    process.exit(2);
  }

  const probe = spawnSync(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name,duration,bit_rate:stream=codec_type,codec_name,sample_rate,channels,bit_rate",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8" },
  );

  if (probe.error || probe.status !== 0) {
    console.error("ffprobe failed.");
    if (probe.stderr) console.error(probe.stderr.trim());
    process.exit(3);
  }

  let payload: FfprobePayload;
  try {
    payload = JSON.parse(probe.stdout) as FfprobePayload;
  } catch {
    console.error("Unable to parse ffprobe output.");
    process.exit(4);
    return;
  }

  const audioStream = (payload.streams ?? []).find((stream) => stream.codec_type === "audio");
  const format = payload.format ?? {};

  console.log(`file: ${filePath}`);
  console.log(`container: ${format.format_name ?? "unknown"}`);
  console.log(`codec: ${audioStream?.codec_name ?? "unknown"}`);
  console.log(`sampleRateHz: ${audioStream?.sample_rate ?? "unknown"}`);
  console.log(`channels: ${audioStream?.channels ?? "unknown"}`);
  console.log(`bitrateKbps(stream): ${formatKbps(audioStream?.bit_rate)}`);
  console.log(`bitrateKbps(file): ${formatKbps(format.bit_rate)}`);
  console.log(`durationSec: ${formatSeconds(format.duration)}`);
  console.log(`fileSizeBytes: ${sizeBytes}`);
}

main();

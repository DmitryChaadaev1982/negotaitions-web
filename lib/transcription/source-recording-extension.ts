import { extname } from "node:path";

export function resolveSourceRecordingExtension(recording: {
  fileName: string | null;
  fileKey: string;
  mimeType: string | null;
}): string {
  const byFileName = extname(recording.fileName ?? "").trim();
  if (byFileName) {
    return byFileName;
  }

  const byFileKey = extname(recording.fileKey).trim();
  if (byFileKey) {
    return byFileKey;
  }

  const mimeType = (recording.mimeType ?? "").toLowerCase();
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("opus")) return ".opus";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("flac")) return ".flac";
  return ".wav";
}

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Server-only whole-password denylist.
 *
 * Do not import this module from a client component. The lists are read from
 * disk at first use and are not part of the client-safe policy constants.
 */

const BLOCKLIST_FILES = [
  "common-passwords.txt",
  "common-passwords-curated.txt",
] as const;

let blocklist: Set<string> | null = null;

/** NFKC, lowercase, and outer trim. Internal whitespace stays. */
export function normalizePasswordForBlocklist(password: string): string {
  return password.normalize("NFKC").toLowerCase().trim();
}

function loadBlocklist(): Set<string> {
  if (blocklist) return blocklist;
  const directory = path.join(process.cwd(), "lib", "auth", "data");
  const entries = new Set<string>();
  for (const fileName of BLOCKLIST_FILES) {
    const text = readFileSync(path.join(directory, fileName), "utf8");
    for (const rawLine of text.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.includes("@") || line.includes(":")) continue;
      entries.add(normalizePasswordForBlocklist(line));
    }
  }
  blocklist = entries;
  return entries;
}

export function commonPasswordBlocklistSize(): number {
  return loadBlocklist().size;
}

/** Whole-password check. A longer passphrase is not rejected for a substring. */
export function isCommonPassword(password: string): boolean {
  if (typeof password !== "string" || password.length === 0) return false;
  return loadBlocklist().has(normalizePasswordForBlocklist(password));
}

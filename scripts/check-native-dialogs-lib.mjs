import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_ALLOWLIST_RELATIVE_PATH = "scripts/native-dialog-allowlist.json";
export const DEFAULT_SCAN_ROOTS = ["app", "components", "lib"];

const DIALOG_APIS = new Set(["alert", "confirm", "prompt"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "generated",
  "__tests__",
]);
const DIALOG_CALL_RE = /\bwindow\s*\.\s*(alert|confirm|prompt)\s*\(/g;

export function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function isTestFile(relativePath) {
  return /\.(?:test|spec)\.[^.]+$/.test(relativePath);
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function parseAllowlist(raw, options = {}) {
  const source = options.source ?? "allowlist";
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`${source} is not valid JSON: ${message}`], exceptions: [] };
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, errors: [`${source} must be a JSON object.`], exceptions: [] };
  }
  if (!Array.isArray(document.exceptions)) {
    return { ok: false, errors: [`${source} must contain an \`exceptions\` array.`], exceptions: [] };
  }

  const errors = [];
  const exceptions = [];
  const seen = new Set();
  document.exceptions.forEach((entry, index) => {
    const loc = `${source}.exceptions[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${loc} must be an object.`);
      return;
    }
    if (typeof entry.file !== "string" || entry.file.trim().length === 0) {
      errors.push(`${loc}.file must be a non-empty string.`);
      return;
    }
    if (!DIALOG_APIS.has(entry.api)) {
      errors.push(`${loc}.api must be one of alert, confirm, prompt.`);
      return;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      errors.push(`${loc}.reason must be a non-empty string.`);
      return;
    }
    if (!Number.isInteger(entry.expectedCount) || entry.expectedCount < 1) {
      errors.push(`${loc}.expectedCount must be a positive integer.`);
      return;
    }
    const file = toPosix(entry.file.trim());
    const key = `${file} : ${entry.api}`;
    if (seen.has(key)) {
      errors.push(`${loc} duplicates ${key}.`);
      return;
    }
    seen.add(key);
    exceptions.push({
      file,
      api: entry.api,
      expectedCount: entry.expectedCount,
      reason: entry.reason.trim(),
    });
  });

  return { ok: errors.length === 0, errors, exceptions };
}

export function findDialogCalls(source) {
  const matches = [];
  const scanText = stripComments(source);
  DIALOG_CALL_RE.lastIndex = 0;
  let match;
  while ((match = DIALOG_CALL_RE.exec(scanText))) {
    matches.push({ api: match[1], index: match.index });
  }
  return matches;
}

function walkSourceFiles(rootDir, relativeRoot, files) {
  if (!existsSync(rootDir)) {
    return;
  }

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    const relativePath = toPosix(path.join(relativeRoot, entry.name));
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      walkSourceFiles(fullPath, relativePath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    if (isTestFile(relativePath)) {
      continue;
    }
    files.push({ fullPath, relativePath });
  }
}

export function collectProductionSourceFiles(repositoryRoot, scanRoots = DEFAULT_SCAN_ROOTS) {
  const files = [];
  for (const scanRoot of scanRoots) {
    walkSourceFiles(path.join(repositoryRoot, scanRoot), scanRoot, files);
  }
  return files;
}

export function checkNativeDialogs(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const scanRoots = options.scanRoots ?? DEFAULT_SCAN_ROOTS;
  const allowlistPath =
    options.allowlistPath ?? path.join(repositoryRoot, DEFAULT_ALLOWLIST_RELATIVE_PATH);
  const files = options.files ?? collectProductionSourceFiles(repositoryRoot, scanRoots);
  const allowlistRelative = toPosix(
    path.relative(repositoryRoot, allowlistPath) || path.basename(allowlistPath),
  );

  if (!existsSync(allowlistPath)) {
    return {
      ok: false,
      errors: [`Native-dialog allowlist is missing: ${allowlistRelative}`],
      unexpected: [],
      stale: [],
      countMismatches: [],
      occurrences: [],
    };
  }

  const parsed = parseAllowlist(readFileSync(allowlistPath, "utf8"), {
    source: allowlistRelative,
  });
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors,
      unexpected: [],
      stale: [],
      countMismatches: [],
      occurrences: [],
    };
  }

  const allowlistByKey = new Map(
    parsed.exceptions.map((entry) => [`${entry.file} : ${entry.api}`, entry]),
  );
  const occurrences = [];
  const errors = [];

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file.fullPath, "utf8");
    } catch {
      continue;
    }
    const relativePath = file.relativePath ?? toPosix(path.relative(repositoryRoot, file.fullPath));
    for (const match of findDialogCalls(source)) {
      occurrences.push({ file: relativePath, api: match.api });
    }
  }

  const actualCounts = new Map();
  for (const occurrence of occurrences) {
    const key = `${occurrence.file} : ${occurrence.api}`;
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  }

  const unexpected = [];
  for (const key of actualCounts.keys()) {
    if (!allowlistByKey.has(key)) {
      unexpected.push(key);
      errors.push(`Unexpected native dialog: ${key}`);
    }
  }

  const stale = [];
  const countMismatches = [];
  for (const [key, entry] of allowlistByKey) {
    const actualCount = actualCounts.get(key) ?? 0;
    if (actualCount === 0) {
      stale.push(key);
      errors.push(`Stale native-dialog allowlist entry: ${key}`);
    }
    if (actualCount !== entry.expectedCount) {
      countMismatches.push({
        key,
        expectedCount: entry.expectedCount,
        actualCount,
      });
      errors.push(
        `Native-dialog count mismatch: ${key} expected ${entry.expectedCount}, found ${actualCount}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    unexpected,
    stale,
    countMismatches,
    occurrences,
  };
}

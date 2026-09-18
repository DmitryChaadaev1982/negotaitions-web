import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const skipDirNames = new Set(["node_modules", ".git", ".next", "app", "lib", "coverage"]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

const linkRe = /!\[[^\]]*]\(([^)]+)\)|\[[^\]]*]\(([^)]+)\)/g;

function extractTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(linkRe)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw) continue;
    const href = raw.split(/\s+/)[0].replace(/^<|>$/g, "");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http://") || href.startsWith("https://")) {
      continue;
    }
    targets.push(href.split("#")[0]);
  }
  return targets;
}

const files = walk(path.join(root, "docs")).concat([
  path.join(root, "README.md"),
  path.join(root, "AGENTS.md"),
  path.join(root, "CLAUDE.md"),
]);

const broken = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const markdown = readFileSync(file, "utf8");
  const dir = path.dirname(file);
  for (const href of extractTargets(markdown)) {
    const decoded = decodeURIComponent(href.replace(/\\/g, "/"));
    const resolved = path.resolve(dir, decoded);
    if (!existsSync(resolved)) {
      broken.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        href,
      });
    }
  }
}

const currentBroken = broken.filter((item) => !item.file.startsWith("docs/history/"));
const historicalBroken = broken.filter((item) => item.file.startsWith("docs/history/"));

console.log(`checked_markdown=${files.length}`);
console.log(`broken_current=${currentBroken.length}`);
console.log(`broken_historical=${historicalBroken.length}`);
for (const item of currentBroken) {
  console.log(`CURRENT ${item.file} -> ${item.href}`);
}
if (process.argv.includes("--historical")) {
  for (const item of historicalBroken.slice(0, 80)) {
    console.log(`HIST ${item.file} -> ${item.href}`);
  }
  if (historicalBroken.length > 80) {
    console.log(`HIST ... ${historicalBroken.length - 80} more`);
  }
}

if (currentBroken.length > 0) {
  process.exitCode = 1;
}

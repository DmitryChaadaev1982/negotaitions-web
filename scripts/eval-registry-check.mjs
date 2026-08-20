#!/usr/bin/env node

import path from "node:path";

import { checkEvalRegistry } from "./eval-registry-lib.mjs";

const result = checkEvalRegistry();
if (!result.ok) {
  process.stderr.write(`${result.errors.map((line) => `[eval-registry] ${line}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`eval-registry: PASS ${path.relative(process.cwd(), result.registryPath)}\n`);
}

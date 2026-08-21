#!/usr/bin/env node

import { checkNativeDialogs } from "./check-native-dialogs-lib.mjs";

const result = checkNativeDialogs();
if (!result.ok) {
  process.stderr.write(`${result.errors.map((line) => `[native-dialogs] ${line}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `native-dialogs: PASS ${result.occurrences.length} allowlisted occurrence(s)\n`,
  );
}

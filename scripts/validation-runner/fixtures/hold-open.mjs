import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const lifetimeMs = Number(process.argv[2] ?? 30_000);
const grandchildCount = Number(process.argv[3] ?? 0);
const self = fileURLToPath(import.meta.url);

if (grandchildCount > 0) {
  spawn(process.execPath, [self, String(lifetimeMs), "0"], {
    stdio: "ignore",
    detached: false,
    windowsHide: true,
  });
}

process.stdout.write(`HOLD_OPEN_PID=${process.pid}\n`);
setInterval(() => {}, 1_000);
setTimeout(() => {
  process.exit(0);
}, Number.isFinite(lifetimeMs) ? lifetimeMs : 30_000);

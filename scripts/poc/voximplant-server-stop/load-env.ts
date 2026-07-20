import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env then .env.local without overriding already-set process.env keys. */
export function loadPocEnvFiles(cwd: string = process.cwd()): void {
  for (const name of [".env", ".env.local"]) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

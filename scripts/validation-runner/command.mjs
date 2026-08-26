import { spawn } from "node:child_process";

export function requireSafePid(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Refusing to operate on an unsafe PID: ${pid}`);
  }
  return value;
}

export function runShortCommand(file, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const cwd = options.cwd ?? process.cwd();

  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Inspect helpers must never escalate to image-name kills.
      }
      finish({
        code: null,
        stdout,
        stderr,
        timedOut: true,
        pid: child.pid ?? null,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        code: 1,
        stdout,
        stderr,
        timedOut: false,
        error,
        pid: child.pid ?? null,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        code: code ?? 0,
        stdout,
        stderr,
        timedOut: false,
        pid: child.pid ?? null,
      });
    });
  });
}

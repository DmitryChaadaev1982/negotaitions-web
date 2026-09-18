import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  setEnhancementProviderCallObserver,
  type EnhancementProviderCallObservation,
} from "../services/transcript-enhancement-provider-observation";

export const UAT_PROVIDER_OBSERVE_FLAG = "LARGE_REALISTIC_UAT_PROVIDER_OBSERVE";

const OBSERVER_HELPER_RELATIVE_PATH =
  "tests/e2e/helpers/large-realistic-uat-provider-observe.ts";

export type NodeInstrumentationEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Production must never install the Large-Realistic UAT provider observer, even
 * if the flag leaks into the runtime environment.
 */
export function shouldInstallUatProviderObserver(
  env: NodeInstrumentationEnv = process.env,
): boolean {
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") return false;
  return env[UAT_PROVIDER_OBSERVE_FLAG] === "1";
}

export function uatProviderObserverHelperHref(cwd = process.cwd()): string {
  return pathToFileURL(path.join(cwd, OBSERVER_HELPER_RELATIVE_PATH)).href;
}

export async function registerNodeInstrumentation(): Promise<boolean> {
  if (!shouldInstallUatProviderObserver()) return false;

  // Resolved from the running worktree rather than the build graph, so the
  // bundlers must leave it as a native runtime import.
  const observe = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ uatProviderObserverHelperHref()
  )) as {
    recordLargeUatProviderCallEvent?: (
      event: EnhancementProviderCallObservation,
    ) => Promise<boolean>;
  };
  if (typeof observe.recordLargeUatProviderCallEvent !== "function") {
    return false;
  }
  // Bind the native recorder onto the bundled observation singleton Next
  // enhancement code uses.
  setEnhancementProviderCallObserver(async (event) => {
    await observe.recordLargeUatProviderCallEvent?.(event);
  });
  return true;
}

import { expect, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";

const UNRELATED_REALTIME_NOISE = [
  /Item with key lk-user-choices does not exist/i,
  /websocket closed/i,
  /Couldn't connect to server/i,
  /could not establish signal connection/i,
];

export function isUnrelatedPostProcessingLabRealtimeNoise(text: string): boolean {
  return UNRELATED_REALTIME_NOISE.some((pattern) => pattern.test(text));
}

export function attachPostProcessingLabConsoleGuard(
  page: Page,
  context: BrowserContext,
) {
  const hits: string[] = [];

  const record = (source: string, text: string) => {
    if (isUnrelatedPostProcessingLabRealtimeNoise(text)) {
      hits.push(`${source}: ${text}`);
    }
  };

  const onConsole = (message: ConsoleMessage) => {
    record(`console.${message.type()}`, message.text());
  };
  const onPageError = (error: Error) => {
    record("pageerror", error.message);
  };

  const watch = (target: Page) => {
    target.on("console", onConsole);
    target.on("pageerror", onPageError);
  };

  watch(page);
  const onNewPage = (next: Page) => {
    watch(next);
  };
  context.on("page", onNewPage);

  return {
    assertNoUnrelatedRealtimeNoise() {
      expect(hits, hits.join("\n")).toEqual([]);
    },
    stop() {
      context.off("page", onNewPage);
    },
  };
}

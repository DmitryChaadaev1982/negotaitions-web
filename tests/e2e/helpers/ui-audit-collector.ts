import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";

export type UiAuditScenarioMeta = {
  scenarioId: string;
  surface: string;
  journey: string;
  role: string;
  viewport: string;
  state: string;
  findingIds?: string[];
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const artifactRoot = path.join(process.cwd(), "artifacts", "ui-audit");

export function getUiAuditArtifactRoot() {
  return artifactRoot;
}

function safeFilePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function ensureUiAuditArtifactDirs() {
  await Promise.all([
    mkdir(path.join(artifactRoot, "screenshots"), { recursive: true }),
    mkdir(path.join(artifactRoot, "metrics"), { recursive: true }),
    mkdir(path.join(artifactRoot, "traces"), { recursive: true }),
  ]);
}

export function buildUiAuditArtifactName(meta: UiAuditScenarioMeta, suffix: string) {
  return [
    meta.scenarioId,
    meta.role,
    meta.viewport,
    meta.state,
    suffix,
  ].map(safeFilePart).join("__");
}

export async function writeUiAuditJson(
  name: string,
  data: JsonValue,
  folder = "metrics",
) {
  await ensureUiAuditArtifactDirs();
  const filePath = path.join(artifactRoot, folder, `${name}.json`);
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

export async function collectUiAuditMetrics(page: Page, meta: UiAuditScenarioMeta) {
  return page.evaluate((scenarioMeta) => {
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0
      );
    };

    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      };
    };

    const selectorHint = (element: Element) =>
      element.getAttribute("data-testid") ||
      element.getAttribute("aria-label") ||
      element.id ||
      element.tagName.toLowerCase();

    const sanitizeUrl = (value: string | null | undefined) => {
      if (!value) return null;
      try {
        const url = new URL(value, window.location.origin);
        for (const key of Array.from(url.searchParams.keys())) {
          if (key.toLowerCase().includes("token")) {
            url.searchParams.set(key, "[redacted]");
          }
        }
        return url.toString();
      } catch {
        return "[unparseable-url]";
      }
    };

    const actionElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea, [role='button'], [role='link']",
      ),
    );
    const visibleActions = actionElements.filter(isVisible);

    const actions = visibleActions.map((element, index) => {
      const style = window.getComputedStyle(element);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        label:
          element.getAttribute("aria-label") ||
          element.textContent?.replace(/\s+/g, " ").trim() ||
          element.getAttribute("title") ||
          "",
        href: element instanceof HTMLAnchorElement ? sanitizeUrl(element.href) : null,
        type: element.getAttribute("type"),
        disabled:
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true",
        testId: element.getAttribute("data-testid"),
        actionVariant: element.getAttribute("data-action-variant"),
        rect: rectFor(element),
        background: style.backgroundColor,
        foreground: style.color,
        border: style.borderColor,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        position: style.position,
      };
    });

    const duplicateActionLabels = Object.entries(
      actions.reduce<Record<string, number>>((acc, action) => {
        const key = action.label || "(empty)";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .filter(([, count]) => count > 1)
      .map(([label, count]) => ({ label, count }));

    const scrollContainers = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const canScrollY =
          /(auto|scroll)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 2;
        const canScrollX =
          /(auto|scroll)/.test(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 2;
        return (canScrollY || canScrollX) && isVisible(element);
      })
      .map((element) => ({
        hint: selectorHint(element),
        rect: rectFor(element),
        overflowX: window.getComputedStyle(element).overflowX,
        overflowY: window.getComputedStyle(element).overflowY,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      }));

    const overlapPairs = [];
    for (let i = 0; i < visibleActions.length; i += 1) {
      const a = visibleActions[i]!;
      const ar = a.getBoundingClientRect();
      for (let j = i + 1; j < visibleActions.length; j += 1) {
        const b = visibleActions[j]!;
        const br = b.getBoundingClientRect();
        const xOverlap = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
        const yOverlap = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
        if (xOverlap * yOverlap > 16) {
          overlapPairs.push({
            first: selectorHint(a),
            second: selectorHint(b),
            overlapArea: Math.round(xOverlap * yOverlap),
          });
        }
      }
    }

    const clippedText = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        if (!isVisible(element)) return false;
        const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (text.length < 12) return false;
        return (
          element.scrollWidth > element.clientWidth + 2 ||
          element.scrollHeight > element.clientHeight + 2
        );
      })
      .slice(0, 80)
      .map((element) => ({
        hint: selectorHint(element),
        text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 140) ?? "",
        rect: rectFor(element),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));

    const targetSizeIssues = actions
      .filter((action) => action.rect.width < 24 || action.rect.height < 24)
      .map((action) => ({
        label: action.label,
        testId: action.testId,
        rect: action.rect,
      }));

    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .filter(isVisible)
      .map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
        rect: rectFor(element),
      }));

    const landmarks = Array.from(
      document.querySelectorAll("main, nav, aside, header, footer, [role='main'], [role='navigation'], [role='complementary'], [role='banner'], [role='contentinfo']"),
    )
      .filter(isVisible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        label: element.getAttribute("aria-label") || element.getAttribute("aria-labelledby"),
        rect: rectFor(element),
      }));

    const regionBounds = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-testid*='layout'], [data-testid*='panel'], [data-testid*='sidebar'], [data-testid*='zone'], [data-testid*='row'], main, aside",
      ),
    )
      .filter(isVisible)
      .slice(0, 80)
      .map((element) => ({
        hint: selectorHint(element),
        rect: rectFor(element),
      }));

    const fixedOrSticky = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        const position = window.getComputedStyle(element).position;
        return (position === "fixed" || position === "sticky") && isVisible(element);
      })
      .map((element) => ({
        hint: selectorHint(element),
        position: window.getComputedStyle(element).position,
        rect: rectFor(element),
      }));

    const focusOrderSample = visibleActions.slice(0, 30).map((element, index) => ({
      index,
      hint: selectorHint(element),
      label:
        element.getAttribute("aria-label") ||
        element.textContent?.replace(/\s+/g, " ").trim() ||
        "",
      tabIndex: (element as HTMLElement).tabIndex,
    }));

    return {
      scenario: scenarioMeta,
      url: sanitizeUrl(window.location.href),
      title: document.title,
      timestamp: new Date().toISOString(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      },
      counts: {
        totalActions: actionElements.length,
        visibleActions: visibleActions.length,
        scrollContainers: scrollContainers.length,
        clippedText: clippedText.length,
        overlapPairs: overlapPairs.length,
        headings: headings.length,
        landmarks: landmarks.length,
        dialogs: document.querySelectorAll("[role='dialog'], dialog").length,
      },
      actions,
      duplicateActionLabels,
      scrollContainers,
      overlapPairs,
      clippedText,
      targetSizeIssues,
      headings,
      landmarks,
      regionBounds,
      fixedOrSticky,
      focusOrderSample,
    };
  }, meta);
}

export async function captureUiAuditEvidence(
  page: Page,
  testInfo: TestInfo,
  meta: UiAuditScenarioMeta,
) {
  await ensureUiAuditArtifactDirs();
  const name = buildUiAuditArtifactName(meta, "evidence");
  const screenshotPath = path.join(artifactRoot, "screenshots", `${name}.png`);
  const screenshot = await page.screenshot({ fullPage: true });
  await writeFile(screenshotPath, screenshot);
  const metrics = await collectUiAuditMetrics(page, meta);
  const metricsPath = await writeUiAuditJson(name, metrics);
  await testInfo.attach(`${meta.scenarioId} metrics`, {
    path: metricsPath,
    contentType: "application/json",
  });
  await testInfo.attach(`${meta.scenarioId} screenshot`, {
    path: screenshotPath,
    contentType: "image/png",
  });
  return { ...meta, name, screenshotPath, metricsPath, metrics };
}

export type UiAuditEvidenceRecord = Awaited<ReturnType<typeof captureUiAuditEvidence>>;

export async function writeUiAuditManifestAndIndex(records: UiAuditEvidenceRecord[]) {
  await ensureUiAuditArtifactDirs();
  const manifestPath = path.join(artifactRoot, "manifest.json");
  const normalizedRecords = records.map((record) => ({
    scenarioId: record.scenarioId,
    surface: record.surface,
    journey: record.journey,
    role: record.role,
    viewport: record.viewport,
    state: record.state,
    findingIds: record.findingIds ?? [],
    screenshotPath: record.screenshotPath,
    metricsPath: record.metricsPath,
    url: typeof record.metrics.url === "string" ? record.metrics.url : "",
    horizontalOverflow:
      typeof record.metrics.document === "object" &&
      record.metrics.document !== null &&
      !Array.isArray(record.metrics.document) &&
      record.metrics.document.horizontalOverflow === true,
  }));
  await writeFile(manifestPath, `${JSON.stringify({ records: normalizedRecords }, null, 2)}\n`, "utf8");

  const rows = normalizedRecords
    .map((record) => {
      const screenshotRelative = path.relative(artifactRoot, record.screenshotPath).replace(/\\/g, "/");
      const metricsRelative = path.relative(artifactRoot, record.metricsPath).replace(/\\/g, "/");
      return `<article>
  <h2>${record.scenarioId} · ${record.surface}</h2>
  <p>${record.role} · ${record.viewport} · ${record.state} · findings ${record.findingIds.join(", ") || "none"}</p>
  <p><a href="${metricsRelative}">metrics</a> · <a href="${screenshotRelative}">screenshot</a></p>
  <img src="${screenshotRelative}" alt="${record.scenarioId} ${record.surface} screenshot" loading="lazy" />
</article>`;
    })
    .join("\n");

  const indexPath = path.join(artifactRoot, "index.html");
  await writeFile(
    indexPath,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Stage 3.12 UI Audit Evidence Index</title>
  <style>
    body { margin: 24px; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    main { display: grid; gap: 20px; }
    article { border: 1px solid #334155; border-radius: 12px; padding: 16px; background: #111827; }
    h1, h2 { margin: 0 0 8px; }
    p { margin: 6px 0; color: #cbd5e1; }
    a { color: #67e8f9; }
    img { display: block; width: 100%; max-width: 960px; border: 1px solid #334155; border-radius: 8px; margin-top: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Stage 3.12 UI Audit Evidence Index</h1>
    ${rows}
  </main>
</body>
</html>
`,
    "utf8",
  );

  return { manifestPath, indexPath };
}

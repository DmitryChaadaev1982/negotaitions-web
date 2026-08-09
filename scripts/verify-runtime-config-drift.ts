import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  SERVER_RUNTIME_SETTINGS,
  type ServerRuntimeSetting,
} from "../lib/config/server-runtime-settings";

export type RuntimeConfigVerificationIssue = {
  code:
    | "DIRECT_ENV_ACCESS"
    | "DYNAMIC_SETTING_KEY"
    | "UNREGISTERED_SETTING"
    | "UNAPPROVED_CONSUMER"
    | "UNUSED_REGISTRY_ENTRY"
    | "INVALID_REGISTRY_ENTRY";
  file: string;
  line: number;
  key?: string;
};

export type RuntimeConfigSource = {
  fileName: string;
  sourceText: string;
};

const ACCESSOR_EXPORTS = new Set([
  "parseServerRuntimeSetting",
  "readServerRuntimeSettingRaw",
]);
const DIAGNOSTICS_MODULE = "lib/services/admin-env-display.ts";
const REVIEWED_DIRECT_ENV_READS: Readonly<Record<string, readonly string[]>> = {
  "next.config.ts": ["NODE_ENV", "NEXT_DIST_DIR"],
};

export const RUNTIME_CONFIG_SCOPE_PATHS = Object.freeze([
  "lib/auth",
  "lib/email",
  "app/api/auth",
  "lib/prisma.ts",
  "lib/config/provider-runtime.ts",
  "lib/config/server-action-origins.ts",
  "lib/services/admin-env-display.ts",
  "next.config.ts",
]);

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isProductionSource(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    /\.(?:ts|tsx)$/.test(normalized) &&
    !/\.(?:test|spec|pg\.test)\.(?:ts|tsx)$/.test(normalized) &&
    !normalized.includes("/__tests__/")
  );
}

export function loadRuntimeConfigScopeSources(
  rootDirectory = process.cwd(),
): RuntimeConfigSource[] {
  const files = new Set<string>();
  for (const scopePath of RUNTIME_CONFIG_SCOPE_PATHS) {
    const absolute = resolve(rootDirectory, scopePath);
    if (ts.sys.fileExists(absolute)) {
      if (isProductionSource(absolute)) files.add(absolute);
      continue;
    }
    for (const file of ts.sys.readDirectory(
      absolute,
      [".ts", ".tsx"],
      undefined,
      undefined,
    )) {
      if (isProductionSource(file)) files.add(file);
    }
  }
  return [...files].sort().map((fileName) => ({
    fileName: normalizePath(relative(rootDirectory, fileName)),
    sourceText: readFileSync(fileName, "utf8"),
  }));
}

function isProcessIdentifier(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && node.text === "process";
}

function isProcessEnvExpression(node: ts.Node): boolean {
  if (
    ts.isPropertyAccessExpression(node) &&
    isProcessIdentifier(node.expression) &&
    node.name.text === "env"
  ) {
    return true;
  }
  return (
    ts.isElementAccessExpression(node) &&
    isProcessIdentifier(node.expression) &&
    ts.isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === "env"
  );
}

function directDotEnvironmentKey(node: ts.Node): string | null {
  const parent = node.parent;
  return ts.isPropertyAccessExpression(parent) && parent.expression === node
    ? parent.name.text
    : null;
}

function importedAccessorNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.endsWith(
        "config/server-runtime-settings",
      )
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const exportedName = element.propertyName?.text ?? element.name.text;
      if (ACCESSOR_EXPORTS.has(exportedName)) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

function issueLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): Pick<RuntimeConfigVerificationIssue, "file" | "line"> {
  return {
    file: normalizePath(sourceFile.fileName),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
  };
}

export function validateRuntimeSettingRegistry(
  registry: Record<string, ServerRuntimeSetting>,
): RuntimeConfigVerificationIssue[] {
  const issues: RuntimeConfigVerificationIssue[] = [];
  for (const [registryKey, definition] of Object.entries(registry)) {
    if (
      definition.key !== registryKey ||
      typeof definition.secret !== "boolean" ||
      !definition.ownerModules?.length ||
      !definition.diagnostics?.description ||
      (definition.parser.category === "secret") !== definition.secret
    ) {
      issues.push({
        code: "INVALID_REGISTRY_ENTRY",
        file: "lib/config/server-runtime-settings.ts",
        line: 1,
        key: registryKey,
      });
    }
  }
  return issues;
}

export function verifyRuntimeConfiguration(params?: {
  sources?: RuntimeConfigSource[];
  registry?: Record<string, ServerRuntimeSetting>;
}): RuntimeConfigVerificationIssue[] {
  const sources = params?.sources ?? loadRuntimeConfigScopeSources();
  const registry =
    params?.registry ??
    (SERVER_RUNTIME_SETTINGS as unknown as Record<
      string,
      ServerRuntimeSetting
    >);
  const issues = validateRuntimeSettingRegistry(registry);
  const usage = new Map<string, Set<string>>();

  for (const source of sources) {
    const fileName = normalizePath(source.fileName);
    const sourceFile = ts.createSourceFile(
      fileName,
      source.sourceText,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const accessors = importedAccessorNames(sourceFile);

    function visit(node: ts.Node): void {
      if (isProcessEnvExpression(node)) {
        const key = directDotEnvironmentKey(node);
        const reviewedKeys = REVIEWED_DIRECT_ENV_READS[fileName] ?? [];
        const definition = key ? registry[key] : undefined;
        if (
          key &&
          reviewedKeys.includes(key) &&
          (!definition || definition.ownerModules.includes(fileName))
        ) {
          if (definition) {
            const consumers = usage.get(key) ?? new Set<string>();
            consumers.add(fileName);
            usage.set(key, consumers);
          }
        } else {
          issues.push({
            code: "DIRECT_ENV_ACCESS",
            ...issueLocation(sourceFile, node),
            ...(key ? { key } : {}),
          });
        }
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        accessors.has(node.expression.text)
      ) {
        const keyArgument = node.arguments[0];
        if (!keyArgument || !ts.isStringLiteral(keyArgument)) {
          if (fileName !== DIAGNOSTICS_MODULE) {
            issues.push({
              code: "DYNAMIC_SETTING_KEY",
              ...issueLocation(sourceFile, node),
            });
          }
        } else {
          const key = keyArgument.text;
          const definition = registry[key];
          if (!definition) {
            issues.push({
              code: "UNREGISTERED_SETTING",
              ...issueLocation(sourceFile, node),
              key,
            });
          } else if (
            fileName !== DIAGNOSTICS_MODULE &&
            !definition.ownerModules.includes(fileName)
          ) {
            issues.push({
              code: "UNAPPROVED_CONSUMER",
              ...issueLocation(sourceFile, node),
              key,
            });
          } else if (fileName !== DIAGNOSTICS_MODULE) {
            const consumers = usage.get(key) ?? new Set<string>();
            consumers.add(fileName);
            usage.set(key, consumers);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  for (const key of Object.keys(registry)) {
    if (!usage.has(key)) {
      issues.push({
        code: "UNUSED_REGISTRY_ENTRY",
        file: "lib/config/server-runtime-settings.ts",
        line: 1,
        key,
      });
    }
  }
  return issues;
}

export function assertRuntimeConfigurationDriftFree(): void {
  const issues = verifyRuntimeConfiguration();
  if (issues.length > 0) {
    const summary = issues.map((issue) => ({
      code: issue.code,
      file: issue.file,
      line: issue.line,
      key: issue.key ?? null,
    }));
    throw new Error(`Runtime configuration drift: ${JSON.stringify(summary)}`);
  }
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  try {
    assertRuntimeConfigurationDriftFree();
    console.log(JSON.stringify({ ok: true, checks: 1 }));
  } catch {
    console.error(JSON.stringify({ ok: false, checks: 1 }));
    process.exitCode = 1;
  }
}

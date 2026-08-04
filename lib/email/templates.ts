import { readFileSync } from "node:fs";
import path from "node:path";

import {
  EmailMessageCategory,
  EmailMessageType,
} from "@/app/generated/prisma/client";
import type {
  EmailLocale,
  EmailTemplateKey,
  EmailTemplateMetadata,
  LoadedEmailTemplate,
  TemplateVariableDefinition,
} from "@/lib/email/types";

const TEMPLATE_ROOT = path.join(process.cwd(), "email-templates");
const TEMPLATE_KEYS: EmailTemplateKey[] = [
  "system-test",
  "password-reset",
  "account-recovery-denied",
  "password-changed",
  "event-invitation",
  "session-invitation",
  "admin-pending-approval",
];
const LOCALES: EmailLocale[] = ["ru", "en"];
const RUNTIME_ENABLED_KEYS = new Set<EmailTemplateKey>([
  "system-test",
  "password-reset",
  "account-recovery-denied",
  "password-changed",
  "admin-pending-approval",
]);

const MESSAGE_TYPES = new Set(Object.values(EmailMessageType));
const CATEGORIES = new Set(Object.values(EmailMessageCategory));

type TemplateJson = {
  metadata: EmailTemplateMetadata;
  subject: string;
  text: string;
  html: string;
};

export type TemplateRegistryValidationIssue = {
  file: string;
  message: string;
};

export function getTemplateKeys(): EmailTemplateKey[] {
  return [...TEMPLATE_KEYS];
}

export function getTemplateLocales(): EmailLocale[] {
  return [...LOCALES];
}

function assertKnownTemplatePath(locale: EmailLocale, key: EmailTemplateKey) {
  if (!LOCALES.includes(locale) || !TEMPLATE_KEYS.includes(key)) {
    throw new Error("Unknown email template.");
  }
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function loadTemplate(
  key: EmailTemplateKey,
  locale: EmailLocale,
): LoadedEmailTemplate {
  assertKnownTemplatePath(locale, key);
  const filePath = path.join(TEMPLATE_ROOT, locale, key, "template.json");
  const data = readJsonFile<TemplateJson>(filePath);
  validateTemplateData(data, filePath);
  return data;
}

export function loadFooter(locale: EmailLocale): { text: string; html: string } {
  if (!LOCALES.includes(locale)) {
    throw new Error("Unknown email footer locale.");
  }
  const filePath = path.join(TEMPLATE_ROOT, "shared", locale, "footer.json");
  const data = readJsonFile<{ text: string; html: string }>(filePath);
  if (!data.text || !data.html) {
    throw new Error(`Invalid email footer: ${filePath}`);
  }
  return data;
}

function validateVariables(
  variables: TemplateVariableDefinition[],
  filePath: string,
): TemplateRegistryValidationIssue[] {
  const issues: TemplateRegistryValidationIssue[] = [];
  const seen = new Set<string>();
  for (const variable of variables) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(variable.name)) {
      issues.push({ file: filePath, message: `Invalid variable name ${variable.name}` });
    }
    if (seen.has(variable.name)) {
      issues.push({ file: filePath, message: `Duplicate variable ${variable.name}` });
    }
    seen.add(variable.name);
    if (variable.type !== "string" && variable.type !== "url") {
      issues.push({ file: filePath, message: `Invalid variable type ${variable.name}` });
    }
  }
  return issues;
}

export function validateTemplateData(
  data: TemplateJson,
  filePath: string,
): TemplateRegistryValidationIssue[] {
  const issues: TemplateRegistryValidationIssue[] = [];
  const { metadata } = data;
  if (!metadata) {
    return [{ file: filePath, message: "Missing metadata." }];
  }
  if (!TEMPLATE_KEYS.includes(metadata.key)) {
    issues.push({ file: filePath, message: `Unknown template key ${metadata.key}` });
  }
  if (!LOCALES.includes(metadata.locale)) {
    issues.push({ file: filePath, message: `Unknown locale ${metadata.locale}` });
  }
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) {
    issues.push({ file: filePath, message: "Template version must be semver." });
  }
  if (!MESSAGE_TYPES.has(metadata.messageType)) {
    issues.push({ file: filePath, message: "Invalid message type." });
  }
  if (!CATEGORIES.has(metadata.category)) {
    issues.push({ file: filePath, message: "Invalid category." });
  }
  if (!RUNTIME_ENABLED_KEYS.has(metadata.key) && metadata.runtimeEnabled) {
    issues.push({
      file: filePath,
      message: "Only Stage 3.13B/3.13C templates may be runtime-enabled.",
    });
  }
  if (RUNTIME_ENABLED_KEYS.has(metadata.key) && !metadata.runtimeEnabled) {
    issues.push({
      file: filePath,
      message: `${metadata.key} must be runtime-enabled.`,
    });
  }
  if (!data.subject || !data.text || !data.html) {
    issues.push({ file: filePath, message: "Subject, text, and html are required." });
  }
  issues.push(...validateVariables(metadata.variables, filePath));
  if (issues.length > 0) {
    throw new Error(
      issues.map((issue) => `${issue.file}: ${issue.message}`).join("\n"),
    );
  }
  return issues;
}

export function validateTemplateRegistry(): TemplateRegistryValidationIssue[] {
  const issues: TemplateRegistryValidationIssue[] = [];
  const seen = new Set<string>();
  for (const locale of LOCALES) {
    try {
      loadFooter(locale);
    } catch (error) {
      issues.push({
        file: path.join(TEMPLATE_ROOT, "shared", locale, "footer.json"),
        message: error instanceof Error ? error.message : "Invalid footer.",
      });
    }
    for (const key of TEMPLATE_KEYS) {
      const filePath = path.join(TEMPLATE_ROOT, locale, key, "template.json");
      try {
        const template = loadTemplate(key, locale);
        const uniqueKey = `${template.metadata.key}:${template.metadata.locale}`;
        if (seen.has(uniqueKey)) {
          issues.push({ file: filePath, message: `Duplicate ${uniqueKey}` });
        }
        seen.add(uniqueKey);
      } catch (error) {
        issues.push({
          file: filePath,
          message: error instanceof Error ? error.message : "Invalid template.",
        });
      }
    }
  }
  return issues;
}

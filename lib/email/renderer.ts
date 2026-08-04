import { loadFooter, loadTemplate } from "@/lib/email/templates";
import type {
  EmailLocale,
  EmailTemplateKey,
  LoadedEmailTemplate,
  RenderedEmailTemplate,
  TemplateVariableDefinition,
} from "@/lib/email/types";

const PLACEHOLDER = /\{\{([a-z][a-zA-Z0-9]*)\}\}/g;
const MAX_SUBJECT_LENGTH = 160;
const MAX_TEXT_LENGTH = 64_000;
const MAX_HTML_LENGTH = 128_000;
const SAFE_URL_PROTOCOLS = new Set(["https:", "http:"]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL variable: ${name}.`);
  }
  if (!SAFE_URL_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Unsafe URL scheme for variable: ${name}.`);
  }
  if (url.username || url.password) {
    throw new Error(`URL credentials are not allowed for variable: ${name}.`);
  }
  return url.toString();
}

function buildVariableMap(
  definitions: TemplateVariableDefinition[],
  values: Record<string, string>,
  html: boolean,
) {
  const allowed = new Set(definitions.map((definition) => definition.name));
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown email template variable: ${key}.`);
    }
  }

  const output = new Map<string, string>();
  for (const definition of definitions) {
    const rawValue = values[definition.name];
    if (definition.required && (rawValue === undefined || rawValue === "")) {
      throw new Error(`Missing required email template variable: ${definition.name}.`);
    }
    if (rawValue === undefined) continue;
    const value =
      definition.type === "url" ? validateUrl(rawValue, definition.name) : rawValue;
    output.set(definition.name, html ? escapeHtml(value) : value);
  }
  return output;
}

function renderString(
  source: string,
  definitions: TemplateVariableDefinition[],
  values: Record<string, string>,
  html = false,
) {
  const variables = buildVariableMap(definitions, values, html);
  return source.replace(PLACEHOLDER, (_match, name: string) => {
    if (!variables.has(name)) {
      throw new Error(`Template references unavailable variable: ${name}.`);
    }
    return variables.get(name)!;
  });
}

function assertNoUnknownPlaceholders(template: LoadedEmailTemplate) {
  const allowed = new Set(template.metadata.variables.map((variable) => variable.name));
  const sources = [template.subject, template.text, template.html];
  for (const source of sources) {
    for (const match of source.matchAll(PLACEHOLDER)) {
      if (!allowed.has(match[1])) {
        throw new Error(`Template contains unknown placeholder: ${match[1]}.`);
      }
    }
  }
}

function stripSubjectControls(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Rendered subject contains forbidden line breaks.");
  }
  return value.trim();
}

function assertRenderedSize(rendered: RenderedEmailTemplate) {
  if (rendered.subject.length > MAX_SUBJECT_LENGTH) {
    throw new Error("Rendered subject is too large.");
  }
  if (rendered.textBody.length > MAX_TEXT_LENGTH) {
    throw new Error("Rendered text body is too large.");
  }
  if (rendered.htmlBody.length > MAX_HTML_LENGTH) {
    throw new Error("Rendered HTML body is too large.");
  }
}

export function renderEmailTemplate(params: {
  key: EmailTemplateKey;
  locale: EmailLocale;
  variables: Record<string, string>;
}): RenderedEmailTemplate {
  const template = loadTemplate(params.key, params.locale);
  const footer = loadFooter(params.locale);
  assertNoUnknownPlaceholders(template);

  const definitions = template.metadata.variables;
  const rendered: RenderedEmailTemplate = {
    subject: stripSubjectControls(
      renderString(template.subject, definitions, params.variables, false),
    ),
    textBody: `${renderString(template.text, definitions, params.variables, false)}\n\n${renderString(
      footer.text,
      definitions,
      params.variables,
      false,
    )}`,
    htmlBody: `${renderString(template.html, definitions, params.variables, true)}\n${renderString(
      footer.html,
      definitions,
      params.variables,
      true,
    )}`,
    templateVersion: template.metadata.version,
  };
  assertRenderedSize(rendered);
  return rendered;
}

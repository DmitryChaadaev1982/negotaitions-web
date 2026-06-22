import type { Dictionary } from "./dictionaries/types";

type Primitive = string | number;

type PathLeaves<T, Prefix extends string = ""> = T extends Primitive
  ? Prefix extends ""
    ? never
    : Prefix
  : {
      [K in keyof T & string]: PathLeaves<
        T[K],
        Prefix extends "" ? K : `${Prefix}.${K}`
      >;
    }[keyof T & string];

export type TranslationKey = PathLeaves<Dictionary>;

function getNestedValue(
  dictionary: Dictionary,
  key: string,
): string | undefined {
  const parts = key.split(".");
  let current: unknown = dictionary;

  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" ? current : undefined;
}

export function translate(
  dictionary: Dictionary,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = getNestedValue(dictionary, key) ?? key;

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, paramKey: string) => {
    const value = params[paramKey];
    return value === undefined ? `{${paramKey}}` : String(value);
  });
}

export function translateValidation(
  dictionary: Dictionary,
  message: string,
  params?: Record<string, string | number>,
): string {
  const validationKey = `validation.${message}` as TranslationKey;
  const translated = getNestedValue(dictionary, validationKey);

  if (!translated) {
    return message;
  }

  if (!params) {
    return translated;
  }

  return translated.replace(/\{(\w+)\}/g, (_, paramKey: string) => {
    const value = params[paramKey];
    return value === undefined ? `{${paramKey}}` : String(value);
  });
}

import type { Locale } from "../config";
import { en } from "./en";
import { ru } from "./ru";
import type { Dictionary } from "./types";

const dictionaries: Record<Locale, Dictionary> = {
  en,
  ru,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? en;
}

export type { Dictionary };

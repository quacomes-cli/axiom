import { createSignal } from "solid-js";
import { en } from "./locales/en";
import { tr } from "./locales/tr";
import { es } from "./locales/es";
import { de } from "./locales/de";
import { fr } from "./locales/fr";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { ja } from "./locales/ja";
import { zh } from "./locales/zh";

export type Dict = typeof en;

export const LOCALES = { en, tr, es, de, fr, pt, ru, ja, zh } as const;
export type Locale = keyof typeof LOCALES;

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];

export function resolveLocale(): Locale {
  const sys = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  const base = sys.split("-")[0];
  if (base in LOCALES) return base as Locale;
  return "en";
}

const [locale, setLocaleSig] = createSignal<Locale>(resolveLocale());

export function getLocale(): Locale {
  return locale();
}

export function setLocale(next: Locale): void {
  if (next in LOCALES) {
    setLocaleSig(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", next);
    }
  }
}

function lookup(dict: unknown, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const current = locale(); // solid reactivity trigger
  let val = lookup(LOCALES[current], key) ?? lookup(LOCALES.en, key) ?? key;
  if (params) {
    val = val.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in params ? String(params[k]) : `{{${k}}}`));
  }
  return val;
}

export function useT(): typeof t {
  return t;
}

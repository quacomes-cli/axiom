// Hafif, bağımlılıksız i18n. i18next yerine ~80 satır — kod felsefesine uygun
// (bkz. elle yazılmış MCP client). Sözlükler iç içe nesnelerdir; erişim nokta
// yoluyla: t("settings.tabs.general"). Çözüm sırası: aktif dil → İngilizce
// fallback → ham anahtar. {{placeholder}} interpolasyonu desteklenir.
//
// Re-render: React bileşenleri useT() ile dile abone olur (useSyncExternalStore),
// dil değişince yeniden çizilir. React dışı modüller (store, notify) doğrudan
// t() çağırır.

import { useSyncExternalStore } from "react";
import { en } from "./locales/en";
import { tr } from "./locales/tr";
import { es } from "./locales/es";
import { de } from "./locales/de";
import { fr } from "./locales/fr";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { ja } from "./locales/ja";
import { zh } from "./locales/zh";

/** İngilizce sözlük şeklin tek doğruluk kaynağı — diğerleri buna uymak zorunda. */
export type Dict = typeof en;

export const LOCALES = { en, tr, es, de, fr, pt, ru, ja, zh } as const;
export type Locale = keyof typeof LOCALES;

/** Ayarlar menüsündeki dil listesi (kendi dilinde etiketlenir). */
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

let current: Locale = "en";
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  const l: Locale = next in LOCALES ? next : "en";
  if (l === current) return;
  current = l;
  if (typeof document !== "undefined") document.documentElement.setAttribute("lang", l);
  listeners.forEach((f) => f());
}

/**
 * settings.language ("system" | ISO kod) → somut Locale.
 * "system": OS/tarayıcı dilini algıla; desteklenmiyorsa İngilizce'ye düş.
 */
export function resolveLocale(setting: string | null | undefined): Locale {
  if (setting && setting !== "system" && setting in LOCALES) return setting as Locale;
  const sys = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  const base = sys.split("-")[0];
  if (base in LOCALES) return base as Locale;
  return "en";
}

/** Ayardan gelen değeri çözüp aktif dili uygular (settingsStore çağırır). */
export function applyLocaleFromSetting(setting: string | null | undefined): void {
  setLocale(resolveLocale(setting));
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
  let val = lookup(LOCALES[current], key) ?? lookup(LOCALES.en, key) ?? key;
  if (params) {
    val = val.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in params ? String(params[k]) : `{{${k}}}`));
  }
  return val;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Bileşenlerde: `const t = useT();` — dil değişince yeniden render tetikler. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

import { useSyncExternalStore } from 'react';

export type Locale = 'ko' | 'en';
export type TranslationParams = Record<string, string | number>;
export const localeStorageKey = 'ezerd.locale';
const english: Record<string, string> = Object.create(null);
const listeners = new Set<() => void>();
export function readStoredLocale(): Locale {
  try {
    return globalThis.localStorage?.getItem(localeStorageKey) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
}
let locale = readStoredLocale();
function updateDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
updateDocumentLanguage();
export function registerTranslations(translations: Record<string, string>) {
  Object.assign(english, translations);
}
export function getLocale(): Locale {
  return locale;
}
export function setLocale(next: Locale) {
  locale = next === 'en' ? 'en' : 'ko';
  try {
    globalThis.localStorage?.setItem(localeStorageKey, locale);
  } catch {
    // Language changes still work when browser storage is unavailable.
  }
  updateDocumentLanguage();
  listeners.forEach((listener) => listener());
}
export function translate(key: string, params?: TranslationParams, context?: string): string {
  const text = locale === 'en' ? (english[context ? `${context}:${key}` : key] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
export const t = translate;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, () => 'ko' as const);
  return { t: translate, locale, setLocale };
}

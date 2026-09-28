import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLocale,
  localeStorageKey,
  readStoredLocale,
  registerTranslations,
  setLocale,
  translate,
} from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('ko');
});
describe('display language', () => {
  it('keeps context-specific meanings independent of catalog registration order', () => {
    registerTranslations({ 수정: 'Edit', 'date:수정': 'Updated' });
    setLocale('en');
    expect(translate('수정')).toBe('Edit');
    expect(translate('수정', undefined, 'date')).toBe('Updated');
    setLocale('ko');
    expect(translate('수정', undefined, 'date')).toBe('수정');
  });
  it('defaults to Korean for missing or unsupported saved settings', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(readStoredLocale()).toBe('ko');
    vi.stubGlobal('localStorage', { getItem: () => 'fr' });
    expect(readStoredLocale()).toBe('ko');
  });
  it('persists English and updates the document language', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const document = { documentElement: { lang: '' } };
    vi.stubGlobal('document', document);
    setLocale('en');
    expect(values.get(localeStorageKey)).toBe('en');
    expect(readStoredLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    setLocale('ko');
    expect(document.documentElement.lang).toBe('ko');
  });
  it('continues to switch language when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Error('blocked');
      },
      setItem: () => {
        throw Error('blocked');
      },
    });
    expect(readStoredLocale()).toBe('ko');
    setLocale('en');
    expect(getLocale()).toBe('en');
  });
  it('translates registered strings, preserves unknown text and interpolates values', () => {
    registerTranslations({ '안녕 {name}': 'Hello {name}', '{count}개': '{count} items' });
    expect(translate('안녕 {name}', { name: '민수' })).toBe('안녕 민수');
    setLocale('en');
    expect(translate('안녕 {name}', { name: '민수' })).toBe('Hello 민수');
    expect(translate('{count}개', { count: 0 })).toBe('0 items');
    expect(translate('User data stays unchanged')).toBe('User data stays unchanged');
    expect(translate('안녕 {name}')).toBe('Hello {name}');
    expect(translate('안녕 {name}', { name: '{count}' })).toBe('Hello {count}');
  });
});

import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../shared/i18n/index.js';
import { HelpDialog } from './HelpDialog.js';

// Inspect the actual dialog content with SSR; portal placement and focus are browser concerns.
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('ko');
});

describe('native database help guidance', () => {
  it.each(['ko', 'en'] as const)(
    'renders current %s product guidance and keeps the help controls',
    (locale) => {
      setLocale(locale);
      vi.stubGlobal('document', { body: {}, documentElement: { lang: locale } });
      const onClose = vi.fn();
      const html = renderToStaticMarkup(createElement(HelpDialog, { onClose }));
      expect(html).toContain('<dialog');
      expect(html).toContain('aria-labelledby=');
      expect(html.match(/<button\b/g)).toHaveLength(1);
      for (const database of ['PostgreSQL', 'MySQL', 'SQLite']) expect(html).toContain(database);
      for (const text of locale === 'ko'
        ? [
            '별 타입과 검증된 기능',
            '프로젝트 전체 물리 설계',
            '최신 상태를 다시 검증',
            '지원이 확인된 범위만 변환',
            '의미 손실',
            '명시적으로 업그레이드',
            '원문은 진단과 함께 보존',
            '프로젝트 만들기',
            '닫기',
          ]
        : [
            'database-specific types and verified features',
            'entire physical design',
            'latest state when applied',
            'only verified conversions',
            'lose meaning',
            'explicit upgrade',
            'preserved with diagnostics',
            'Create a project',
          ]) {
        expect(html).toContain(text);
      }
      for (const obsolete of [
        '분류 정보입니다',
        'PostgreSQL을 기준으로 제공',
        'classification metadata',
        'currently target PostgreSQL',
      ]) {
        expect(html).not.toContain(obsolete);
      }
      expect(onClose).not.toHaveBeenCalled();
    },
  );
});

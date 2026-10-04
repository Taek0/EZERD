import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import { NativeFormatEditor } from './native-editor-format.js';
import { setLocale } from '../../shared/i18n/index.js';

afterEach(() => setLocale('ko'));
describe('native availability hints reflect actual selected DB and condition', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    '%s ready table options do not report other-engine features as unverified',
    (kind) => {
      const f = advancedFixture(kind);
      const html = renderToStaticMarkup(
        createElement(NativeFormatEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
        }),
      );
      expect(html).not.toContain('미구현 또는 실행 검증 미완료');
      expect(html).not.toContain('이 DB에서 지원하지 않음');
    },
  );
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    '%s ready clock default choices do not contain a blanket unverified label',
    (kind) => {
      const f = advancedFixture(kind),
        column = f.columns[0]!;
      column.physical.type =
        kind === 'postgresql'
          ? { kind: 'builtin', database: kind, typeId: 'postgresql:timestamp', parameters: {} }
          : kind === 'mysql'
            ? { kind: 'builtin', database: kind, typeId: 'mysql:timestamp', parameters: {} }
            : { kind: 'builtin', database: kind, typeId: 'sqlite:text', parameters: {} };
      const html = renderToStaticMarkup(
        createElement(NativeFormatEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
          column,
        }),
      );
      const option = html.match(/<option[^>]*value="expression"[^>]*>(.*?)<\/option>/)?.[1];
      expect(option).toContain('엔진에서 허용');
      expect(option).not.toContain('제품 검증 미완료');
    },
  );
  it('does not label stored verified identity parameters as product-unverified', () => {
    const f = advancedFixture('postgresql'),
      column = f.columns[0]!;
    column.physical.generation = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
      sequence: { start: '7', increment: '2', cache: 1 },
    };
    const html = renderToStaticMarkup(
      createElement(NativeFormatEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
        column,
      }),
    );
    expect(html).toContain('Identity start');
    expect(html).not.toContain('<p>제품 검증 미완료</p>');
  });
});

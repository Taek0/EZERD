import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../../shared/i18n/index.js';
import { NativeExpressionTreeEditor } from './native-expression-tree.js';
import { NativeIndexOptionsEditor } from './native-index-options.js';
import { NativeAdvancedEditor, NativeAdvancedExpressionForm } from './NativeAdvancedEditor.js';
import { NativeStructureEditor } from './native-editor-structure.js';
import { nativeIndexDraft, nativeAdvancedExpressionFacts } from './native-advanced-policy.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

afterEach(() => setLocale('ko'));
describe('advanced editor static meaning and readonly controls', () => {
  it('opens the archived target via the existing initialSelection contract and accepts recovery revision remounts', () => {
    const f = advancedFixture();
    f.columns[0]!.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: 'archived_original()',
    };
    const html = renderToStaticMarkup(
      createElement(NativeAdvancedEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
        initialSelection: JSON.stringify(['default', 'a']),
        recoveryRevision: 'archived-revision',
      }),
    );
    expect(html).toContain('archived_original()');
    expect(html).toContain('open=""');
    expect(f.context.onSave).not.toHaveBeenCalled();
    const broken = renderToStaticMarkup(
      createElement(NativeAdvancedEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
        initialSelection: '{broken',
      }),
    );
    expect(broken).toContain('보관된 초안은 그대로 유지');
    expect(broken).not.toContain('<form');
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'shows only %s index option union with the current advanced saving gate',
    (kind) => {
      const f = advancedFixture(kind),
        value = nativeIndexDraft(f.document, f.table);
      value.name = 'index';
      const changed = vi.fn();
      const html = renderToStaticMarkup(
        createElement(NativeIndexOptionsEditor, {
          document: f.document,
          table: f.table,
          value,
          onChange: changed,
        }),
      );
      expect(html.includes('포함 컬럼')).toBe(kind === 'postgresql');
      expect(html.includes('NULL을 같은 값으로 취급')).toBe(kind === 'postgresql');
      expect(html.includes('보이지 않는 인덱스')).toBe(kind === 'mysql');
      expect(html.includes('조건 식 추가')).toBe(kind !== 'mysql');
      expect(html.includes('value="gin"')).toBe(kind === 'postgresql');
      expect(html.includes('value="fulltext"')).toBe(kind === 'mysql');
      expect(changed).not.toHaveBeenCalled();
      const editor = renderToStaticMarkup(
        createElement(NativeAdvancedEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
        }),
      );
      expect(editor).toContain('고급 인덱스·식 편집');
      expect(editor).toContain('검증 미완료');
      expect(editor).toMatch(/type="submit"[^>]*disabled=""/);
    },
  );
  it.each(['ko', 'en'] as const)(
    'renders a nested tree with current-DB functions and readonly fields in %s',
    (locale) => {
      setLocale(locale);
      const f = advancedFixture(),
        changed = vi.fn();
      const html = renderToStaticMarkup(
        createElement(NativeExpressionTreeEditor, {
          database: f.document.database,
          facts: nativeAdvancedExpressionFacts(f.document, f.table, 'check'),
          value: JSON.stringify({
            kind: 'binary',
            operator: 'AND',
            left: {
              kind: 'binary',
              operator: '>',
              left: {
                kind: 'call',
                functionId: 'postgresql:abs',
                args: [{ kind: 'column', columnId: 'a' }],
              },
              right: { kind: 'literal', literalType: 'number', value: '0' },
            },
            right: { kind: 'isNull', negate: true, operand: { kind: 'column', columnId: 'b' } },
          }),
          onChange: changed,
          disabled: true,
        }),
      );
      expect(html).toContain('postgresql:abs');
      expect(html).not.toContain('mysql:');
      expect(html).not.toContain('sqlite:');
      expect(html).toContain('<fieldset disabled="">');
      expect(html).toContain(locale === 'ko' ? '함수 인자' : 'Function argument');
      expect(changed).not.toHaveBeenCalled();
    },
  );
  it('labels invalid and foreign current functions without rewriting the original draft', () => {
    const f = advancedFixture(),
      value = JSON.stringify({ kind: 'call', functionId: 'mysql:uuid', args: [] }),
      changed = vi.fn();
    const html = renderToStaticMarkup(
      createElement(NativeExpressionTreeEditor, {
        database: f.document.database,
        facts: nativeAdvancedExpressionFacts(f.document, f.table, 'index'),
        value,
        onChange: changed,
      }),
    );
    expect(html).toContain('mysql:uuid');
    expect(html).toContain('현재 원문 유지');
    expect(html).toContain('expression.function-not-supported');
    expect(changed).not.toHaveBeenCalled();
  });
  it('renders an incomplete token verbatim and a damaged draft recovery notice', () => {
    const f = advancedFixture(),
      changed = vi.fn(),
      props = {
        database: f.document.database,
        facts: nativeAdvancedExpressionFacts(f.document, f.table, 'default', f.columns[0]),
        onChange: changed,
      };
    const html = renderToStaticMarkup(
      createElement(NativeExpressionTreeEditor, {
        ...props,
        value: JSON.stringify({ kind: 'literal', literalType: 'number', value: '20e' }),
      }),
    );
    expect(html).toContain('value="20e"');
    expect(html).toContain('저장되지 않습니다');
    expect(
      renderToStaticMarkup(createElement(NativeExpressionTreeEditor, { ...props, value: '{bad' })),
    ).toContain('입력 초기화');
    expect(changed).not.toHaveBeenCalled();
  });
  it('displays legacy default preservation and disables the full form for readonly users', () => {
    const f = advancedFixture();
    f.columns[0]!.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: '  site_function(20)  ',
    };
    const html = renderToStaticMarkup(
      createElement(NativeAdvancedExpressionForm, {
        context: f.context,
        document: f.document,
        table: f.table,
        target: { kind: 'default', columnId: 'a' },
        readOnly: true,
      }),
    );
    expect(html).toContain('site_function(20)');
    expect(html).toContain('현재 원문을 유지합니다.');
    expect(html).toContain('<fieldset disabled="">');
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it('connects the separate editor to the existing structure view without replacing basic controls', () => {
    const f = advancedFixture();
    const html = renderToStaticMarkup(
      createElement(NativeStructureEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
      }),
    );
    expect(html).toContain('구조 편집');
    expect(html).toContain('새 외래 키');
    expect(html).toContain('고급 인덱스·식 편집');
    expect(html).toContain('새 복합 CHECK');
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it('does not expose editable writes for archived projects and logical tables', () => {
    const f = advancedFixture();
    f.snapshot.project.status = 'archived';
    f.table.scope = 'logical';
    const html = renderToStaticMarkup(
      createElement(NativeAdvancedEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
      }),
    );
    expect(html).toContain('고급 편집은 현재 DB의 물리 테이블에서만');
    expect(html).toContain('<fieldset disabled="">');
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
});

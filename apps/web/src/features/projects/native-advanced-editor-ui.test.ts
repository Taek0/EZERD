import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../../shared/i18n/index.js';
import { NativeExpressionTreeEditor } from './native-expression-tree.js';
import { NativeExpressionFields, nativeExpressionFromInputs } from './native-editor-expression.js';
import { NativeIndexOptionsEditor } from './native-index-options.js';
import { NativeAdvancedEditor, NativeAdvancedExpressionForm } from './NativeAdvancedEditor.js';
import { NativeStructureEditor } from './native-editor-structure.js';
import { nativeIndexDraft, nativeAdvancedExpressionFacts } from './native-advanced-policy.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

afterEach(() => setLocale('ko'));
describe('advanced editor static meaning and readonly controls', () => {
  it.each(['ko', 'en'] as const)(
    'separates item selection from expression selection in %s',
    (locale) => {
      setLocale(locale);
      const f = advancedFixture();
      const html = renderToStaticMarkup(
        createElement(NativeAdvancedEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
        }),
      );
      const item = locale === 'ko' ? '생성하려는 항목 선택' : 'Select an item to create';
      const expression = locale === 'ko' ? '생성하려는 식 선택' : 'Select an expression to create';
      const detail = locale === 'ko' ? '선택한 항목 편집' : 'Edit the selected item';
      expect(html).toContain(item);
      expect(html).toContain(expression);
      expect(html.indexOf(item)).toBeLessThan(html.indexOf(detail));
      expect(html.indexOf(detail)).toBeLessThan(html.indexOf(expression));
      expect(f.context.onSave).not.toHaveBeenCalled();
    },
  );
  it('keeps nested incomplete input mounted inside collapsible expression groups', () => {
    const f = advancedFixture(),
      changed = vi.fn();
    const html = renderToStaticMarkup(
      createElement(NativeExpressionTreeEditor, {
        database: f.document.database,
        facts: nativeAdvancedExpressionFacts(f.document, f.table, 'index'),
        value: JSON.stringify({
          kind: 'binary',
          operator: '+',
          left: { kind: 'literal', literalType: 'number', value: '20e' },
          right: { kind: 'column', columnId: 'a' },
        }),
        onChange: changed,
      }),
    );
    expect(html).toContain('왼쪽 · 리터럴');
    expect(html).toContain('오른쪽 · 컬럼 참조');
    expect(html).toContain('기존 식 묶기');
    expect(html).toContain('value="20e"');
    expect(html).toContain('기존 식을 합으로 묶기');
    expect(changed).not.toHaveBeenCalled();
  });
  it('groups comparison fields without changing their input conversion', () => {
    const f = advancedFixture(),
      change = vi.fn();
    const values = {
      expressionColumn: 'a',
      expressionOperator: '>',
      expressionLiteralType: 'number',
      expressionValue: '20e',
    };
    const html = renderToStaticMarkup(
      createElement(NativeExpressionFields, {
        values,
        change,
        columns: f.columns,
        disabled: true,
      }),
    );
    expect(html).toContain('<legend>비교할 컬럼과 연산자</legend>');
    expect(html).toContain('<legend>비교할 값</legend>');
    expect(html).toContain('value="20e"');
    expect(html.match(/<fieldset disabled="">/g)).toHaveLength(2);
    expect(nativeExpressionFromInputs({ ...values, expressionValue: '20' })).toEqual({
      kind: 'binary',
      operator: '>',
      left: { kind: 'column', columnId: 'a' },
      right: { kind: 'literal', literalType: 'number', value: '20' },
    });
    expect(change).not.toHaveBeenCalled();
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'shows bilingual empty-table guidance instead of raw validator JSON for %s',
    (kind) => {
      const f = advancedFixture(kind);
      f.document.columns = [];
      const value = nativeIndexDraft(f.document, f.table),
        changed = vi.fn();
      for (const locale of ['ko', 'en'] as const) {
        setLocale(locale);
        const options = renderToStaticMarkup(
          createElement(NativeIndexOptionsEditor, {
            document: f.document,
            table: f.table,
            value,
            onChange: changed,
          }),
        );
        const html = renderToStaticMarkup(
          createElement(NativeAdvancedEditor, {
            context: f.context,
            document: f.document,
            table: f.table,
          }),
        );
        const guidance =
          locale === 'ko'
            ? '인덱스 키 컬럼을 먼저 추가하세요.'
            : 'Add a column for the index key first.';
        expect(html).toContain(guidance);
        if (kind !== 'sqlite') {
          expect(options).toContain(guidance);
          expect(options).toMatch(/<option value="btree"/);
          expect(options).toMatch(/<option value="(?:hash|fulltext)" disabled=""/);
        }
        for (const output of [options, html]) {
          for (const forbidden of [
            'origin',
            'too_small',
            'minimum',
            '&quot;path&quot;',
            'ZodError',
            'index.key-columns-required',
          ])
            expect(output).not.toContain(forbidden);
        }
        expect(html).not.toMatch(/<button\b(?=[^>]*type="submit")(?![^>]*disabled="")[^>]*>/);
      }
      expect(changed).not.toHaveBeenCalled();
      expect(f.context.onSave).not.toHaveBeenCalled();
      expect(value.parts).toEqual([]);
    },
  );
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
      expect(editor).not.toMatch(/<button\b(?=[^>]*type="submit")(?![^>]*disabled="")[^>]*>/);
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
    expect(html).toContain('이 DB에서 지원하는 함수를 선택하세요. 현재 원문은 유지됩니다.');
    expect(html).not.toContain('expression.function-not-supported');
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
    const damaged = renderToStaticMarkup(
      createElement(NativeExpressionTreeEditor, { ...props, value: '{bad' }),
    );
    expect(damaged).toContain('원문은 유지됩니다');
    expect(damaged).not.toContain('입력 초기화');
    expect(changed).not.toHaveBeenCalled();
  });
  it('shows missing-column guidance for incomplete tree probes without rewriting them', () => {
    const f = advancedFixture(),
      changed = vi.fn(),
      value = JSON.stringify({ kind: 'column', columnId: '' });
    f.document.columns = [];
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      const html = renderToStaticMarkup(
        createElement(NativeExpressionTreeEditor, {
          database: f.document.database,
          facts: nativeAdvancedExpressionFacts(f.document, f.table, 'index'),
          value,
          onChange: changed,
        }),
      );
      expect(html).toContain(
        locale === 'ko'
          ? '식에서 사용할 컬럼을 선택하세요.'
          : 'Select a column for the expression.',
      );
      for (const forbidden of [
        '&quot;origin&quot;',
        'too_small',
        'minimum',
        'ZodError',
        'expression.column-required',
      ])
        expect(html).not.toContain(forbidden);
    }
    expect(changed).not.toHaveBeenCalled();
    expect(value).toBe('{"kind":"column","columnId":""}');
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

// These policy tests inspect option props. RAC's SSR hidden select omits disabled
// attributes; the actual common Select is exercised by browser/UI tests.
vi.mock('../../components/ui/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/ui/index.js')>();
  return {
    ...actual,
    Select: ({
      children,
      value,
      disabled,
    }: {
      children: import('react').ReactNode;
      value?: string;
      disabled?: boolean;
    }) => createElement('select', { value, disabled, onChange() {} }, children),
  };
});

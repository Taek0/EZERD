import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NativeExpressionTreeEditor } from './native-expression-tree.js';
import { NativeIndexOptionsEditor } from './native-index-options.js';
import { NativeAdvancedEditor } from './NativeAdvancedEditor.js';
import { nativeAdvancedExpressionFacts, nativeIndexDraft } from './native-advanced-policy.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

vi.mock('../../shared/i18n/index.js', () => ({
  useI18n: () => ({ t: (text: string) => text }),
  translate: (text: string) => text,
  registerTranslations() {},
}));

describe('advanced expression progressive disclosure', () => {
  it('orders kind, target and core settings and restores the selected expression category', () => {
    const f = advancedFixture();
    const html = renderToStaticMarkup(
      createElement(NativeAdvancedEditor, {
        document: f.document,
        table: f.table,
        context: f.context,
        initialSelection: JSON.stringify(['default', 'a']),
      }),
    );
    expect(html.indexOf('항목 종류')).toBeLessThan(html.indexOf('편집 대상'));
    expect(html.indexOf('편집 대상')).toBeLessThan(html.indexOf('핵심 설정'));
    expect(html).toContain('현재 원문');
    expect(html).toContain('기본값 식');
    expect(f.context.onSave.mock.calls).toHaveLength(0);
  });
  it('keeps optional index settings mounted but collapsed without emitting changes', () => {
    const f = advancedFixture();
    const onChange = vi.fn();
    const value = nativeIndexDraft(f.document, f.table);
    const before = JSON.stringify(value);
    const html = renderToStaticMarkup(
      createElement(NativeIndexOptionsEditor, {
        document: f.document,
        table: f.table,
        value,
        onChange,
      }),
    );
    expect(html).toContain('<details class="native-index-options">');
    expect(html).toContain('포함 컬럼');
    expect(html.indexOf('인덱스 방식')).toBeLessThan(html.indexOf('native-index-options'));
    expect(html).toContain('조건 식 추가');
    expect(onChange.mock.calls).toHaveLength(0);
    expect(JSON.stringify(value)).toBe(before);
  });

  it('collapses complex child trees while keeping simple operands available', () => {
    const f = advancedFixture();
    const onChange = vi.fn();
    const value = JSON.stringify({
      kind: 'binary',
      operator: '+',
      left: {
        kind: 'binary',
        operator: '+',
        left: { kind: 'column', columnId: 'a' },
        right: { kind: 'column', columnId: 'b' },
      },
      right: { kind: 'literal', literalType: 'number', value: '1' },
    });
    const html = renderToStaticMarkup(
      createElement(NativeExpressionTreeEditor, {
        database: f.document.database,
        facts: nativeAdvancedExpressionFacts(f.document, f.table, 'index'),
        value,
        onChange,
        disabled: true,
      }),
    );
    const branches = html.match(/<details[^>]*native-expression-branch[^>]*>/g) ?? [];
    expect(branches.length).toBeGreaterThan(1);
    expect(branches[0]?.includes('open=""')).toBe(false);
    expect(branches.some((branch) => branch.includes('open=""'))).toBe(true);
    expect(html).toContain('disabled=""');
    expect(onChange.mock.calls).toHaveLength(0);
  });
});

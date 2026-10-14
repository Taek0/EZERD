import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { NativeAdvancedEditor, sameAdvancedValues } from './NativeAdvancedEditor.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
describe('advanced editor closed boundary', () => {
  it('does not mount an unused collapsed form but reveals an explicit recovery target', () => {
    const f = advancedFixture();
    const props = { document: f.document, table: f.table, context: f.context };
    const closed = renderToStaticMarkup(createElement(NativeAdvancedEditor, props));
    expect(closed).toContain('고급 인덱스');
    expect(closed).not.toContain('새 고급 인덱스');
    const opened = renderToStaticMarkup(
      createElement(NativeAdvancedEditor, { ...props, initialSelection: 'index:new' }),
    );
    expect(opened).toContain('새 고급 인덱스');
  });
  it('treats removed or changed draft fields as dirty rather than suspending evaluation', () => {
    expect(sameAdvancedValues({ a: '1' }, { a: '1' })).toBe(true);
    expect(sameAdvancedValues({ a: '2' }, { a: '1' })).toBe(false);
    expect(sameAdvancedValues({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });
});

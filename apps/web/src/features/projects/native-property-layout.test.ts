import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { NativeLogicalModeProvider } from './NativeLogicalMode.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

describe('property sidebar logical visibility', () => {
  it.each([false, true])(
    'uses the shared logical preference (%s) without changing data',
    (enabled) => {
      const f = advancedFixture();
      f.columns[0]!.customProperties.logical = { logicalMarker: 'retained' };
      const before = structuredClone(f.document);
      const html = renderToStaticMarkup(
        createElement(NativeLogicalModeProvider, {
          enabled,
          onEnabledChange: () => {},
          children: createElement(NativePropertyEditor, {
            ...f.context,
            table: f.table,
            column: f.columns[0]!,
          }),
        }),
      );
      expect(html.includes('value="logicalMarker"')).toBe(enabled);
      expect(html.includes('<label hidden="">논리 이름')).toBe(!enabled);
      expect(html).toContain('role="combobox"');
      expect(html.indexOf('설명')).toBeLessThan(html.indexOf('기본 키(PK)'));
      expect(html.indexOf('기본 키(PK)')).toBeLessThan(html.indexOf('NULL · 기본값'));
      expect(html).not.toMatch(/<details[^>]*open/);
      expect(f.document).toEqual(before);
      expect(f.context.onSave).not.toHaveBeenCalled();
    },
  );
});

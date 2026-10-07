import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NativeDesignDetails } from './NativeDesignDetails.js';
import { NativeLogicalModeProvider } from './NativeLogicalMode.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

vi.mock('../../shared/i18n/index.js', () => ({
  useI18n: () => ({ t: (text: string) => text }),
  registerTranslations() {},
}));

describe('design details visibility and preservation', () => {
  it('renders physical cards and retains source text without mutating the document', () => {
    const f = advancedFixture();
    f.columns[0]!.physical.comment = '<raw> original comment';
    f.columns[0]!.customProperties.common = { owner: 'team & original' };
    f.columns[1]!.scope = 'logical';
    f.columns[1]!.logical.name = 'logical-only-secret';
    const before = JSON.stringify(f.document);
    const html = renderToStaticMarkup(
      createElement(NativeDesignDetails, {
        document: f.document,
        table: f.table,
        mode: 'logical',
      }),
    );
    expect(html).toContain('native-design-column');
    expect(html).toContain('&lt;raw&gt; original comment');
    expect(html).toContain('team &amp; original');
    expect(html.includes('logical-only-secret')).toBe(false);
    expect(html.includes('<table')).toBe(false);
    expect(JSON.stringify(f.document)).toBe(before);
  });

  it('shows logical semantics only with the provider enabled', () => {
    const f = advancedFixture();
    f.columns[0]!.logical.semanticType = 'business-code';
    f.columns[0]!.logical.definition = 'logical definition';
    const html = renderToStaticMarkup(
      createElement(NativeLogicalModeProvider, {
        enabled: true,
        onEnabledChange() {},
        children: createElement(NativeDesignDetails, {
          document: f.document,
          table: f.table,
          mode: 'logical',
        }),
      }),
    );
    expect(html).toContain('business-code');
    expect(html).toContain('logical definition');
    expect(html.includes('기본값·생성·DB 옵션')).toBe(false);
  });

  it('hides a logical-only table outside the provider', () => {
    const f = advancedFixture();
    f.table.scope = 'logical';
    expect(
      renderToStaticMarkup(
        createElement(NativeDesignDetails, {
          document: f.document,
          table: f.table,
          mode: 'logical',
        }),
      ),
    ).toBe('');
  });
});

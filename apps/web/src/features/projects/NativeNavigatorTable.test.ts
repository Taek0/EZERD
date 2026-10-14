import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeNavigatorTable } from './NativeNavigatorTable.js';
import { describe, expect, it } from 'vitest';
import { navigatorTableMatches } from './NativeNavigatorTable.js';

describe('navigator table and column search', () => {
  const columns = [
    {
      id: 'amount',
      name: 'amount',
      physicalName: 'amount',
      logicalName: '주문금액',
      type: 'numeric',
    },
  ];
  it('finds a table through either its own name or a contained column without matching unrelated tables', () => {
    expect(navigatorTableMatches('orders', 'orders', '주문', columns)).toBe(true);
    expect(navigatorTableMatches('AMOUNT', 'orders', '주문', columns)).toBe(true);
    expect(navigatorTableMatches('주문금액', 'orders', '주문', columns)).toBe(true);
    expect(navigatorTableMatches('customer', 'orders', '주문', columns)).toBe(false);
    expect(navigatorTableMatches('amount', 'customers', '고객', [])).toBe(false);
  });
});

it('omits closed column controls while retaining explicit expansion and search reveal', () => {
  const props = {
    name: 'orders',
    accent: '#000',
    active: false,
    expanded: false,
    onExpandedChange: () => {},
    columns: [
      {
        id: 'amount',
        name: 'amount',
        physicalName: 'amount',
        logicalName: '금액',
        type: 'numeric',
      },
    ],
    search: '',
    onSelect: () => {},
    onSelectColumn: () => {},
  };
  const closed = renderToStaticMarkup(createElement(NativeNavigatorTable, props));
  expect(closed).not.toContain('<small>numeric</small>');
  expect(closed).toContain('aria-hidden="true"');
  const opened = renderToStaticMarkup(
    createElement(NativeNavigatorTable, { ...props, expanded: true }),
  );
  expect(opened).toContain('<small>numeric</small>');
  expect(opened).toContain('aria-hidden="false"');
  expect(
    renderToStaticMarkup(createElement(NativeNavigatorTable, { ...props, search: 'amount' })),
  ).toContain('<small>numeric</small>');
});

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

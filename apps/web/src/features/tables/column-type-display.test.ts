import { it, expect } from 'vitest';
import { columnTypeDisplay } from './column-type-display.js';
it('formats physical type parameters and arrays', () => {
  expect(columnTypeDisplay({ name: 'varchar', length: 32, isArray: false })).toBe('VARCHAR(32)');
  expect(columnTypeDisplay({ name: 'numeric', precision: 10, scale: 2, isArray: true })).toBe(
    'NUMERIC(10,2)[]',
  );
  expect(columnTypeDisplay({ name: 'numeric', precision: 10, scale: 0, isArray: false })).toBe(
    'NUMERIC(10,0)',
  );
  expect(columnTypeDisplay({ name: 'timestamp', precision: 3, isArray: false })).toBe(
    'TIMESTAMP(3)',
  );
  expect(
    columnTypeDisplay({ name: 'old', enumId: 'e', isArray: false }, [
      { id: 'e', name: 'status', schema: 'public', values: ['ok'] },
    ]),
  ).toBe('STATUS');
});

import { expect, it } from 'vitest';
import { isNativeLocalOperation, markNativeLocalOperation } from './native-local-operations.js';
it('recognizes only exact recently transmitted operations for this actor and project', () => {
  markNativeLocalOperation('a', 'p', 'ours', 1000);
  expect(isNativeLocalOperation('a', 'p', 'ours', 1001)).toBe(true);
  expect(isNativeLocalOperation('a', 'p', 'mcp', 1001)).toBe(false);
  expect(isNativeLocalOperation('b', 'p', 'ours', 1001)).toBe(false);
  expect(isNativeLocalOperation('a', 'q', 'ours', 1001)).toBe(false);
  expect(isNativeLocalOperation('a', 'p', 'ours', 121000)).toBe(false);
});
it('bounds the local operation registry', () => {
  for (let i = 0; i < 257; i++) markNativeLocalOperation('a', 'bounded', String(i), 2000);
  expect(isNativeLocalOperation('a', 'bounded', '0', 2001)).toBe(false);
  expect(isNativeLocalOperation('a', 'bounded', '256', 2001)).toBe(true);
});

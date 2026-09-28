import { expect, it } from 'vitest';
import { instrumentFunctions } from '../../../performance/instrumentation.js';

it('preserves early returns and exceptions, closing spans exactly once', () => {
  const input =
    'function f(x) { if(x < 0) throw new Error("bad"); if(x === 0) return 0; return x + 1; }';
  const result = instrumentFunctions(input, ['f'], 'test', '/collector')!;
  let starts = 0,
    ends = 0;
  const factory = new Function(
    '__perfBegin',
    result.code.split('\n').slice(1).join('\n') + '; return f;',
  );
  const fn = factory(() => {
    starts++;
    return () => ends++;
  });
  expect(fn(0)).toBe(0);
  expect(fn(2)).toBe(3);
  expect(() => fn(-1)).toThrow('bad');
  expect([starts, ends]).toEqual([3, 3]);
  expect(instrumentFunctions(input, ['other'], 'test', '/collector')).toBeNull();
});

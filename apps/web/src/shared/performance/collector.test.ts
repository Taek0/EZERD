import { expect, it } from 'vitest';
import { createCollector } from './collector.js';

it('separates nested inclusive spans and bounds raw data without losing totals', () => {
  let time = 0;
  const c = createCollector(() => time, 2);
  expect(c.begin('off')).toBeUndefined();
  c.start({ fixture: 'test' });
  const outer = c.begin('outer')!;
  time = 1;
  const inner = c.begin('inner')!;
  time = 3;
  inner();
  inner();
  time = 5;
  outer();
  const next = c.begin('inner')!;
  time = 8;
  next();
  const result = c.stop();
  expect(result.elapsedMs).toBe(8);
  expect(result.dropped).toBe(1);
  expect(result.status).toBe('truncated');
  expect(result.summary.find((s) => s.name === 'inner')).toMatchObject({
    count: 2,
    totalMs: 5,
    retained: 1,
    p95Ms: null,
  });
  expect(result.summary.find((s) => s.name === 'outer')).toMatchObject({ count: 1, totalMs: 5 });
});

it('supports an off control without collecting spans', () => {
  const c = createCollector(() => 0);
  c.start({ collectSpans: false });
  expect(c.begin('ignored')).toBeUndefined();
  expect(c.stop().summary).toEqual([]);
});

it('rejects invalid transitions and ignores closures from previous runs', () => {
  const c = createCollector(() => 0);
  expect(() => c.stop()).toThrow();
  c.start({});
  const stale = c.begin('stale')!;
  expect(() => c.start({})).toThrow();
  c.cancel();
  c.start({});
  stale();
  expect(c.stop().samples).toEqual([]);
});

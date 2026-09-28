import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages, runBounded } from './bounded.mjs';

test('preserves truncated child records separately', () => {
  assert.deepEqual(parseMessages('{"phase":"first"}\n{"phase":'), {
    messages: [{ phase: 'first' }],
    malformed: ['{"phase":'],
  });
});

test('captures success and nonzero exit without mistaking failure for a timing', async () => {
  const ok = await runBounded(process.execPath, ['-e', 'console.log("ok")']);
  assert.equal(ok.status, 'complete');
  assert.equal(ok.stdout.trim(), 'ok');
  const failed = await runBounded(process.execPath, ['-e', 'process.exit(2)']);
  assert.equal(failed.status, 'error');
  assert.equal(failed.code, 2);
});
test('terminates a hung child and retains its partial output', async () => {
  const result = await runBounded(
    process.execPath,
    ['-e', 'console.log("started");setInterval(()=>{},1000)'],
    { timeoutMs: 1000 },
  );
  assert.equal(result.status, 'timeout');
  assert.match(result.stdout, /started/);
});
test('bounds output and reports unavailable executable', async () => {
  const flood = await runBounded(process.execPath, ['-e', 'console.log("x".repeat(10000))'], {
    maxBytes: 100,
  });
  assert.equal(flood.status, 'output-limit');
  const missing = await runBounded('ezerd-missing-executable-for-test', []);
  assert.equal(missing.status, 'spawn-error');
});

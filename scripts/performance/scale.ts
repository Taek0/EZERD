import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpus, platform } from 'node:os';
import { parseMessages, runBounded } from './bounded.mjs';
import {
  createPerformanceFixture,
  fixtureFingerprint,
} from '../../apps/web/src/shared/performance/fixture.ts';
import { prepareTableRelations } from '../../apps/web/src/features/relations/prepare-table-relations.ts';
import { diagnoseDocument } from '../../packages/model/dist/index.js';

const args = process.argv.slice(2);
if (args[0] === '--child') {
  const count = Number(args[1]);
  const doc = createPerformanceFixture(count, 10);
  if (diagnoseDocument(doc).length) throw new Error('Invalid fixture');
  let checksum = 0;
  const measure = () => {
    const start = performance.now();
    const prepared = prepareTableRelations(doc, 'perf', 'physical');
    const duration = performance.now() - start;
    checksum += prepared.reduce((sum, item) => sum + (item?.geometry.path.length ?? 0), 0);
    return duration;
  };
  const firstMs = measure();
  console.log(
    JSON.stringify({
      phase: 'first',
      count,
      columns: 10,
      firstMs,
      fixtureFingerprint: fixtureFingerprint(doc),
    }),
  );
  if (firstMs > 1000) {
    console.log(
      JSON.stringify({ phase: 'result', status: 'single-sample-budget', firstMs, checksum }),
    );
  } else {
    for (let i = 0; i < 5; i++) measure();
    const rawMs = Array.from({ length: 30 }, measure);
    const sorted = [...rawMs].sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        phase: 'result',
        status: 'complete',
        warmups: 5,
        rawMs,
        medianMs: sorted[14],
        p95Ms: sorted[28],
        checksum,
      }),
    );
  }
} else {
  const counts = args.length ? args.map(Number) : [50, 100, 300];
  if (counts.some((n) => ![10, 50, 100, 300].includes(n)))
    throw new Error('Use counts 10, 50, 100, 300');
  const directory = new URL(`../../artifacts/performance/scale-${Date.now()}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  const metadata = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    node: process.version,
    os: platform(),
    cpu: cpus()[0]?.model,
    mode: 'node-full-relation-preparation',
    timeoutMs: 30000,
    firstSampleBudgetMs: 1000,
  };
  for (const count of counts) {
    const start = performance.now();
    const child = await runBounded(process.execPath, [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      '--child',
      String(count),
    ]);
    const { messages, malformed } = parseMessages(child.stdout);
    const record = {
      schemaVersion: 1,
      metadata,
      count,
      wallMs: performance.now() - start,
      ...child,
      messages,
      malformed,
    };
    await writeFile(new URL(`${count}.json`, directory), JSON.stringify(record, null, 2));
    console.log(
      JSON.stringify(
        {
          output: fileURLToPath(directory),
          count,
          processStatus: child.status,
          first: messages.find((m) => m.phase === 'first'),
          result: messages.find((m) => m.phase === 'result'),
        },
        null,
        2,
      ),
    );
    if (child.status !== 'complete' || malformed.length) break;
  }
}

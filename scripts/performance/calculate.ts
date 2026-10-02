import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { cpus, platform, totalmem } from 'node:os';
import {
  createPerformanceFixture,
  fixtureFingerprint,
} from '../../apps/web/src/shared/performance/fixture.ts';
import { tableCardMetrics } from '../../packages/model/dist/index.js';

const counts = process.argv.slice(2).map(Number);
if (!counts.length) counts.push(10, 50);
const rows = [];
for (const count of counts) {
  const doc = createPerformanceFixture(count, 10);
  let checksum = 0;
  const calculate = () => {
    for (const table of doc.tables!) checksum += tableCardMetrics(doc, table.id).width;
  };
  for (let i = 0; i < 5; i++) calculate();
  const rawMs = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    calculate();
    rawMs.push(performance.now() - start);
  }
  const sorted = [...rawMs].sort((a, b) => a - b);
  rows.push({
    count,
    columns: 10,
    fixtureFingerprint: fixtureFingerprint(doc),
    rawMs,
    medianMs: sorted[14],
    p95Ms: sorted[28],
    checksum,
  });
}
const result = {
  schemaVersion: 1,
  mode: 'node-calculation-only',
  fixtureVersion: 2,
  editorKind: 'legacy-shared',
  documentSchemaVersion: 1,
  target: 'all tableCardMetrics, excludes React/routing/rendering',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  runtime: process.version,
  os: platform(),
  cpu: cpus()[0]?.model,
  ramBytes: totalmem(),
  warmups: 5,
  repeats: 30,
  rows,
};
const directory = new URL('../../artifacts/performance/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL(`calculate-${Date.now()}.json`, directory);
await writeFile(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ output: output.pathname, rows: rows.map(({ rawMs, ...row }) => row) }, null, 2),
);

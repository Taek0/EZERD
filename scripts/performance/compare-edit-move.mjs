import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [baselinePath, candidatePath, countFilter] = process.argv.slice(2);
if (!baselinePath || !candidatePath)
  throw new Error('Usage: node compare-edit-move.mjs BASELINE_DIR CANDIDATE_DIR [COUNT]');
if (countFilter && !['10', '50', '100', '300'].includes(countFilter))
  throw new Error('Invalid count filter');
const baseline = resolve(baselinePath),
  candidate = resolve(candidatePath);
const names = (await readdir(baseline))
  .filter((name) => /^(EDIT|MOVE)-(10|50|100|300)-\d+\.json$/.test(name))
  .filter((name) => !countFilter || name.split('-')[1] === countFilter)
  .sort();
if (!names.length) throw new Error('No baseline repetitions');
const rows = [];
for (const name of names) {
  const a = JSON.parse(await readFile(join(baseline, name), 'utf8'));
  const b = JSON.parse(await readFile(join(candidate, name), 'utf8'));
  for (const r of [a, b])
    if (r.outcome !== 'complete' || r.metadata.dirty || !r.metadata.collectSpans)
      throw new Error(`Invalid sample: ${name}`);
  for (const field of [
    'count',
    'columns',
    'fixtureFingerprint',
    'scenario',
    'locale',
    'mode',
    'build',
    'dpr',
    'cache',
    'userAgent',
  ])
    if (a.metadata[field] !== b.metadata[field]) throw new Error(`Different ${field}: ${name}`);
  if (
    JSON.stringify(a.metadata.viewport) !== JSON.stringify(b.metadata.viewport) ||
    JSON.stringify(a.events) !== JSON.stringify(b.events) ||
    a.before.documentFingerprint !== b.before.documentFingerprint ||
    a.after.documentFingerprint !== b.after.documentFingerprint ||
    JSON.stringify(a.paths) !== JSON.stringify(b.paths)
  )
    throw new Error(`Input/output mismatch: ${name}`);
  const metrics = [
    'table-geometry.js.tableCardMetrics',
    'relation-routing.ts.relationGeometry',
  ].map((metric) => {
    const one = a.summary.find((span) => span.name === metric),
      two = b.summary.find((span) => span.name === metric);
    if (!one || !two) throw new Error(`Missing metric: ${name}`);
    return {
      metric,
      beforeCount: one.count,
      afterCount: two.count,
      beforeTotalMs: one.totalMs,
      afterTotalMs: two.totalMs,
    };
  });
  rows.push({
    file: name,
    baseline: a.metadata.commit,
    candidate: b.metadata.commit,
    exactOutputMatch: true,
    metrics,
  });
}
const report = {
  interpretation: 'inclusive instrumented compute times; not frame or input latency',
  repetitions: rows.length,
  rows,
};
await writeFile(join(candidate, 'comparison.json'), JSON.stringify(report, null, 2));
for (const count of [...new Set(rows.map((row) => Number(row.file.split('-')[1])))]) {
  for (const scenario of ['EDIT', 'MOVE']) {
    const selected = rows.filter((r) => r.file.startsWith(`${scenario}-${count}-`));
    if (!selected.length) continue;
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(
      JSON.stringify({
        scenario,
        count,
        repetitions: selected.length,
        metrics: [0, 1].map((index) => ({
          metric: selected[0]?.metrics[index].metric,
          beforeCount: selected[0]?.metrics[index].beforeCount,
          afterCount: selected[0]?.metrics[index].afterCount,
          beforeMedianMs: median(selected.map((r) => r.metrics[index].beforeTotalMs)),
          afterMedianMs: median(selected.map((r) => r.metrics[index].afterTotalMs)),
        })),
      }),
    );
  }
}
console.log(`Exact input/output comparison passed for ${rows.length} repetitions.`);

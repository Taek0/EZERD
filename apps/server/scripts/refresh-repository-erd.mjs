import { readFileSync, writeFileSync } from 'node:fs';
import { migrateDesignDocumentV1 } from '../../../packages/model/src/database/migration.ts';
import { nativeTableCanvasMetrics } from '../../../apps/web/src/features/projects/native-canvas-style.ts';
import { isDeepStrictEqual } from 'node:util';

const root = 'artifacts/repository-erd/';
const before = JSON.parse(readFileSync(root + '2026-10-07-before.json', 'utf8'));
const legacy = JSON.parse(readFileSync(root + 'current/ezerd-project.json', 'utf8')).document;
const migrated = migrateDesignDocumentV1(legacy, before.sourceDocument.database);
if (migrated.issues.length) throw new Error(JSON.stringify(migrated.issues));
const current = migrated.document;
const commands = [],
  changes = [];
for (const [collection, type] of [
  ['tables', 'add_table'],
  ['columns', 'add_column'],
  ['keys', 'add_key'],
  ['enums', 'add_enum'],
  ['tableRelations', 'add_foreign_key'],
]) {
  for (const value of current[collection] ?? []) {
    const old = (before.sourceDocument[collection] ?? []).find((v) => v.id === value.id);
    if (!old) {
      commands.push({ type, value });
      changes.push({ collection, id: value.id, change: 'added' });
    } else if (collection === 'columns' && !isDeepStrictEqual(old.physical, value.physical)) {
      const physical = Object.fromEntries(
        Object.entries(value.physical).filter(([k, v]) => !isDeepStrictEqual(v, old.physical[k])),
      );
      if (Object.keys(physical).length) {
        commands.push({ type: 'patch_column', id: value.id, patch: { physical } });
        changes.push({ collection, id: value.id, change: 'physical', physical });
      }
    }
  }
}
// Preserve existing names, domain styling and descriptions; record source constraints as metadata.
for (const table of current.tables) {
  const old = before.sourceDocument.tables.find((t) => t.id === table.id);
  if (old && !isDeepStrictEqual(old.customProperties.physical, table.customProperties.physical))
    commands.push({
      type: 'patch_table',
      id: table.id,
      patch: {
        customProperties: { ...old.customProperties, physical: table.customProperties.physical },
      },
    });
}
const nodes = [];
const rows = [
  ['users', 'workspace', 'workspace_audit_events'],
  ['sessions', 'mcp_tokens', 'user_workspaces', 'workspace_invitations', 'projects'],
  [
    'project_personal_states',
    'project_personal_operations',
    'project_database_operations',
    'native_request_cancellations',
    'review_threads',
  ],
  [
    'sync_operations',
    'sync_client_baselines',
    'sync_field_versions',
    'sync_tombstones',
    'review_messages',
    'review_notifications',
  ],
];
const sizes = Object.fromEntries(
  current.tables.map((t) => [t.id, nativeTableCanvasMetrics(current, t, 'physical')]),
);
const cellWidth = Math.ceil(Math.max(...Object.values(sizes).map((s) => s.width))) + 190;
let y = 0;
for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
  const row = rows[rowIndex],
    offset = ((6 - row.length) * cellWidth) / 2;
  for (let index = 0; index < row.length; index++) {
    const id = row[index],
      size = sizes[id];
    nodes.push({
      id: `node:${id}:repository-current`,
      objectId: id,
      viewId: 'repository-current',
      x: Math.round(offset + index * cellWidth),
      y,
      width: Math.ceil(size.width),
      height: Math.ceil(size.height),
    });
  }
  y += Math.ceil(Math.max(...row.map((id) => sizes[id].height))) + 260;
}
// Minimize crossings of hierarchy edges while preserving rows and compact bounds.
const scoreLayout = () => {
  const segments = current.tableRelations.map((e) => {
    const p = nodes.find((n) => n.objectId === e.targetTableId),
      c = nodes.find((n) => n.objectId === e.sourceTableId);
    return {
      e,
      a: { x: p.x + p.width / 2, y: p.y + p.height },
      b: { x: c.x + c.width / 2, y: c.y },
    };
  });
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let score = segments.reduce((sum, s) => sum + Math.abs(s.a.x - s.b.x), 0);
  for (let i = 0; i < segments.length; i++)
    for (const t of segments.slice(i + 1)) {
      const s = segments[i];
      if (
        [s.e.sourceTableId, s.e.targetTableId].some((id) =>
          [t.e.sourceTableId, t.e.targetTableId].includes(id),
        )
      )
        continue;
      if (
        cross(s.a, s.b, t.a) * cross(s.a, s.b, t.b) < 0 &&
        cross(t.a, t.b, s.a) * cross(t.a, t.b, s.b) < 0
      )
        score += 12000;
    }
  return score;
};
let seed = 71393;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
let bestScore = scoreLayout(),
  bestX = nodes.map((n) => n.x),
  score = bestScore;
for (let iteration = 0; iteration < 18000; iteration++) {
  const row = rows[Math.floor(random() * rows.length)],
    aid = row[Math.floor(random() * row.length)],
    bid = row[Math.floor(random() * row.length)],
    a = nodes.find((n) => n.objectId === aid),
    b = nodes.find((n) => n.objectId === bid);
  if (a === b) continue;
  [a.x, b.x] = [b.x, a.x];
  const next = scoreLayout(),
    temperature = 12000 * (1 - (iteration % 3000) / 3000);
  if (next < score || random() < Math.exp((score - next) / Math.max(1, temperature))) score = next;
  else [a.x, b.x] = [b.x, a.x];
  if (score < bestScore) {
    bestScore = score;
    bestX = nodes.map((n) => n.x);
  }
}
nodes.forEach((n, i) => (n.x = bestX[i]));
for (const e of current.tableRelations) {
  const p = nodes.find((n) => n.objectId === e.targetTableId),
    c = nodes.find((n) => n.objectId === e.sourceTableId);
  if (p.y + p.height >= c.y) throw new Error(`Non-hierarchical edge ${e.id}`);
}
for (let i = 0; i < nodes.length; i++)
  for (const b of nodes.slice(i + 1)) {
    const a = nodes[i];
    if (!(
      a.x + a.width + 40 <= b.x ||
      b.x + b.width + 40 <= a.x ||
      a.y + a.height + 40 <= b.y ||
      b.y + b.height + 40 <= a.y
    ))
      throw new Error('Node spacing');
  }
const merged = structuredClone(before.sourceDocument);
for (const collection of ['tables', 'columns', 'keys', 'enums', 'tableRelations'])
  for (const value of current[collection] ?? [])
    if (!merged[collection].some((v) => v.id === value.id)) merged[collection].push(value);
for (const domain of merged.domains) {
  const extra =
    domain.id === 'project'
      ? ' project_database_operations는 프로젝트 DB 변경 요청의 처리 결과와 수행자를 기록한다. projects에는 database_profile_id와 database_revision이 추가되었다.'
      : domain.id === 'sync'
        ? ' native_request_cancellations는 동기화 이력보다 오래 보존하는 요청 취소 기록이다. sync_client_baselines.database_revision은 기준 문서의 DB 리비전을 기록한다.'
        : null;
  if (extra) {
    domain.description = domain.description.replace('네 테이블', '기존 네 테이블') + extra;
    commands.push({
      type: 'patch_domain',
      id: domain.id,
      patch: { description: domain.description },
    });
  }
}
for (const relation of merged.domainRelations) {
  const fks = merged.tableRelations.filter(
    (r) =>
      merged.tables.find((t) => t.id === r.targetTableId).domainId === relation.sourceDomainId &&
      merged.tables.find((t) => t.id === r.sourceTableId).domainId === relation.targetDomainId,
  );
  const newFks = fks.filter(
    (r) => !before.sourceDocument.tableRelations.some((old) => old.id === r.id),
  );
  if (newFks.length) {
    relation.name = relation.name.replace(/\(\d+ FK\)/, `(${fks.length} FK)`);
    relation.description =
      relation.description.replace('네 종류', '관련') +
      '\n추가된 관계:\n' +
      newFks
        .map(
          (r) =>
            `${r.targetTableId} → ${r.sourceTableId}: ${r.physical.name}, ON DELETE ${r.physical.onDelete}, ON UPDATE ${r.physical.onUpdate}.`,
        )
        .join('\n');
    commands.push({
      type: 'patch_domain_relation',
      id: relation.id,
      patch: { name: relation.name, description: relation.description },
    });
  }
}
const output = {
  changes,
  commands,
  document: merged,
  nodes,
  sizes,
  viewId: 'repository-current',
  viewName: '전체 도메인 · 최신 코드 · 계층 배치',
  width: Math.max(...nodes.map((n) => n.x + n.width)),
  height: Math.max(...nodes.map((n) => n.y + n.height)),
};
writeFileSync(root + 'current/refresh-plan.json', JSON.stringify(output, null, 2));
console.log(
  JSON.stringify({
    changes,
    commandCount: commands.length,
    width: output.width,
    height: output.height,
  }),
);

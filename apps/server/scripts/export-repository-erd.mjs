import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { is, SQL } from 'drizzle-orm';
import { PgDialect, PgTable, getTableConfig, isPgEnum } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema.ts';
import { tableCardMetrics } from '../../../packages/model/src/table-geometry.ts';
import { exportPostgres } from '../../../packages/model/src/postgres.ts';

const dialect = new PgDialect();
const props = () => ({ common: {}, logical: {}, physical: {} });
const groups = [
  ['identity', '인증', ['users', 'sessions', 'mcp_tokens']],
  [
    'workspace-domain',
    '공간',
    ['workspace', 'user_workspaces', 'workspace_invitations', 'workspace_audit_events'],
  ],
  ['project', '프로젝트', ['projects', 'project_personal_states', 'project_personal_operations']],
  ['review', '리뷰', ['review_threads', 'review_messages', 'review_notifications']],
  [
    'sync',
    '동기화',
    ['sync_operations', 'sync_field_versions', 'sync_client_baselines', 'sync_tombstones'],
  ],
];
const doc = {
  schemaVersion: 1,
  domains: groups.map(([id, name]) => ({
    id,
    name,
    description: 'apps/server/src/db/schema.ts에서 추출',
  })),
  domainRelations: [],
  tables: [],
  columns: [],
  keys: [],
  tableRelations: [],
  enums: [],
  notes: [],
  views: [{ id: 'all-tables', name: '전체 물리 ERD', domainIds: groups.map(([id]) => id) }],
  layout: { nodes: [], viewports: [], relations: [] },
};
const domainColors = {
  identity: '#2563eb',
  'workspace-domain': '#16a34a',
  project: '#9333ea',
  review: '#ea580c',
  sync: '#0891b2',
};
for (const domain of doc.domains) domain.color = domainColors[domain.id];
const literal = (v) =>
  typeof v === 'string'
    ? `'${v.replaceAll("'", "''")}'`
    : typeof v === 'object'
      ? `'${JSON.stringify(v).replaceAll("'", "''")}'`
      : String(v);
const expression = (v) => (is(v, SQL) ? dialect.sqlToQuery(v).sql : literal(v));
for (const value of Object.values(schema))
  if (isPgEnum(value))
    doc.enums.push({
      id: `enum:${value.enumName}`,
      name: value.enumName,
      schema: 'public',
      values: value.enumValues,
    });
const configs = Object.values(schema)
  .filter((v) => is(v, PgTable))
  .map(getTableConfig);
const cid = (table, column) => `col:${table}:${column}`;
for (const config of configs) {
  const name = config.name;
  const group = groups.find(([, , names]) => names.includes(name));
  if (!group) throw new Error(`Unclassified table ${name}`);
  const custom = props();
  custom.common.source = 'apps/server/src/db/schema.ts';
  custom.physical.indexes = JSON.stringify(
    config.indexes.map(({ config: i }) => ({
      name: i.name,
      unique: i.unique,
      columns: i.columns.map((c) => c.name ?? expression(c)),
      where: i.where ? expression(i.where) : null,
    })),
  );
  custom.physical.checks = JSON.stringify(
    config.checks.map((c) => ({ name: c.name, expression: expression(c.value) })),
  );
  const comment =
    name === 'workspace_audit_events'
      ? '감사 기록 보존을 위해 workspace_id, actor_id, target_user_id에 물리 FK 없음'
      : '';
  doc.tables.push({
    id: name,
    domainId: group[0],
    scope: 'both',
    logical: { name, definition: comment },
    physical: { name, schema: config.schema ?? 'public', comment },
    customProperties: custom,
    canvasDisplay: { showComment: false, showNullable: true },
  });
  for (const c of config.columns) {
    const sqlType = c.getSQLType();
    const type = { name: sqlType.replace(/\(.*\)$/, ''), isArray: false };
    if (c.enum) {
      type.name = c.enum.enumName;
      type.enumId = `enum:${c.enum.enumName}`;
    }
    if (c.length !== undefined) type.length = c.length;
    const description =
      c.dataType === 'json' ? 'JSONB 문서/배열 저장; 내부 객체는 별도 물리 테이블이 아님' : '';
    doc.columns.push({
      id: cid(name, c.name),
      tableId: name,
      scope: 'both',
      logical: { name: c.name, definition: description, semanticType: '', required: c.notNull },
      physical: {
        name: c.name,
        type,
        nullable: !c.notNull,
        defaultExpression: c.default === undefined ? null : expression(c.default),
        comment: description,
      },
      customProperties: props(),
    });
  }
  const addKey = (kind, keyName, columns) =>
    doc.keys.push({
      id: `key:${name}:${keyName}`,
      tableId: name,
      scope: 'both',
      kind,
      name: keyName,
      columnIds: columns.map((c) => cid(name, c.name)),
    });
  const primary = config.columns.filter((c) => c.primary);
  if (primary.length) addKey('primary', `${name}_pkey`, primary);
  for (const key of config.primaryKeys) addKey('primary', key.getName(), key.columns);
  for (const key of config.uniqueConstraints) addKey('unique', key.getName(), key.columns);
  for (const { config: i } of config.indexes)
    if (i.unique && !i.where) addKey('unique', i.name, i.columns);
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    const target = getTableConfig(ref.foreignTable).name;
    doc.tableRelations.push({
      id: `fk:${fk.getName()}`,
      sourceTableId: name,
      targetTableId: target,
      scope: 'both',
      logical: {
        name: fk.getName(),
        cardinality: 'one-to-many',
        required: ref.columns.every((c) => c.notNull),
        sourceCardinality: { min: 0, max: 'many' },
        targetCardinality: { min: ref.columns.every((c) => c.notNull) ? 1 : 0, max: 1 },
      },
      physical: {
        name: fk.getName(),
        sourceColumnIds: ref.columns.map((c) => cid(name, c.name)),
        targetColumnIds: ref.foreignColumns.map((c) => cid(target, c.name)),
        onDelete: (fk.onDelete ?? 'no action').toUpperCase(),
        onUpdate: (fk.onUpdate ?? 'no action').toUpperCase(),
      },
    });
  }
}
// Parent tables sit to the left; each domain forms a horizontal band.
const depth = (name, seen = new Set()) => {
  if (seen.has(name)) throw new Error('Cyclic FK requires explicit layout');
  const parents = doc.tableRelations
    .filter((r) => r.sourceTableId === name)
    .map((r) => r.targetTableId);
  return parents.length
    ? 1 + Math.max(...parents.map((p) => depth(p, new Set([...seen, name]))))
    : 0;
};
const sizes = Object.fromEntries(doc.tables.map((t) => [t.id, tableCardMetrics(doc, t.id)]));
const maxWidth = Math.ceil(Math.max(...Object.values(sizes).map((s) => s.width)));
let bandY = 0;
for (const [index, [group, , names]] of groups.entries()) {
  doc.layout.nodes.push({
    id: `node:domain:${group}`,
    objectId: group,
    viewId: 'overview',
    x: index * 340,
    y: 0,
    width: 280,
    height: 210,
  });
  const offsets = {};
  for (const name of names) {
    const level = depth(name);
    const y = offsets[level] ?? 0;
    const size = sizes[name];
    for (const viewId of [group, 'all-tables'])
      doc.layout.nodes.push({
        id: `node:${viewId}:${name}`,
        objectId: name,
        viewId,
        x: level * (maxWidth + 100),
        y: y + (viewId === 'all-tables' ? bandY : 0),
        width: Math.ceil(size.width),
        height: Math.ceil(size.height),
      });
    offsets[level] = y + Math.ceil(size.height) + 70;
  }
  bandY += Math.max(...Object.values(offsets)) + 80;
}
for (const r of doc.tableRelations) {
  const source = doc.tables.find((t) => t.id === r.sourceTableId);
  const target = doc.tables.find((t) => t.id === r.targetTableId);
  if (
    source.domainId !== target.domainId &&
    !doc.domainRelations.some(
      (d) => d.sourceDomainId === target.domainId && d.targetDomainId === source.domainId,
    )
  )
    doc.domainRelations.push({
      id: `domain-rel:${target.domainId}:${source.domainId}`,
      sourceDomainId: target.domainId,
      targetDomainId: source.domainId,
      name: 'PK → FK',
      direction: 'forward',
      description: '실제 외래키 의존 관계',
    });
}
const relationMeanings = {
  'identity:workspace-domain': [
    '멤버십·초대 사용자 연결',
    '사용자는 공간에 멤버로 참여하고 초대 수신자 또는 초대자로 연결된다. user_workspaces는 공간과 사용자 사이의 N:M 연결 테이블이다. 감사 로그의 actor_id와 target_user_id는 보존 목적상 FK가 없어 이 관계에 포함하지 않는다.',
  ],
  'workspace-domain:project': [
    '공간별 프로젝트 소유',
    '각 프로젝트는 하나의 공간에 소속된다. 공간 하나에 여러 프로젝트가 존재할 수 있으며 프로젝트가 남아 있으면 공간 삭제가 RESTRICT로 차단된다.',
  ],
  'identity:project': [
    '사용자별 개인 화면·작업 기록',
    '프로젝트별 사용자 개인 화면과 개인 작업 중복 처리 방지 기록을 사용자에 연결한다. 사용자 삭제 시 해당 개인 상태와 작업 기록도 삭제된다.',
  ],
  'identity:review': [
    '댓글 작성자·알림 수신자',
    '댓글은 작성 사용자를, 알림은 수신 사용자를 참조한다. 알림은 사용자 삭제 시 함께 삭제되지만 작성 댓글이 남아 있는 사용자의 삭제는 NO ACTION 제약을 받는다. mention_ids는 JSONB 배열이며 별도 FK가 아니다.',
  ],
  'project:review': [
    '프로젝트 리뷰·알림 관리',
    '리뷰 스레드와 알림은 프로젝트에 속한다. 프로젝트 삭제 시 해당 스레드와 알림이 삭제되고 스레드에 연결된 댓글도 연쇄 삭제된다.',
  ],
  'identity:sync': [
    '동기화 수행자·사용자 기준점',
    '공유 동기화 작업에는 수행 사용자를, 클라이언트 기준점에는 사용자를 기록한다. 작업 이력의 actor_id는 NO ACTION이며 사용자별 기준점은 사용자 삭제 시 CASCADE로 삭제된다.',
  ],
  'project:sync': [
    '프로젝트 변경 이력·충돌 관리',
    '프로젝트별 동기화 작업, 필드 버전, 클라이언트 기준점, 삭제 객체 스냅샷을 보관한다. 프로젝트 삭제 시 네 종류의 동기화 데이터가 모두 연쇄 삭제된다. operation_id와 client_id는 이름만으로 별도 FK 관계를 추가하지 않는다.',
  ],
};
for (const relation of doc.domainRelations) {
  const [name, meaning] = relationMeanings[`${relation.sourceDomainId}:${relation.targetDomainId}`];
  const fks = doc.tableRelations.filter(
    (r) =>
      doc.tables.find((t) => t.id === r.targetTableId).domainId === relation.sourceDomainId &&
      doc.tables.find((t) => t.id === r.sourceTableId).domainId === relation.targetDomainId,
  );
  relation.name = `${name} (${fks.length} FK)`;
  relation.description = [
    meaning,
    '방향: 부모 PK → 자식 FK. 각 FK는 부모 1건에 자식 0..N건, 자식은 부모 1건을 필수 참조한다.',
    ...fks.map((r) => {
      const columns = (ids) =>
        ids.map((id) => doc.columns.find((c) => c.id === id).physical.name).join(', ');
      return `${r.targetTableId}(${columns(r.physical.targetColumnIds)}) → ${r.sourceTableId}(${columns(r.physical.sourceColumnIds)}): ON DELETE ${r.physical.onDelete}, ON UPDATE ${r.physical.onUpdate}.`;
    }),
  ].join('\n');
}
for (const viewId of ['overview', ...groups.map(([id]) => id), 'all-tables'])
  doc.layout.viewports.push({ viewId, x: 40, y: 40, zoom: viewId === 'all-tables' ? 0.15 : 0.55 });
for (let i = 0; i < doc.layout.nodes.length; i++)
  for (const b of doc.layout.nodes.slice(i + 1)) {
    const a = doc.layout.nodes[i];
    if (
      a.viewId === b.viewId &&
      !(
        a.x + a.width + 40 <= b.x ||
        b.x + b.width + 40 <= a.x ||
        a.y + a.height + 40 <= b.y ||
        b.y + b.height + 40 <= a.y
      )
    )
      throw new Error(`Overlap: ${a.id} ${b.id}`);
  }
const ddl = exportPostgres(doc);
if (!ddl.canExport || ddl.diagnostics.length) throw new Error(JSON.stringify(ddl.diagnostics));
const output = resolve(process.argv[2] ?? '../../artifacts/repository-erd');
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, 'ezerd-project.json'),
  JSON.stringify(
    {
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: '2026-09-30T00:00:00.000Z',
      project: { name: 'EZERD 코드 ERD · 2026-09-30', databaseKind: 'postgresql' },
      document: doc,
    },
    null,
    2,
  ),
);
writeFileSync(resolve(output, 'schema.sql'), ddl.sql);
console.log(
  JSON.stringify({
    tables: doc.tables.length,
    columns: doc.columns.length,
    keys: doc.keys.length,
    foreignKeys: doc.tableRelations.length,
    enums: doc.enums.length,
    diagnostics: ddl.diagnostics,
    output,
  }),
);

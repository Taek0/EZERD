import { planNativeDeletion } from '../../packages/model/src/database/deletion.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { is, SQL } from '../../apps/server/node_modules/drizzle-orm/index.js';
import { PgDialect, PgTable, getTableConfig, isPgEnum } from '../../apps/server/node_modules/drizzle-orm/pg-core/index.js';
import * as schema from '../../apps/server/src/db/schema.ts';
import { migrateDesignDocumentV1 } from '../../packages/model/src/database/migration.ts';
import { validateDatabaseDocument } from '../../packages/model/src/database/validation.ts';
import { nativeEditorCommandSchema } from '../../packages/contracts/src/native-editor-command.ts';
import { nativeTableCanvasMetrics } from '../../apps/web/src/features/projects/native-canvas-style.ts';

// Offline comparison only: the caller applies the reviewed commands through MCP.
const directory = process.argv[2];
if (!directory)
  throw new Error('Usage: compare-repository-erd.mjs <snapshot-directory> [snapshot-file]');
const state = JSON.parse(readFileSync(`${directory}/${process.argv[3] ?? 'before.json'}`, 'utf8'));
const before = state.sourceDocument;
let doc = structuredClone(before);
const commands = [];
const changes = [];
const limitations = [];
const props = () => ({ common: {}, logical: {}, physical: {} });
const same = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  return v && typeof v === 'object'
    ? Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort(v[k])]),
      )
    : v;
}
const dialect = new PgDialect();
const literal = (v) =>
  typeof v === 'string'
    ? `'${v.replaceAll("'", "''")}'`
    : typeof v === 'object'
      ? `'${JSON.stringify(v).replaceAll("'", "''")}'`
      : String(v);
const expression = (v) => (is(v, SQL) ? dialect.sqlToQuery(v).sql : literal(v));
const configs = Object.values(schema)
  .filter((v) => is(v, PgTable))
  .map(getTableConfig);
const retired = doc.tables.filter(t => !configs.some(c => c.name === t.physical.name));
if (retired.length) {
 const targets = retired.map(t => ({ collection: 'tables', id: t.id }));
 const plan = planNativeDeletion(doc, targets);
 if(plan.blockers.length) throw Error(JSON.stringify(plan.blockers));
 commands.push({type:'delete_objects',targets});
 changes.push(...retired.map(t=>'delete_table: '+t.physical.name));
 doc=plan.document;
}
const tid = (name) => doc.tables.find((t) => t.physical.name === name)?.id ?? name;
const cid = (name, column) =>
  doc.columns.find((c) => c.tableId === tid(name) && c.physical.name === column)?.id ??
  `${name}.${column}`;
function add(collection, type, value) {
  (doc[collection] ??= []).push(value);
  commands.push({ type, value });
  changes.push(`${type}: ${value.name ?? value.physical?.name ?? value.id}`);
}
function patch(collection, type, item, value) {
  if (!Object.entries(value).some(([k, v]) => !same(item[k], v))) return;
  commands.push({ type, id: item.id, patch: value });
  Object.assign(item, value);
  changes.push(`${type}: ${item.name ?? item.physical?.name ?? item.id}`);
}
for (const e of Object.values(schema).filter(isPgEnum)) {
  const old = doc.enums.find((x) => x.name === e.enumName);
  if (!old)
    add('enums', 'add_enum', {
      id: `enum-${e.enumName}`,
      name: e.enumName,
      schema: 'public',
      values: e.enumValues,
    });
  else patch('enums', 'patch_enum', old, { values: e.enumValues });
}
for (const config of configs) {
  const name = config.name;
  let table = doc.tables.find((t) => t.physical.name === name);
  if (!table) {
    table = {
      id: name,
      domainId: name === 'project_database_operations' ? 'project' : 'sync',
      scope: 'both',
      logical: { name, definition: '현재 레포 스키마에서 추출' },
      physical: {
        name,
        namespace: { kind: 'postgresSchema', name: 'public' },
        comment: '',
        options: { database: 'postgresql' },
      },
      canvasDisplay: { showComment: false, showNullable: true },
      customProperties: props(),
    };
    add('tables', 'add_table', table);
  }
  for (const c of config.columns) {
    const old = doc.columns.find((x) => x.id === cid(name, c.name));
    const type = { name: c.getSQLType().replace(/\(.*\)$/, ''), isArray: false };
    if (c.length !== undefined) type.length = c.length;
    if (c.enum) type.enumId = doc.enums.find((e) => e.name === c.enum.enumName).id;
    const v1 = {
      schemaVersion: 1,
      domains: [],
      domainRelations: [],
      notes: [],
      layout: { nodes: [], viewports: [] },
      columns: [
        {
          id: cid(name, c.name),
          tableId: table.id,
          scope: old?.scope ?? table.scope,
          logical: old?.logical ?? {
            name: c.name,
            definition: '',
            semanticType: '',
            required: c.notNull,
          },
          physical: {
            name: c.name,
            type,
            nullable: !c.notNull,
            defaultExpression: c.default === undefined ? null : expression(c.default),
            comment: old?.physical.comment ?? '',
          },
          customProperties: old?.customProperties ?? props(),
        },
      ],
    };
    const migrated = migrateDesignDocumentV1(v1, doc.database);
    if (migrated.issues.length) throw new Error(JSON.stringify(migrated.issues));
    const column = migrated.document.columns[0];
    if (!old) add('columns', 'add_column', column);
    else
      patch('columns', 'patch_column', old, {
        physical: column.physical,
        logical: { ...old.logical, required: c.notNull },
      });
  }
  const desiredOrder = config.columns.map((c) => cid(name, c.name));
  if (
    !same(
      doc.columns.filter((c) => c.tableId === table.id).map((c) => c.id),
      desiredOrder,
    )
  ) {
    commands.push({ type: 'reorder_columns', tableId: table.id, columnIds: desiredOrder });
    const cols = desiredOrder.map((id) => doc.columns.find((c) => c.id === id));
    doc.columns = [...doc.columns.filter((c) => c.tableId !== table.id), ...cols];
  }
  const keys = [];
  const primary = config.columns.filter((c) => c.primary);
  if (primary.length) keys.push({ kind: 'primary', name: `${name}_pkey`, columns: primary });
  for (const k of config.primaryKeys)
    keys.push({ kind: 'primary', name: k.getName(), columns: k.columns });
  for (const k of config.uniqueConstraints)
    keys.push({ kind: 'unique', name: k.getName(), columns: k.columns });
  for (const k of keys) {
    const value = {
      id: `key-${k.name}`,
      tableId: table.id,
      scope: 'both',
      kind: k.kind,
      name: k.name,
      columnIds: k.columns.map((c) => cid(name, c.name)),
    };
    const old = doc.keys.find(
      (x) => x.tableId === table.id && x.kind === k.kind && same(x.columnIds, value.columnIds),
    );
    if (!old) add('keys', 'add_key', value);
    else patch('keys', 'patch_key', old, { name: value.name });
  }
  for (const { config: i } of config.indexes) {
    const value = {
      id: `index-${i.name}`,
      tableId: table.id,
      scope: 'physical',
      name: i.name,
      unique: i.unique,
      parts: i.columns.map((c) => ({
        expression: { kind: 'column', columnId: cid(name, c.name) },
        direction: c.indexConfig?.order ?? 'asc',
      })),
      options: { database: 'postgresql', method: i.method ?? 'btree' },
    };
    if (i.where) {
      if (name !== 'workspace_invitations') throw new Error('Unknown partial index');
      limitations.push({
        table: name,
        name: i.name,
        sql: expression(i.where),
        reason:
          'Native enum/string predicate comparison unsupported; exact partial index retained in table metadata.',
      });
      continue;
    }
    const old = doc.indexes?.find((x) => x.name === value.name);
    if (!old) add('indexes', 'add_index', value);
    else {
      const { id: _, tableId: __, ...p } = value;
      patch('indexes', 'patch_index', old, p);
    }
    const duplicate = doc.keys.find(
      (k) => k.tableId === table.id && k.kind === 'unique' && k.name === i.name,
    );
    if (duplicate) {
      commands.push({
        type: 'delete_objects',
        targets: [{ collection: 'keys', id: duplicate.id }],
      });
      doc.keys = doc.keys.filter((k) => k.id !== duplicate.id);
      changes.push(`unique key → unique index: ${i.name}`);
    }
  }
  const custom = structuredClone(table.customProperties);
  custom.common.source = 'apps/server/src/db/schema.ts';
  custom.physical.indexes = JSON.stringify(
    config.indexes.map(({ config: i }) => ({
      name: i.name,
      unique: i.unique,
      columns: i.columns.map((c) => c.name),
      where: i.where ? expression(i.where) : null,
    })),
  );
  custom.physical.checkConstraints = JSON.stringify(
    config.checks.map((c) => ({ name: c.name, expression: expression(c.value) })),
  );
  patch('tables', 'patch_table', table, { customProperties: custom });
}
const col = (t, c) => ({ kind: 'column', columnId: cid(t, c) });
const str = (value) => ({ kind: 'literal', literalType: 'string', value });
const binary = (operator, left, right) => ({ kind: 'binary', operator, left, right });
for (const config of configs) {
  for (const check of config.checks) {
    let expr;
    if (check.name === 'projects_database_revision_nonnegative')
      expr = binary('>=', col('projects', 'database_revision'), {
        kind: 'literal',
        literalType: 'number',
        value: '0',
      });
    else if (check.name === 'user_workspaces_sort_order_nonnegative') {
 const column=col('user_workspaces','sort_order');
 expr=binary('OR',{kind:'isNull',operand:column,negate:false},binary('>=',column,{kind:'literal',literalType:'number',value:'0'}));
}else if (check.name === 'projects_database_profile_matches') {
      limitations.push({
        table: config.name,
        name: check.name,
        sql: expression(check.value),
        reason:
          'Native enum/string comparison unsupported; exact CHECK retained in table metadata.',
      });
      continue;
    } else {
      limitations.push({
        table: config.name,
        name: check.name,
        sql: expression(check.value),
        reason: 'Native expression catalog has no btrim; exact SQL retained in table metadata.',
      });
      continue;
    }
    const old = doc.checks?.find((c) => c.name === check.name);
    if (!old)
      add('checks', 'add_check', {
        id: `check-${check.name}`,
        tableId: tid(config.name),
        name: check.name,
        scope: 'physical',
        expression: expr,
      });
    else patch('checks', 'patch_check', old, { expression: expr });
  }
  for (const fk of config.foreignKeys) {
    const ref = fk.reference(),
      target = getTableConfig(ref.foreignTable).name;
    const physical = {
      name: fk.getName(),
      sourceColumnIds: ref.columns.map((c) => cid(config.name, c.name)),
      targetColumnIds: ref.foreignColumns.map((c) => cid(target, c.name)),
      onDelete: (fk.onDelete ?? 'no action').toUpperCase(),
      onUpdate: (fk.onUpdate ?? 'no action').toUpperCase(),
    };
    const old = doc.tableRelations.find(
      (r) =>
        r.sourceTableId === tid(config.name) &&
        r.targetTableId === tid(target) &&
        same(r.physical?.sourceColumnIds, physical.sourceColumnIds),
    );
    if (old) patch('tableRelations', 'patch_foreign_key', old, { physical });
    else
      add('tableRelations', 'add_foreign_key', {
        id: `fk-${fk.getName()}`,
        sourceTableId: tid(config.name),
        targetTableId: tid(target),
        scope: 'physical',
        logical: {
          name: fk.getName(),
          cardinality: 'one-to-many',
          required: true,
          sourceCardinality: { min: 0, max: 'many' },
          targetCardinality: { min: 1, max: 1 },
        },
        physical,
      });
  }
}
const issues=validateDatabaseDocument(doc,doc.database,{mode:'write',previous:before});
commands.forEach(c=>nativeEditorCommandSchema.parse(c));
const report={tables:doc.tables.length,columns:doc.columns.length,foreignKeys:doc.tableRelations.length,keys:doc.keys.length,indexes:doc.indexes.length,checks:doc.checks.length,commands:commands.length,changes,limitations,issues};
writeFileSync(`${directory}/commands.json`,JSON.stringify(commands,null,2));
writeFileSync(`${directory}/expected.json`,JSON.stringify(doc,null,2));
writeFileSync(`${directory}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(issues.length)process.exitCode=1;


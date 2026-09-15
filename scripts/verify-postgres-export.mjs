import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createEmptyDocument, exportPostgres } from '../packages/model/dist/index.js';
import { readConfig } from '../apps/server/dist/config.js';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const pg = require('pg');
const config = readConfig();
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.DATABASE_URL).hostname),
  'Use a local verification database',
);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const client = await pool.connect();
const schema = 'ezerd_ddl_' + randomUUID().replaceAll('-', '');
const metadata = () => ({ common: {}, logical: {}, physical: {} });
const table = (id, name = id) => ({
  id,
  domainId: 'd',
  scope: 'both',
  logical: { name: id, definition: '' },
  physical: { name, schema, comment: "owner's table\\comment" },
  customProperties: metadata(),
});
const column = (id, tableId, name, type, extra = {}) => ({
  id,
  tableId,
  scope: 'both',
  logical: { name, definition: '', semanticType: '', required: false },
  physical: {
    name,
    type: { name: type, isArray: false },
    nullable: false,
    defaultExpression: null,
    comment: '금액 설명',
    ...extra,
  },
  customProperties: metadata(),
});
const fk = (id, source, target, sc, tc) => ({
  id,
  sourceTableId: source,
  targetTableId: target,
  scope: 'both',
  logical: { name: id, cardinality: 'one-to-one', required: true },
  physical: {
    name: id,
    sourceColumnIds: sc,
    targetColumnIds: tc,
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
});
const document = {
  ...createEmptyDocument(),
  domains: [{ id: 'd', name: '검증', description: '' }],
  tables: [table('orders', '주문"order'), table('payments'), table('types')],
  columns: [
    column('a', 'orders', 'id', 'integer'),
    column('a2', 'orders', 'tenant', 'uuid'),
    column('b', 'payments', 'id', 'integer'),
    column('b2', 'payments', 'tenant', 'uuid'),
    column('t1', 'types', 'id', 'serial'),
    column('t2', 'types', 'amount', 'numeric', {
      type: { name: 'numeric', precision: 12, scale: 2, isArray: false },
      defaultExpression: '0',
    }),
    column('t3', 'types', 'tags', 'text', {
      type: { name: 'text', isArray: true },
      nullable: true,
    }),
    column('t4', 'types', 'uid', 'uuid', { defaultExpression: 'gen_random_uuid()' }),
    column('t5', 'types', 'created', 'timestamptz', { defaultExpression: 'now()' }),
    column('t6', 'types', 'active', 'boolean', { defaultExpression: 'true' }),
    column('t7', 'types', 'payload', 'jsonb', { defaultExpression: `'{"valid":true}'` }),
    column('t8', 'types', 'title', 'varchar', {
      type: { name: 'varchar', length: 30, isArray: false },
      defaultExpression: `'owner''s title'`,
    }),
    column('t9', 'types', 'day', 'date', { defaultExpression: 'CURRENT_DATE' }),
    column('t10', 'types', 'time', 'time', {
      type: { name: 'time', precision: 3, isArray: false },
      nullable: true,
    }),
  ],
  keys: [
    {
      id: 'ka',
      tableId: 'orders',
      scope: 'both',
      kind: 'primary',
      name: 'orders_pk',
      columnIds: ['a', 'a2'],
    },
    {
      id: 'kb',
      tableId: 'payments',
      scope: 'both',
      kind: 'unique',
      name: 'payments_key',
      columnIds: ['b', 'b2'],
    },
  ],
  tableRelations: [
    fk('to_orders', 'payments', 'orders', ['b', 'b2'], ['a', 'a2']),
    fk('to_payments', 'orders', 'payments', ['a', 'a2'], ['b', 'b2']),
  ],
};
document.enums = [
  { id: 'state', schema, name: 'state"kind', values: ['ready', "owner's", 'back\\slash', ''] },
];
document.columns.push(
  column('enum_default', 'types', 'state', 'stale', {
    type: { name: 'stale', enumId: 'state', isArray: false },
    defaultExpression: "'owner''s'",
  }),
  column('enum_backslash', 'types', 'backslash_state', 'stale', {
    type: { name: 'stale', enumId: 'state', isArray: false },
    defaultExpression: "'back\\slash'",
  }),
  column('enum_array', 'types', 'states', 'stale', {
    type: { name: 'stale', enumId: 'state', isArray: true },
    nullable: true,
  }),
  column('enum_source', 'payments', 'state', 'stale', {
    type: { name: 'stale', enumId: 'state', isArray: false },
    nullable: true,
  }),
  column('enum_target', 'orders', 'state', 'other hint', {
    type: { name: 'other hint', enumId: 'state', isArray: false },
    nullable: true,
  }),
);
document.keys.push({
  id: 'enum_unique',
  tableId: 'orders',
  scope: 'both',
  kind: 'unique',
  name: 'enum_unique',
  columnIds: ['enum_target'],
});
document.tableRelations.push(fk('enum_fk', 'payments', 'orders', ['enum_source'], ['enum_target']));
try {
  const generated = exportPostgres(document);
  assert.deepEqual(generated.diagnostics, []);
  await client.query('BEGIN');
  await client.query(generated.sql);
  const constraints = await client.query(
    'SELECT contype FROM pg_constraint c JOIN pg_namespace n ON c.connamespace=n.oid WHERE n.nspname=$1',
    [schema],
  );
  assert.equal(constraints.rows.filter((row) => row.contype === 'f').length, 3);
  await client.query(`INSERT INTO "${schema}"."types" DEFAULT VALUES`);
  const rows = await client.query(
    `SELECT amount, active, title, payload, state, backslash_state FROM "${schema}"."types"`,
  );
  assert.equal(rows.rows[0].title, "owner's title");
  assert.deepEqual(rows.rows[0].payload, { valid: true });
  assert.equal(rows.rows[0].state, "owner's");
  assert.equal(rows.rows[0].backslash_state, 'back\\slash');
  await client.query(
    `UPDATE "${schema}"."types" SET states=ARRAY['ready', 'back\\slash']::"${schema}"."state""kind"[]`,
  );
  const labels = await client.query(
    'SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid JOIN pg_namespace n ON t.typnamespace=n.oid WHERE n.nspname=$1 ORDER BY enumsortorder',
    [schema],
  );
  assert.deepEqual(
    labels.rows.map((row) => row.enumlabel),
    document.enums[0].values,
  );
  await client.query('SAVEPOINT enum_invalid');
  await assert.rejects(
    client.query(`UPDATE "${schema}"."types" SET state='undeclared'`),
    (error) => error.code === '22P02',
  );
  await client.query('ROLLBACK TO SAVEPOINT enum_invalid');
  await client.query('ROLLBACK');
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]);
  assert.equal(remaining.rowCount, 0);
  console.log(
    'PASS: generated PostgreSQL DDL executes, cyclic/composite/ENUM FK, enum arrays, ordered labels and defaults work; verification schema rolled back.',
  );
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

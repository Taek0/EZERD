import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import pg from 'pg';
import {
  compileNativeDatabaseDDL,
  createNativeColumn,
  databaseTypeCatalog,
  type NativeColumnType,
} from '@ezerd/model';
import { nativeDDLFixture } from '../../../packages/model/src/database/ddl-fixtures.js';
import { readConfig } from '../src/config.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')('native PostgreSQL 18 DDL execution', () => {
  it('executes every catalog declaration and default/FK/check/generation combination in a rolled-back schema', async () => {
    const configured = new URL(readConfig().DATABASE_URL);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname))
      throw Error('Local DB QA only');
    const client = new pg.Client({ connectionString: configured.toString() });
    await client.connect();
    const schema = 'ezerd_ddl_' + randomUUID().replaceAll('-', '');
    try {
      await client.query('BEGIN');
      const doc = nativeDDLFixture('postgresql');
      for (const table of doc.tables!)
        table.physical.namespace = { kind: 'postgresSchema', name: schema };
      const compiled = compileNativeDatabaseDDL(doc);
      expect(compiled.canExport, JSON.stringify(compiled.issues)).toBe(true);
      await client.query(compiled.sql);
      await client.query(`INSERT INTO "${schema}".parent DEFAULT VALUES`);
      expect((await client.query(`SELECT id,label FROM "${schema}".parent`)).rows).toEqual([
        { id: 1, label: "quote' and slash\\ 한글" },
      ]);
      await client.query(`INSERT INTO "${schema}".child(parent_id) VALUES(1)`);
      await client.query('SAVEPOINT invalid_fk');
      await expect(
        client.query(`INSERT INTO "${schema}".child(parent_id) VALUES(99)`),
      ).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_fk');
      await expect(
        client.query(`INSERT INTO "${schema}".child(parent_id,score) VALUES(1,0)`),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_fk');
      await client.query(`DELETE FROM "${schema}".parent WHERE id=1`);
      expect((await client.query(`SELECT COUNT(*) FROM "${schema}".child`)).rows[0].count).toBe(
        '0',
      );
      const definitions = databaseTypeCatalog.filter((type) => type.databaseKind === 'postgresql');
      for (const [i, definition] of definitions.entries()) {
        const typed = nativeDDLFixture('postgresql');
        typed.tables = [typed.tables![0]!];
        typed.keys = [];
        typed.tableRelations = [];
        typed.indexes = [];
        typed.checks = [];
        const table = typed.tables[0]!;
        table.physical.name = 'type_' + i;
        table.physical.namespace = { kind: 'postgresSchema', name: schema };
        const column = createNativeColumn(typed.database, table, 'value');
        column.physical.name = 'value';
        column.physical.type = {
          kind: 'builtin',
          database: 'postgresql',
          typeId: definition.id,
          parameters: {},
        } as NativeColumnType;
        typed.columns = [column];
        const result = compileNativeDatabaseDDL(typed);
        expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
        await client.query(result.sql);
        const actual = await client.query(
          'SELECT format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND a.attname=$3',
          [schema, table.physical.name, 'value'],
        );
        expect(actual.rows, definition.id).toHaveLength(1);
      }
      expect(definitions).toHaveLength(65);
      const advanced = nativeDDLFixture('postgresql');
      const parent = advanced.tables![0]!;
      advanced.tables = [parent];
      parent.physical.name = 'advanced';
      parent.physical.namespace = { kind: 'postgresSchema', name: schema };
      advanced.columns = advanced.columns!.filter((column) => column.tableId === parent.id);
      advanced.keys = [];
      advanced.tableRelations = [];
      advanced.checks = [];
      advanced.indexes = [];
      const enumeration = createNativeColumn(advanced.database, parent, 'status');
      enumeration.physical.name = 'status';
      enumeration.physical.type = { kind: 'projectEnum', database: 'postgresql', enumId: 'enum' };
      enumeration.physical.defaultValue = {
        kind: 'literal',
        literalType: 'string',
        value: "quote'",
      };
      advanced.enums = [{ id: 'enum', name: 'Status', schema, values: ["quote'", '한글'] }];
      const computed = createNativeColumn(advanced.database, parent, 'generated');
      computed.physical.name = 'lower_label';
      computed.physical.generation = {
        kind: 'computed',
        database: 'postgresql',
        storage: 'virtual',
        expression: {
          kind: 'call',
          functionId: 'postgresql:lower',
          args: [{ kind: 'column', columnId: 'label' }],
        },
      };
      advanced.columns.push(enumeration, computed);
      advanced.indexes = [
        {
          id: 'advanced-index',
          tableId: parent.id,
          name: 'advanced_lower_ix',
          unique: true,
          scope: 'both',
          parts: [
            {
              expression: {
                kind: 'call',
                functionId: 'postgresql:lower',
                args: [{ kind: 'column', columnId: 'label' }],
              },
              direction: 'desc',
            },
          ],
          options: {
            database: 'postgresql',
            method: 'btree',
            includeColumnIds: ['status'],
            nullsNotDistinct: true,
            predicate: {
              kind: 'isNull',
              operand: { kind: 'column', columnId: 'label' },
              negate: true,
            },
          },
        },
      ];
      const result = compileNativeDatabaseDDL(advanced);
      expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
      await client.query(result.sql);
      await client.query(`INSERT INTO "${schema}".advanced(label) VALUES('HELLO')`);
      expect(
        (await client.query(`SELECT status,lower_label FROM "${schema}".advanced`)).rows,
      ).toEqual([{ status: "quote'", lower_label: 'hello' }]);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

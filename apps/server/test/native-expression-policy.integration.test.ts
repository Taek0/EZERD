import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  compileNativeDatabaseDDL,
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  nativeExpressionDecision,
  type NativeExpression,
} from '@ezerd/model';
import { readConfig } from '../src/config.js';
describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'native PostgreSQL expression semantics execution',
  () => {
    it('executes typed generated/default/check/partial index expressions and blocks invalid result types', async () => {
      const config = new URL(readConfig().DATABASE_URL);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(config.hostname))
        throw Error('Local DB QA only');
      const client = new pg.Client({ connectionString: config.toString() });
      await client.connect();
      const schema = 'ezerd_expression_' + randomUUID().replaceAll('-', '');
      try {
        await client.query('BEGIN');
        const context = defaultDatabaseContext('postgresql'),
          doc = createEmptyNativeDocument(context),
          table = createNativeTable(context, 't');
        table.physical.name = 'expressions';
        table.physical.namespace = { kind: 'postgresSchema', name: schema };
        doc.tables = [table];
        const number = createNativeColumn(context, table, 'number');
        number.physical.name = 'number';
        number.physical.type = {
          kind: 'builtin',
          database: 'postgresql',
          typeId: 'postgresql:integer',
          parameters: {},
        };
        number.physical.nullable = false;
        number.physical.defaultValue = {
          kind: 'expression',
          expression: {
            kind: 'call',
            functionId: 'postgresql:abs',
            args: [{ kind: 'literal', literalType: 'number', value: '-3' }],
          },
        };
        const text = createNativeColumn(context, table, 'text');
        text.physical.name = 'text';
        text.physical.type = {
          kind: 'builtin',
          database: 'postgresql',
          typeId: 'postgresql:text',
          parameters: {},
        };
        text.physical.defaultValue = { kind: 'literal', literalType: 'string', value: 'HELLO' };
        const generated = createNativeColumn(context, table, 'generated');
        generated.physical.name = 'generated';
        generated.physical.type = number.physical.type;
        generated.physical.generation = {
          kind: 'computed',
          database: 'postgresql',
          storage: 'stored',
          expression: {
            kind: 'binary',
            operator: '+',
            left: { kind: 'column', columnId: 'number' },
            right: { kind: 'literal', literalType: 'number', value: '2' },
          },
        };
        doc.columns = [number, text, generated];
        const condition: NativeExpression = {
          kind: 'binary',
          operator: '>',
          left: { kind: 'column', columnId: 'number' },
          right: { kind: 'literal', literalType: 'number', value: '0' },
        };
        doc.checks = [
          { id: 'check', tableId: 't', name: 'positive', scope: 'both', expression: condition },
        ];
        doc.indexes = [
          {
            id: 'index',
            tableId: 't',
            name: 'lower_text',
            unique: false,
            scope: 'both',
            parts: [
              {
                expression: {
                  kind: 'call',
                  functionId: 'postgresql:lower',
                  args: [{ kind: 'column', columnId: 'text' }],
                },
                direction: 'asc',
              },
            ],
            options: { database: 'postgresql', method: 'btree', predicate: condition },
          },
        ];
        const compiled = compileNativeDatabaseDDL(doc);
        expect(compiled.canExport, JSON.stringify(compiled.issues)).toBe(true);
        await client.query(compiled.sql);
        expect(
          (
            await client.query(
              `INSERT INTO "${schema}".expressions DEFAULT VALUES RETURNING number,generated`,
            )
          ).rows,
        ).toEqual([{ number: 3, generated: 5 }]);
        await client.query('SAVEPOINT checks');
        await expect(
          client.query(`INSERT INTO "${schema}".expressions(number) VALUES(-1)`),
        ).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT checks');
        for (const [expression, sql, purpose] of [
          [
            { kind: 'column', columnId: 'number' },
            `ALTER TABLE "${schema}".expressions ADD CHECK(number)`,
            'check',
          ],
          [
            {
              kind: 'call',
              functionId: 'postgresql:lower',
              args: [{ kind: 'column', columnId: 'number' }],
            },
            `CREATE INDEX bad_lower ON "${schema}".expressions (LOWER(number))`,
            'index',
          ],
        ] as Array<[NativeExpression, string, 'check' | 'index']>) {
          expect(
            nativeExpressionDecision(context, expression, {
              columns: doc.columns,
              tableId: 't',
              purpose,
            }).allowed,
          ).toBe(false);
          await expect(client.query(sql)).rejects.toBeDefined();
          await client.query('ROLLBACK TO SAVEPOINT checks');
        }
        doc.checks[0]!.expression = { kind: 'column', columnId: 'number' };
        expect(compileNativeDatabaseDDL(doc).sql).toBe('');
        doc.checks[0]!.expression = condition;
        generated.physical.generation.expression = {
          kind: 'call',
          functionId: 'postgresql:lower',
          args: [{ kind: 'column', columnId: 'text' }],
        };
        expect(compileNativeDatabaseDDL(doc).issues).toContainEqual(
          expect.objectContaining({ code: 'expression.target-type-mismatch' }),
        );
        await client.query(`CREATE TYPE "${schema}".enum_value AS ENUM ('a','b')`);
        await client.query(
          `CREATE TABLE "${schema}".stored_enum (value "${schema}".enum_value, missing boolean GENERATED ALWAYS AS (value IS NULL) STORED)`,
        );
        expect(
          (
            await client.query(
              `INSERT INTO "${schema}".stored_enum(value) VALUES('a') RETURNING missing`,
            )
          ).rows,
        ).toEqual([{ missing: false }]);
        await client.query('SAVEPOINT virtual_type');
        await expect(
          client.query(
            `CREATE TABLE "${schema}".virtual_enum (value "${schema}".enum_value, missing boolean GENERATED ALWAYS AS (value IS NULL) VIRTUAL)`,
          ),
        ).rejects.toBeDefined();
        await client.query('ROLLBACK TO SAVEPOINT virtual_type');
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    });
  },
);

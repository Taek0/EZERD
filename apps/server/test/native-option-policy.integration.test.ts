import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  compileNativeDatabaseDDL,
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  nativeGenerationDecision,
  type NativeColumnType,
  type NativeGeneration,
} from '@ezerd/model';
import { readConfig } from '../src/config.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'native PostgreSQL column option execution',
  () => {
    it('runs bounded ascending/descending identity sequences and UUID/current-time defaults', async () => {
      const configured = new URL(readConfig().DATABASE_URL);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname))
        throw Error('Local QA only');
      const client = new pg.Client({ connectionString: configured.toString() });
      await client.connect();
      const schema = 'ezerd_options_' + randomUUID().replaceAll('-', '');
      try {
        await client.query('BEGIN');
        const database = defaultDatabaseContext('postgresql');
        for (const [index, test] of [
          {
            type: 'smallint',
            sequence: { start: '3', min: '1', max: '3', increment: '-1', cycle: true },
            values: ['3', '2', '1', '3'],
          },
          {
            type: 'integer',
            sequence: {
              start: '2147483646',
              min: '2147483646',
              max: '2147483647',
              increment: '+1',
              cycle: true,
            },
            values: ['2147483646', '2147483647', '2147483646', '2147483647'],
          },
          {
            type: 'bigint',
            sequence: {
              start: '9007199254740993',
              min: '9007199254740993',
              max: '9007199254740994',
              increment: '1',
              cycle: true,
            },
            values: [
              '9007199254740993',
              '9007199254740994',
              '9007199254740993',
              '9007199254740994',
            ],
          },
        ].entries()) {
          const document = createEmptyNativeDocument(database),
            table = createNativeTable(database, 't');
          table.physical.name = 'sequence_' + index;
          table.physical.namespace = { kind: 'postgresSchema', name: schema };
          const column = createNativeColumn(database, table, 'c');
          column.physical.name = 'id';
          column.physical.nullable = false;
          column.physical.type = {
            kind: 'builtin',
            database: 'postgresql',
            typeId: `postgresql:${test.type}`,
            parameters: {},
          } as NativeColumnType;
          column.physical.generation = {
            kind: 'identity',
            database: 'postgresql',
            mode: 'always',
            sequence: test.sequence,
          } as NativeGeneration;
          expect(
            nativeGenerationDecision(database, column.physical.type, column.physical.generation)
              .allowed,
          ).toBe(true);
          document.tables = [table];
          document.columns = [column];
          const ddl = compileNativeDatabaseDDL(document);
          expect(ddl.canExport, JSON.stringify(ddl.issues)).toBe(true);
          await client.query(ddl.sql);
          for (const value of test.values)
            expect(
              String(
                (
                  await client.query(
                    `INSERT INTO "${schema}"."${table.physical.name}" DEFAULT VALUES RETURNING id`,
                  )
                ).rows[0].id,
              ),
            ).toBe(value);
          await client.query('SAVEPOINT explicit_identity');
          await expect(
            client.query(`INSERT INTO "${schema}"."${table.physical.name}" VALUES (1)`),
          ).rejects.toMatchObject({ code: '428C9' });
          await client.query('ROLLBACK TO SAVEPOINT explicit_identity');
        }
        const doc = createEmptyNativeDocument(database),
          table = createNativeTable(database, 'default-t');
        table.physical.name = 'defaults';
        table.physical.namespace = { kind: 'postgresSchema', name: schema };
        doc.tables = [table];
        doc.columns = [
          ['uuid', 'gen_random_uuid'],
          ['timestamptz', 'current_timestamp'],
          ['date', 'current_date'],
          ['timetz', 'current_time'],
        ].map(([name, functionName]) => {
          const column = createNativeColumn(database, table, name!);
          column.physical.name = name!;
          column.physical.type = {
            kind: 'builtin',
            database: 'postgresql',
            typeId: `postgresql:${name}`,
            parameters: {},
          } as NativeColumnType;
          column.physical.defaultValue = {
            kind: 'expression',
            expression: {
              kind: 'call',
              functionId: `postgresql:${functionName}` as 'postgresql:gen_random_uuid',
              args: [],
            },
          };
          return column;
        });
        const ddl = compileNativeDatabaseDDL(doc);
        expect(ddl.canExport, JSON.stringify(ddl.issues)).toBe(true);
        await client.query(ddl.sql);
        const values = (
          await client.query(`INSERT INTO "${schema}".defaults DEFAULT VALUES RETURNING *`)
        ).rows[0];
        expect(values.uuid).toMatch(/^[0-9a-f-]{36}$/);
        expect(values.timestamptz).toBeInstanceOf(Date);
        expect(values.date).toBeInstanceOf(Date);
        expect(values.timetz).toMatch(/\d{2}:\d{2}:\d{2}/);
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    });
  },
);

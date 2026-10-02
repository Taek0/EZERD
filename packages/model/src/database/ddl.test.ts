import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { compileNativeDatabaseDDL, exportNativeDatabaseDDL } from './ddl.js';
import { nativeDDLFixture } from './ddl-fixtures.js';
import { createNativeColumn } from './editing.js';
import { databaseTypeCatalog } from './catalog.js';
import type { NativeColumnType } from './native-document.js';

describe('native whole-design DDL compiler', () => {
  it('pins MySQL collation-only table charset and independent column charset default', () => {
    const doc = nativeDDLFixture('mysql');
    doc.tables![0]!.physical.options = {
      database: 'mysql',
      engine: 'InnoDB',
      collation: 'latin1_bin',
    };
    doc.columns![1]!.physical.options = { database: 'mysql', charset: 'utf8mb4' };
    const result = compileNativeDatabaseDDL(doc);
    expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
    expect(result.sql).toContain('DEFAULT CHARACTER SET=`latin1` COLLATE=`latin1_bin`');
    expect(result.sql).toContain('CHARACTER SET `utf8mb4` COLLATE `utf8mb4_0900_ai_ci`');
  });
  it('omits explicit ordering for MySQL FULLTEXT and SPATIAL indexes', () => {
    const doc = nativeDDLFixture('mysql');
    doc.tables = [doc.tables![0]!];
    doc.columns = doc.columns!.filter((column) => column.tableId === 'parent');
    doc.tableRelations = [];
    doc.checks = [];
    doc.indexes![0]!.options = { database: 'mysql', kind: 'fulltext' };
    expect(compileNativeDatabaseDDL(doc).sql).toContain(
      'FULLTEXT INDEX `parent_label_ix` ON `parent` (`label`)',
    );
    const point = createNativeColumn(doc.database, doc.tables[0]!, 'point');
    point.physical.name = 'point';
    point.physical.nullable = false;
    point.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:point',
      parameters: { srid: 0 },
    };
    doc.columns.push(point);
    doc.indexes![0]!.options = { database: 'mysql', kind: 'spatial' };
    doc.indexes![0]!.parts[0]!.expression = { kind: 'column', columnId: point.id };
    expect(compileNativeDatabaseDDL(doc).sql).toContain(
      'SPATIAL INDEX `parent_label_ix` ON `parent` (`point`)',
    );
  });
  it('quotes SQLite declared type names so constraint keywords cannot change the column', () => {
    const doc = nativeDDLFixture('sqlite');
    doc.tables = [doc.tables![0]!];
    doc.keys = [];
    doc.indexes = [];
    doc.checks = [];
    doc.tableRelations = [];
    const column = createNativeColumn(doc.database, doc.tables[0]!, 'value');
    column.physical.name = 'value';
    column.physical.nullable = true;
    column.physical.type = {
      kind: 'declared',
      database: 'sqlite',
      name: 'INT PRIMARY KEY',
      numericArguments: [],
    };
    doc.columns = [column];
    const result = compileNativeDatabaseDDL(doc);
    expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(result.sql);
      expect(db.prepare('PRAGMA table_info(parent)').get()).toMatchObject({
        name: 'value',
        type: 'INT PRIMARY KEY',
        notnull: 0,
        pk: 0,
      });
      db.exec('INSERT INTO parent(value) VALUES(NULL),(NULL)');
    } finally {
      db.close();
    }
  });
  it('rejects MySQL CHECK over autoIncrement or cascading FK source while allowing restricted FK checks', () => {
    const doc = nativeDDLFixture('mysql');
    doc.checks![0]!.expression = {
      kind: 'binary',
      operator: '>',
      left: { kind: 'column', columnId: 'parent-ref' },
      right: { kind: 'literal', literalType: 'number', value: '0' },
    };
    const rejected = compileNativeDatabaseDDL(doc);
    expect(rejected.sql).toBe('');
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({ code: 'check.foreign-key-action-not-supported', objectId: 'ck' }),
    );
    doc.tableRelations![0]!.physical!.onDelete = 'RESTRICT';
    doc.tableRelations![0]!.physical!.onUpdate = 'NO ACTION';
    expect(compileNativeDatabaseDDL(doc).canExport).toBe(true);
    doc.checks![0]!.tableId = 'parent';
    doc.checks![0]!.expression = { kind: 'column', columnId: 'parent-id' };
    expect(compileNativeDatabaseDDL(doc).issues).toContainEqual(
      expect.objectContaining({ code: 'check.auto-increment-reference-not-supported' }),
    );
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'emits the entire %s physical design in dependency order',
    (kind) => {
      const doc = nativeDDLFixture(kind);
      const result = compileNativeDatabaseDDL(doc);
      expect(result.issues, JSON.stringify(result.issues)).not.toContainEqual(
        expect.objectContaining({ severity: 'error' }),
      );
      expect(result.canExport).toBe(true);
      expect(result.sql.match(/CREATE TABLE /g)).toHaveLength(2);
      expect(result.sql).toContain('child_parent_fk');
      expect(result.sql).toContain('child_positive_ck');
      if (kind !== 'sqlite')
        expect(result.sql.indexOf('ALTER TABLE')).toBeGreaterThan(
          result.sql.indexOf('CREATE INDEX'),
        );
      else expect(result.sql).not.toContain('ALTER TABLE');
      const gated = exportNativeDatabaseDDL(doc);
      expect(gated).toMatchObject({ sql: '', canExport: false });
      expect(gated.issues.some((issue) => issue.code === 'feature.not-implemented')).toBe(true);
    },
  );
  it('executes SQLite generation/defaults/checks/FK cascades and safely preserves comments', () => {
    const doc = nativeDDLFixture('sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      const result = compileNativeDatabaseDDL(doc);
      db.exec(result.sql);
      db.exec('INSERT INTO parent DEFAULT VALUES');
      expect(db.prepare('SELECT id,label FROM parent').get()).toMatchObject({
        id: 1,
        label: "quote' and slash\\ 한글",
      });
      db.exec('INSERT INTO child(parent_id) VALUES(1)');
      expect(() => db.exec('INSERT INTO child(parent_id,score) VALUES(1,0)')).toThrow();
      expect(() => db.exec('INSERT INTO child(parent_id) VALUES(99)')).toThrow();
      db.exec('DELETE FROM parent WHERE id=1');
      expect(db.prepare('SELECT COUNT(*) count FROM child').get()).toMatchObject({ count: 0 });
      expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });
    } finally {
      db.close();
    }
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'blocks legacy, unfinished and injected literal input on %s without partial SQL',
    (kind) => {
      const doc = nativeDDLFixture(kind);
      doc.columns![0]!.physical.type = {
        kind: 'legacy',
        source: 'document-v1',
        original: { name: 'secret_sql', isArray: false },
      };
      expect(compileNativeDatabaseDDL(doc)).toMatchObject({ sql: '', canExport: false });
      const incomplete = nativeDDLFixture(kind);
      incomplete.tables![1]!.physical.name = '';
      expect(compileNativeDatabaseDDL(incomplete)).toMatchObject({ sql: '', canExport: false });
      const injected = nativeDDLFixture(kind);
      injected.columns![1]!.physical.defaultValue = {
        kind: 'literal',
        literalType: 'number',
        value: '1); DROP TABLE parent; --',
      };
      expect(compileNativeDatabaseDDL(injected)).toMatchObject({ sql: '', canExport: false });
    },
  );
  it('detects table/index/backing index name collisions within PostgreSQL schemas', () => {
    const doc = nativeDDLFixture('postgresql');
    doc.indexes![0]!.name = 'parent_pk';
    const result = compileNativeDatabaseDDL(doc);
    expect(result).toMatchObject({ sql: '', canExport: false });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'ddl.object-name-collision', objectId: 'ix' }),
    );
  });
  it('rejects unsupported index method, uniqueness, direction and prefix combinations', () => {
    const pg = nativeDDLFixture('postgresql');
    pg.indexes![0]!.unique = true;
    pg.indexes![0]!.options = { database: 'postgresql', method: 'hash' };
    expect(compileNativeDatabaseDDL(pg).issues).toContainEqual(
      expect.objectContaining({ code: 'index.unique-method-not-supported' }),
    );
    pg.indexes![0]!.unique = false;
    pg.indexes![0]!.parts[0]!.direction = 'desc';
    expect(compileNativeDatabaseDDL(pg).issues).toContainEqual(
      expect.objectContaining({ code: 'index.direction-not-supported' }),
    );
    const mysql = nativeDDLFixture('mysql');
    mysql.columns![1]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:text',
      parameters: {},
    };
    expect(compileNativeDatabaseDDL(mysql).issues).toContainEqual(
      expect.objectContaining({ code: 'index.prefix-required' }),
    );
    mysql.indexes![0]!.parts[0]!.prefixLength = 20;
    expect(compileNativeDatabaseDDL(mysql).canExport).toBe(true);
    mysql.indexes![0]!.options = { database: 'mysql', kind: 'fulltext' };
    expect(compileNativeDatabaseDDL(mysql).issues).toContainEqual(
      expect.objectContaining({ code: 'index.special-parts-not-supported' }),
    );
  });
  it.each(databaseTypeCatalog.filter((type) => type.databaseKind === 'sqlite'))(
    'executes $id basic declaration with its actual affinity',
    (definition) => {
      const doc = nativeDDLFixture('sqlite');
      doc.tables = [doc.tables![0]!];
      doc.keys = [];
      doc.tableRelations = [];
      doc.indexes = [];
      doc.checks = [];
      const column = createNativeColumn(doc.database, doc.tables[0]!, 'value');
      column.physical.name = 'value';
      column.physical.nullable = true;
      column.physical.type = {
        kind: 'builtin',
        database: 'sqlite',
        typeId: definition.id,
      } as NativeColumnType;
      column.physical.type = { ...column.physical.type, parameters: {} } as NativeColumnType;
      doc.columns = [column];
      if (definition.sqlName === 'any')
        doc.tables[0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
      const result = compileNativeDatabaseDDL(doc);
      expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(result.sql);
        db.exec("INSERT INTO parent(value) VALUES('000123')");
        const storage =
          definition.sqlName === 'any' || ['text', 'blob'].includes(definition.sqliteAffinity ?? '')
            ? 'text'
            : definition.sqliteAffinity === 'real'
              ? 'real'
              : 'integer';
        expect(db.prepare('SELECT typeof(value) storage FROM parent').get()).toMatchObject({
          storage,
        });
        expect(db.prepare('PRAGMA table_info(parent)').all()).toHaveLength(1);
      } finally {
        db.close();
      }
    },
  );
  it('preserves PostgreSQL interval field/precision and ENUM/array declarations', () => {
    const doc = nativeDDLFixture('postgresql'),
      table = doc.tables![0]!;
    const interval = createNativeColumn(doc.database, table, 'interval');
    interval.physical.name = 'duration';
    interval.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:interval',
      parameters: { fields: 'DAY TO SECOND', precision: 3 },
    };
    const enumCol = createNativeColumn(doc.database, table, 'enum');
    enumCol.physical.name = 'status';
    enumCol.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'status',
      array: { dimensions: 2 },
    };
    doc.enums = [{ id: 'status', schema: 'public', name: 'Status', values: ["one'", 'two'] }];
    doc.columns!.push(interval, enumCol);
    const result = compileNativeDatabaseDDL(doc);
    expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
    expect(result.sql).toContain('INTERVAL DAY TO SECOND(3)');
    expect(result.sql).toContain('"public"."Status"[][]');
    expect(result.sql.indexOf('CREATE TYPE')).toBeLessThan(result.sql.indexOf('CREATE TABLE'));
  });
  it.each(
    databaseTypeCatalog.filter(
      (type) => type.databaseKind !== 'mysql' || !['enum', 'set'].includes(type.sqlName),
    ),
  )('renders the basic declaration of $id', (definition) => {
    const doc = nativeDDLFixture(definition.databaseKind);
    doc.tables = [doc.tables![0]!];
    doc.keys = [];
    doc.tableRelations = [];
    doc.indexes = [];
    doc.checks = [];
    const column = createNativeColumn(doc.database, doc.tables[0]!, 'type-fixture');
    column.physical.name = 'value';
    const parameters =
      definition.databaseKind === 'mysql' && ['varchar', 'varbinary'].includes(definition.sqlName)
        ? { length: 12 }
        : {};
    column.physical.type = {
      kind: 'builtin',
      database: definition.databaseKind,
      typeId: definition.id,
      parameters,
    } as NativeColumnType;
    doc.columns = [column];
    if (definition.id === 'sqlite:any')
      doc.tables[0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    const result = compileNativeDatabaseDDL(doc);
    expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
    expect(result.sql.toLowerCase()).toContain(definition.sqlName);
  });
  it('executes SQLite STRICT/WITHOUT ROWID and generated expression index declarations', () => {
    const doc = nativeDDLFixture('sqlite');
    doc.tables = [doc.tables![0]!];
    doc.tableRelations = [];
    doc.checks = [];
    doc.columns = doc.columns!.filter((column) => column.tableId === 'parent');
    doc.tables[0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: true };
    doc.columns[0]!.physical.generation = { kind: 'none' };
    const computed = createNativeColumn(doc.database, doc.tables[0]!, 'computed');
    computed.physical.name = 'label_len';
    computed.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:integer',
      parameters: {},
    };
    computed.physical.generation = {
      kind: 'computed',
      database: 'sqlite',
      storage: 'stored',
      expression: {
        kind: 'call',
        functionId: 'sqlite:length',
        args: [{ kind: 'column', columnId: 'label' }],
      },
    };
    doc.columns.push(computed);
    doc.indexes![0]!.parts[0]!.expression = {
      kind: 'call',
      functionId: 'sqlite:lower',
      args: [{ kind: 'column', columnId: 'label' }],
    };
    doc.indexes![0]!.options = {
      database: 'sqlite',
      predicate: { kind: 'isNull', operand: { kind: 'column', columnId: 'label' }, negate: true },
    };
    const result = compileNativeDatabaseDDL(doc);
    expect(result.canExport, JSON.stringify(result.issues)).toBe(true);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(result.sql);
      db.exec("INSERT INTO parent(id,label) VALUES(1,'hello')");
      expect(db.prepare('SELECT label_len FROM parent').get()).toMatchObject({ label_len: 5 });
      expect(() => db.exec("INSERT INTO parent(id) VALUES('oops')")).toThrow();
    } finally {
      db.close();
    }
  });
});

import { databaseTypeCatalog, type NativeColumnType, type NativeLiteral } from '@ezerd/model';

export interface PostgresBoundedLiteralCase {
  key: string;
  type: NativeColumnType;
  sqlType: string;
  value: string;
  expected: string;
  blocked: string;
  array?: boolean;
  projectEnum?: boolean;
}
const plain = (name: string): NativeColumnType =>
  ({
    kind: 'builtin',
    database: 'postgresql',
    typeId: `postgresql:${name}`,
    parameters: {},
  }) as NativeColumnType;
export const boundedLiteral = (value: string): NativeLiteral => ({
  kind: 'literal',
  literalType: 'typedText',
  value,
});
export const postgresBoundedLiteralCases: readonly PostgresBoundedLiteralCase[] = [
  ...['tsvector', 'tsquery'].map((name) => ({
    key: name,
    type: plain(name),
    sqlType: name.toUpperCase(),
    value: 'Ezerd_42',
    expected: "'Ezerd_42'",
    blocked: name === 'tsquery' ? 'a & b' : 'two tokens',
  })),
  ...[
    'int4multirange',
    'int8multirange',
    'nummultirange',
    'tsmultirange',
    'tstzmultirange',
    'datemultirange',
  ].map((name) => ({
    key: name,
    type: plain(name),
    sqlType: name.toUpperCase(),
    value: '{}',
    expected: '{}',
    blocked: '{empty}',
  })),
  {
    key: 'pg_snapshot',
    type: plain('pg_snapshot'),
    sqlType: 'PG_SNAPSHOT',
    value: '10:20:10,14,15',
    expected: '10:20:10,14,15',
    blocked: '10:20:20',
  },
  ...databaseTypeCatalog
    .filter(
      (d) =>
        d.databaseKind === 'postgresql' &&
        !d.deprecated &&
        !d.sqlName.startsWith('reg') &&
        d.category !== 'money',
    )
    .map((d) => ({
      key: d.sqlName.replaceAll(' ', '_') + '_array',
      type: { ...plain(d.sqlName), array: { dimensions: 1 } } as NativeColumnType,
      sqlType: d.sqlName.toUpperCase() + '[]',
      value: '{}',
      expected: '{}',
      blocked: '{NULL}',
      array: true,
    })),
  {
    key: 'project_enum_array',
    type: {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'qa-enum',
      array: { dimensions: 1 },
    },
    sqlType: '',
    value: '{}',
    expected: '{}',
    blocked: '{NULL}',
    array: true,
    projectEnum: true,
  },
];

export const postgresTypeNames = [
  'uuid',
  'integer',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'smallserial',
  'boolean',
  'text',
  'varchar',
  'char',
  'numeric',
  'real',
  'double precision',
  'date',
  'time',
  'timetz',
  'timestamp',
  'timestamptz',
  'json',
  'jsonb',
  'bytea',
];
const aliases: Record<string, string> = {
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  decimal: 'numeric',
  'character varying': 'varchar',
  character: 'char',
  float4: 'real',
  float8: 'double precision',
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time with time zone': 'timetz',
  'time without time zone': 'time',
};
/** Canonicalize built-in names while preserving unknown user-defined type names. */
export function canonicalPostgresTypeName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const canonical = Object.hasOwn(aliases, normalized) ? aliases[normalized]! : normalized;
  return postgresTypeNames.includes(canonical) ? canonical : name;
}

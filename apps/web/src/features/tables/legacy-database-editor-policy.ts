import { canonicalPostgresTypeName, type DatabaseKind, type Column } from '@ezerd/model';

export interface LegacyDatabaseEditorContext {
  databaseKind?: DatabaseKind | undefined;
  onRequestNativeUpgrade?: (() => void) | undefined;
}
export const isNonPostgresLegacy = (kind?: DatabaseKind) => kind === 'mysql' || kind === 'sqlite';
// Conservative v1 compatibility spellings, not native type IDs or a DDL approval.
const mysql = new Set([
  'integer',
  'bigint',
  'smallint',
  'boolean',
  'text',
  'varchar',
  'char',
  'numeric',
  'real',
  'double precision',
  'date',
  'time',
  'timestamp',
  'json',
]);
const sqlite = new Set(['integer', 'text', 'real', 'numeric']);
export function legacyScalarChoice(name: string, kind?: DatabaseKind) {
  return (
    !isNonPostgresLegacy(kind) ||
    (kind === 'mysql' ? mysql : sqlite).has(canonicalPostgresTypeName(name))
  );
}
export function legacyArrayChangeAllowed(current: boolean, next: boolean, kind?: DatabaseKind) {
  return !isNonPostgresLegacy(kind) || current || !next;
}
export function legacyDefaultChoice(value: string, kind?: DatabaseKind) {
  return !isNonPostgresLegacy(kind) || !['@auto', 'now()', 'gen_random_uuid()'].includes(value);
}
export function legacyTypeSelectionAllowed(
  current: Column['physical']['type'] | undefined,
  value: string,
  kind?: DatabaseKind,
) {
  if (!isNonPostgresLegacy(kind)) return true;
  if (
    current &&
    value === (current.enumId ? `enum:${current.enumId}` : canonicalPostgresTypeName(current.name))
  )
    return true;
  return !value.startsWith('enum:') && legacyScalarChoice(value, kind);
}

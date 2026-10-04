import {
  canonicalPostgresTypeName,
  columnTypeDisplay,
  postgresTypeNames,
  type Column,
  type DesignDocument,
  type DatabaseKind,
} from '@ezerd/model';
import { isNonPostgresLegacy, legacyScalarChoice } from './legacy-database-editor-policy.js';

type PhysicalType = Column['physical']['type'];

export function columnTypeValue(type: PhysicalType) {
  return type.enumId ? `enum:${type.enumId}` : canonicalPostgresTypeName(type.name);
}

export function columnTypeOptions(
  type?: PhysicalType,
  enums: DesignDocument['enums'] = [],
  databaseKind?: DatabaseKind,
) {
  const current = type && columnTypeValue(type);
  const names = [
    ...new Set([
      ...postgresTypeNames.filter((name) => legacyScalarChoice(name, databaseKind)),
      ...(type && !type.enumId ? [current!] : []),
    ]),
  ];
  return [
    ...names.map((value) => ({
      value,
      label:
        type && !type.enumId && value === current
          ? columnTypeDisplay(type, enums)
          : value.toUpperCase(),
    })),
    ...(enums ?? [])
      .filter((item) => !isNonPostgresLegacy(databaseKind) || type?.enumId === item.id)
      .map((item) => ({
        value: `enum:${item.id}`,
        label: item.name.toUpperCase() + ' · ENUM',
      })),
    ...(type?.enumId && !enums?.some((item) => item.id === type.enumId)
      ? [{ value: current!, label: columnTypeDisplay(type, enums) }]
      : []),
  ];
}

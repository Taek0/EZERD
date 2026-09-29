import {
  canonicalPostgresTypeName,
  columnTypeDisplay,
  postgresTypeNames,
  type Column,
  type DesignDocument,
} from '@ezerd/model';

type PhysicalType = Column['physical']['type'];

export function columnTypeValue(type: PhysicalType) {
  return type.enumId ? `enum:${type.enumId}` : canonicalPostgresTypeName(type.name);
}

export function columnTypeOptions(type?: PhysicalType, enums: DesignDocument['enums'] = []) {
  const current = type && columnTypeValue(type);
  const names = [...new Set([...postgresTypeNames, ...(type && !type.enumId ? [current!] : [])])];
  return [
    ...names.map((value) => ({
      value,
      label:
        type && !type.enumId && value === current
          ? columnTypeDisplay(type, enums)
          : value.toUpperCase(),
    })),
    ...(enums ?? []).map((item) => ({
      value: `enum:${item.id}`,
      label: item.name.toUpperCase() + ' · ENUM',
    })),
  ];
}

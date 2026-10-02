import { getDatabaseType } from './catalog.js';
import {
  nativeExpressionColumnIds,
  type NativeColumnType,
  type NativeDefaultValue,
  type NativeDesignDocument,
  type NativeExpression,
  type NativeGeneration,
} from './native-document.js';

/** Human-readable declaration; SQL export uses its own dialect serializer. Legacy text stays exact. */
export function nativeColumnTypeDisplay(
  type: NativeColumnType,
  enums: NativeDesignDocument['enums'] = [],
): string {
  if (type.kind === 'legacy') {
    const raw = type.original;
    const args =
      raw.length !== undefined
        ? `(${raw.length})`
        : raw.precision !== undefined
          ? `(${raw.precision}${raw.scale !== undefined ? `,${raw.scale}` : ''})`
          : '';
    return (
      (raw.enumId ? (enums?.find((item) => item.id === raw.enumId)?.name ?? raw.name) : raw.name) +
      args +
      (raw.isArray ? '[]' : '')
    );
  }
  if (type.kind === 'untyped') return '';
  if (type.kind === 'declared')
    return type.name + (type.numericArguments.length ? `(${type.numericArguments.join(',')})` : '');
  const array = 'array' in type && type.array ? '[]'.repeat(type.array.dimensions) : '';
  if (type.kind === 'projectEnum')
    return (enums?.find((item) => item.id === type.enumId)?.name ?? 'ENUM') + array;
  const name = (getDatabaseType(type.typeId)?.sqlName ?? type.typeId).toUpperCase();
  if (type.kind === 'valueList')
    return `${name}(${type.values.map((value) => JSON.stringify(value)).join(', ')})`;
  const parameters = type.parameters;
  let label = type.database === 'mysql' && type.declarationAlias === 'boolean' ? 'BOOLEAN' : name;
  if ('length' in parameters && parameters.length !== undefined) label += `(${parameters.length})`;
  else if ('bitLength' in parameters && parameters.bitLength !== undefined)
    label += `(${parameters.bitLength})`;
  else if ('precision' in parameters && parameters.precision !== undefined)
    label += `(${parameters.precision}${'scale' in parameters && parameters.scale !== undefined ? `,${parameters.scale}` : ''})`;
  else if ('scale' in parameters && parameters.scale !== undefined)
    label += `(scale=${parameters.scale})`;
  if ('fields' in parameters && parameters.fields) label += ` ${parameters.fields}`;
  if ('unsigned' in parameters && parameters.unsigned) label += ' UNSIGNED';
  if ('srid' in parameters && parameters.srid !== undefined) label += ` SRID ${parameters.srid}`;
  return label + array;
}

/** No evaluation, SQL parsing, numeric coercion or dialect guessing. */
export function nativeExpressionDisplay(
  value: NativeExpression,
  document: Pick<NativeDesignDocument, 'columns'>,
): string {
  nativeExpressionColumnIds(value); // The same depth/node budget as contracts and sync references.
  const columns = new Map(
    (document.columns ?? []).map((column) => [
      column.id,
      column.physical.name || column.logical.name || column.id,
    ]),
  );
  function show(node: NativeExpression): string {
    switch (node.kind) {
      case 'null':
        return 'NULL';
      case 'literal':
        return node.literalType === 'boolean'
          ? node.value
            ? 'TRUE'
            : 'FALSE'
          : node.literalType === 'number'
            ? node.value
            : node.literalType === 'binary'
              ? `X'${node.value}'`
              : JSON.stringify(node.value);
      case 'column':
        return columns.get(node.columnId) ?? `[${node.columnId}]`;
      case 'call':
        return `${node.functionId.split(':')[1]!.toUpperCase()}(${node.args.map(show).join(', ')})`;
      case 'unary':
        return `(${node.operator} ${show(node.operand)})`;
      case 'binary':
        return `(${show(node.left)} ${node.operator} ${show(node.right)})`;
      case 'isNull':
        return `(${show(node.operand)} IS ${node.negate ? 'NOT ' : ''}NULL)`;
      case 'in':
        return `(${show(node.operand)} ${node.negate ? 'NOT ' : ''}IN (${node.values.map(show).join(', ')}))`;
    }
  }
  return show(value);
}
export function nativeDefaultDisplay(
  value: NativeDefaultValue,
  document: Pick<NativeDesignDocument, 'columns'>,
): string {
  if (value.kind === 'none') return '';
  if (value.kind === 'legacyExpression') return value.original;
  if (value.kind === 'expression') return nativeExpressionDisplay(value.expression, document);
  return nativeExpressionDisplay(value, document);
}
export function nativeGenerationDisplay(
  value: NativeGeneration,
  document: Pick<NativeDesignDocument, 'columns'>,
): string {
  if (value.kind === 'none') return '';
  if (value.kind === 'serial') return 'SERIAL';
  if (value.kind === 'autoIncrement')
    return value.database === 'sqlite' ? 'AUTOINCREMENT' : 'AUTO_INCREMENT';
  if (value.kind === 'computed')
    return `${value.storage.toUpperCase()} AS ${nativeExpressionDisplay(value.expression, document)}`;
  const sequence = value.sequence
    ? Object.entries(value.sequence)
        .map(([key, option]) => `${key}=${option}`)
        .join(', ')
    : '';
  return `IDENTITY ${value.mode === 'always' ? 'ALWAYS' : 'BY DEFAULT'}${sequence ? ` (${sequence})` : ''}`;
}

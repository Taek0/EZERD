import { nativeEditorCommandSchema } from '@ezerd/contracts';
import {
  validateDatabaseDocument,
  validateDatabaseTypeParameters,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  nativeEditorPolicy,
  nativeTypeChoice,
  nativeTypeCurrentLabel,
} from './native-editor-policy.js';
export interface NativeInlineTarget {
  tableId: string;
  columnId?: string;
  mode: 'physical' | 'logical';
  field: 'name' | 'comment' | 'semanticType' | 'required' | 'format';
}
export const nativeInlineKey = (target: NativeInlineTarget) =>
  `canvas:inline:${JSON.stringify([target.tableId, target.columnId ?? '', target.mode, target.field])}`;
export function nativeInlineInput(document: NativeDesignDocument, target: NativeInlineTarget) {
  const table = document.tables?.find((t) => t.id === target.tableId);
  const column = target.columnId
    ? document.columns?.find((c) => c.id === target.columnId && c.tableId === target.tableId)
    : undefined;
  if (!table || (target.columnId && !column)) throw Error('document.object-not-found');
  const item = column ?? table;
  const value =
    target.field === 'name'
      ? item[target.mode].name
      : target.field === 'comment'
        ? target.mode === 'physical'
          ? item.physical.comment
          : item.logical.definition
        : target.field === 'semanticType'
          ? (column?.logical.semanticType ?? '')
          : target.field === 'required'
            ? String(column?.logical.required ?? false)
            : column
              ? nativeTypeChoice(column.physical.type)
              : '';
  return { table, column, value };
}

/** Search choices come from the source database and product capabilities, never v1 aliases. */
export function nativeInlineTypeOptions(
  document: NativeDesignDocument,
  target: NativeInlineTarget,
) {
  const { table, column } = nativeInlineInput(document, target);
  if (!column || target.mode !== 'physical' || target.field !== 'format') return [];
  const options: { value: string; label: string }[] = nativeEditorPolicy(document, table, column)
    .types.filter((item) => item.usable)
    .map(({ definition }) => ({ value: definition.id, label: definition.sqlName }));
  const current = nativeTypeChoice(column.physical.type);
  if (!options.some((option) => option.value === current))
    options.unshift({ value: current, label: nativeTypeCurrentLabel(column, document) });
  return options;
}

/** A direct type selection changes only type; defaults, generation and DB options survive. */
export function nativeInlineTypeCommand(
  document: NativeDesignDocument,
  target: NativeInlineTarget,
  value: string,
) {
  const { table, column } = nativeInlineInput(document, target);
  if (!column || target.mode !== 'physical' || target.field !== 'format')
    throw Error('native.inline-field-invalid');
  const previous = column.physical.type;
  if (value === nativeTypeChoice(previous)) return null;
  const entry = nativeEditorPolicy(document, table, column).types.find(
    (item) => item.definition.id === value,
  );
  if (!entry?.usable) throw Error('type.not-implemented');
  if (value === 'mysql:enum' || value === 'mysql:set')
    throw Error('native.inline-advanced-format-required');
  // Parameterized/array variants are retained when compatible. No silent parameter removal.
  const parameters = previous.kind === 'builtin' ? { ...previous.parameters } : {};
  if (validateDatabaseTypeParameters(entry.definition, parameters).length)
    throw Error('native.inline-advanced-format-required');
  const command = nativeEditorCommandSchema.parse({
    type: 'patch_column',
    id: column.id,
    patch: {
      physical: {
        type: {
          kind: 'builtin',
          database: document.database.kind,
          typeId: entry.definition.id,
          parameters,
          ...('array' in previous && previous.array ? { array: previous.array } : {}),
        },
      },
    },
  });
  if (command.type !== 'patch_column' || !command.patch.physical?.type)
    throw Error('native.inline-field-invalid');
  const type = command.patch.physical.type;
  const candidate: NativeDesignDocument = {
    ...document,
    columns: document.columns?.map((item) =>
      item.id === column.id ? { ...item, physical: { ...item.physical, type } } : item,
    ),
  };
  const issue = validateDatabaseDocument(candidate, document.database, {
    mode: 'write',
    previous: document,
  }).find((item) => item.severity === 'error');
  if (issue) throw Error(issue.code);
  return command;
}
export function nativeInlineCommand(
  document: NativeDesignDocument,
  target: NativeInlineTarget,
  value: string,
) {
  const { column, table } = nativeInlineInput(document, target);
  if (target.field === 'format') throw Error('native.inline-format-required');
  if (
    (target.field === 'semanticType' || target.field === 'required') &&
    (!column || target.mode !== 'logical')
  )
    throw Error('native.inline-field-invalid');
  if (target.field === 'required' && !['true', 'false'].includes(value))
    throw Error('native.inline-value-invalid');
  const field =
    target.field === 'comment'
      ? target.mode === 'physical'
        ? 'comment'
        : 'definition'
      : target.field;
  return nativeEditorCommandSchema.parse({
    type: column ? 'patch_column' : 'patch_table',
    id: column?.id ?? table.id,
    patch: { [target.mode]: { [field]: target.field === 'required' ? value === 'true' : value } },
  });
}

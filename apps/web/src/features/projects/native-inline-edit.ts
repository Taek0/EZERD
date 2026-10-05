import { nativeEditorCommandSchema } from '@ezerd/contracts';
import type { NativeDesignDocument } from '@ezerd/model';
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
            : '';
  return { table, column, value };
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

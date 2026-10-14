import {
  nativeColumnPatchSchema,
  nativeTablePatchSchema,
  nativePropertyDraftSchema,
  nativeEditorDraftSchema,
} from '@ezerd/contracts';
import { listNativeMemoryDrafts, type NativeDraftStorage } from './native-durable-drafts.js';
import type { NativeDesignDocument } from '@ezerd/model';
export interface NativeLocalDraftName {
  key: string;
  kind: 'table' | 'column';
  id: string;
  tableId?: string;
  field: 'physical' | 'logical';
  value: string;
  order: number;
  revision: number;
  storageFailure: boolean;
}
export function readNativeLocalDraftNames(
  user: string,
  project: string,
  storage?: NativeDraftStorage,
) {
  const names: NativeLocalDraftName[] = [];
  for (const item of listNativeMemoryDrafts(user, project, storage)) {
    const property = nativePropertyDraftSchema.safeParse(item.value);
    if (property.success) {
      const draft = property.data;
      if (draft.userId !== user || draft.projectId !== project) continue;
      for (const [field, key] of [
        ['physical', 'physicalName'],
        ['logical', 'logicalName'],
      ] as const) {
        if (draft.values[key] === draft.before[key]) continue;
        const parsed = (
          draft.kind === 'table' ? nativeTablePatchSchema : nativeColumnPatchSchema
        ).safeParse({ [field]: { name: draft.values[key] } });
        if (!parsed.success) continue;
        names.push({
          key: item.key + ':' + field,
          kind: draft.kind,
          id: draft.objectId,
          field,
          value: parsed.data[field]!.name!,
          order: item.nameOrder[key] ?? 0,
          revision: draft.expected.databaseRevision,
          storageFailure: item.storageFailure,
        });
      }
      continue;
    }
    const editor = nativeEditorDraftSchema.safeParse(item.value);
    if (!editor.success) continue;
    const draft = editor.data;
    if (
      draft.userId !== user ||
      draft.projectId !== project ||
      !draft.key.startsWith('canvas:inline:') ||
      typeof draft.values.value !== 'string' ||
      draft.values.value === draft.before.value
    )
      continue;
    try {
      const target = JSON.parse(draft.key.slice('canvas:inline:'.length));
      if (
        !Array.isArray(target) ||
        target.length !== 4 ||
        target[3] !== 'name' ||
        !['physical', 'logical'].includes(target[2]) ||
        typeof target[0] !== 'string' ||
        typeof target[1] !== 'string'
      )
        continue;
      const kind = target[1] ? 'column' : 'table',
        field = target[2] as 'physical' | 'logical';
      const parsed = (
        kind === 'table' ? nativeTablePatchSchema : nativeColumnPatchSchema
      ).safeParse({ [field]: { name: draft.values.value } });
      if (!parsed.success) continue;
      names.push({
        key: item.key,
        kind,
        id: target[1] || target[0],
        ...(kind === 'column' ? { tableId: target[0] } : {}),
        field,
        value: parsed.data[field]!.name!,
        order: item.nameOrder.value ?? 0,
        revision: draft.expected.databaseRevision,
        storageFailure: item.storageFailure,
      });
    } catch {
      /* Unrelated/malformed drafts stay available through their existing recovery UI. */
    }
  }
  return names.sort((a, b) => a.order - b.order);
}
/** Names only: preserve all structural/type/legacy fields and never alter the acknowledged document. */
export function projectNativeLocalName(
  document: NativeDesignDocument,
  kind: 'table' | 'column',
  id: string,
  patch: { physical?: { name?: string }; logical?: { name?: string } },
) {
  function rename<T extends { physical: { name: string }; logical: { name: string } }>(item: T): T {
    const physical = patch.physical?.name,
      logical = patch.logical?.name;
    if (
      (physical === undefined || physical === item.physical.name) &&
      (logical === undefined || logical === item.logical.name)
    )
      return item;
    return {
      ...item,
      physical:
        physical === undefined || physical === item.physical.name
          ? item.physical
          : { ...item.physical, name: physical },
      logical:
        logical === undefined || logical === item.logical.name
          ? item.logical
          : { ...item.logical, name: logical },
    };
  }
  if (kind === 'table') {
    const table = document.tables?.find((item) => item.id === id);
    if (!table) throw Error('document.table-not-found');
    const next = rename(table);
    return next === table
      ? document
      : { ...document, tables: document.tables!.map((item) => (item === table ? next : item)) };
  }
  const column = document.columns?.find((item) => item.id === id);
  if (!column) throw Error('document.column-not-found');
  const next = rename(column);
  return next === column
    ? document
    : { ...document, columns: document.columns!.map((item) => (item === column ? next : item)) };
}
export function projectNativeLocalDraftNames(
  document: NativeDesignDocument,
  names: readonly NativeLocalDraftName[],
  revision: number,
) {
  let next = document,
    count = 0;
  for (const name of names) {
    if (name.revision !== revision) continue;
    if (
      name.kind === 'column' &&
      name.tableId &&
      next.columns?.find((column) => column.id === name.id)?.tableId !== name.tableId
    )
      continue;
    try {
      next = projectNativeLocalName(next, name.kind, name.id, {
        [name.field]: { name: name.value },
      });
      count++;
    } catch {
      /* The draft survives remote deletion; it must not recreate an absent object. */
    }
  }
  return { document: next, count };
}

import { nativeEditorCommandSchema } from '@ezerd/contracts';
import {
  inspectNativeDatabaseDocument,
  planNativeDeletion,
  updateNativeColumn,
  type NativeDesignDocument,
} from '@ezerd/model';
import { nativeKeyInput } from './native-editor-option-policy.js';
import { nativeEditorPolicy } from './native-editor-policy.js';
import { nativeEditorErrorCode } from './native-editor-diagnostic.js';
import type { NativeWebCommand } from './native-save.js';

/** Preview and commit share one plan; membership changes preserve key options and all column payloads. */
export function nativePrimaryKeyPlan(
  document: NativeDesignDocument,
  columnId: string,
  checked: boolean,
  newKeyId: string,
) {
  const commands: NativeWebCommand[] = [];
  try {
    const column = document.columns?.find((column) => column.id === columnId),
      table = document.tables?.find((table) => table.id === column?.tableId);
    if (!column || !table || column.scope === 'logical' || table.scope === 'logical')
      throw Error('native.advanced-physical-table-required');
    const key = document.keys?.find(
      (key) => key.tableId === table.id && key.scope !== 'logical' && key.kind === 'primary',
    );
    if (!!key?.columnIds.includes(columnId) === checked) return { commands };
    if (
      key &&
      document.tableRelations?.some(
        (relation) =>
          relation.scope !== 'logical' &&
          relation.targetTableId === table.id &&
          relation.physical?.targetColumnIds.length === key.columnIds.length &&
          relation.physical.targetColumnIds.every((id, index) => id === key.columnIds[index]),
      )
    ) {
      const alternative = document.keys?.find(
        (other) =>
          other.id !== key.id &&
          other.tableId === table.id &&
          other.scope !== 'logical' &&
          other.columnIds.length === key.columnIds.length &&
          other.columnIds.every((id, index) => id === key.columnIds[index]) &&
          !(document.database.kind === 'postgresql' && other.deferrable),
      );
      if (!alternative) throw Error('foreign-key.target-key-required');
      const alternativeColumns = nativeKeyInput(document, table, 'unique', alternative.columnIds);
      const unavailable = alternativeColumns.find((choice) => !choice.productUsable);
      if (unavailable) throw Error(unavailable.code ?? 'key.not-ready');
    }
    const feature = nativeEditorPolicy(document, table, column).feature('primaryKey');
    if (!feature.usable) throw Error(feature.code ?? 'feature.not-implemented');
    const ids = checked
      ? [...(key?.columnIds ?? []), columnId]
      : key!.columnIds.filter((id) => id !== columnId);
    let candidate = document;
    if (checked && column.physical.nullable) {
      commands.push(
        nativeEditorCommandSchema.parse({
          type: 'patch_column',
          id: column.id,
          patch: { physical: { nullable: false } },
        }),
      );
      candidate = updateNativeColumn(candidate, column.id, { physical: { nullable: false } });
    }
    if (!ids.length) {
      const plan = planNativeDeletion(candidate, [{ collection: 'keys', id: key!.id }]);
      if (plan.logicalOnlyRelationIds.length) throw Error('foreign-key.target-key-required');
      if (plan.blockers.length) throw Error(plan.blockers[0]!.code);
      candidate = plan.document;
      commands.push(
        nativeEditorCommandSchema.parse({
          type: 'delete_objects',
          targets: [{ collection: 'keys', id: key!.id }],
        }),
      );
    } else {
      const selected = nativeKeyInput(candidate, table, 'primary', ids);
      const unavailable = selected.find((choice) => !choice.productUsable);
      if (unavailable) throw Error(unavailable.code ?? 'key.not-ready');
      const value = {
        ...(key ?? {
          id: newKeyId,
          tableId: table.id,
          scope: column.scope,
          kind: 'primary' as const,
          name: '',
        }),
        columnIds: ids,
      };
      commands.push(
        nativeEditorCommandSchema.parse(
          key
            ? { type: 'patch_key', id: key.id, patch: { columnIds: ids } }
            : { type: 'add_key', value },
        ),
      );
      candidate = {
        ...candidate,
        keys: [...(candidate.keys ?? []).filter((item) => item.id !== value.id), value],
      };
    }
    const baseline = new Set(
      inspectNativeDatabaseDocument(document, document.database)
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `${issue.code}:${issue.objectId}:${issue.path}`),
    );
    const issue = inspectNativeDatabaseDocument(candidate, candidate.database).find(
      (issue) =>
        issue.severity === 'error' &&
        !baseline.has(`${issue.code}:${issue.objectId}:${issue.path}`),
    );
    if (issue) throw Error(issue.code);
    return { commands };
  } catch (error) {
    return { commands: [] as NativeWebCommand[], code: nativeEditorErrorCode(error) };
  }
}

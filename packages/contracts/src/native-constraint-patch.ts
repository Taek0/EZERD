import {
  nativeKeyPatchSchema,
  nativeForeignKeyPatchSchema,
  type NativeKeyPatch,
  type NativeForeignKeyPatch,
} from './native-editor-command.js';
import { nativeStoredDesignDocumentSchema } from './native-document.js';
import type { NativeDesignDocument, NativeTableKey, NativeTableRelation } from '@ezerd/model';
/** Field deletion is explicit; don't persist null/undefined as a deferrable optional value. */
function patchDeferrable<T extends { deferrable?: NonNullable<NativeTableKey['deferrable']> }>(
  value: T,
  patch: { deferrable?: NonNullable<NativeTableKey['deferrable']> | null },
  otherFields: Partial<Omit<T, 'deferrable'>>,
): T {
  const result = { ...value, ...clone(otherFields) };
  if (Object.hasOwn(patch, 'deferrable')) {
    if (patch.deferrable === undefined) throw new Error('deferrable.explicit-undefined');
    if (patch.deferrable === null) delete result.deferrable;
    else result.deferrable = clone(patch.deferrable);
  }
  return result;
}
export function patchNativeConstraintKey(
  document: NativeDesignDocument,
  id: string,
  raw: NativeKeyPatch,
): NativeDesignDocument {
  const patch = nativeKeyPatchSchema.parse(raw),
    current = document.keys?.find((value) => value.id === id);
  if (!current) throw new Error('document.object-not-found');
  const { deferrable: _deferrable, ...otherFields } = patch;
  const result = patchDeferrable(current, patch, otherFields);
  return { ...document, keys: document.keys!.map((value) => (value.id === id ? result : value)) };
}
export function patchNativeConstraintForeignKey(
  document: NativeDesignDocument,
  id: string,
  raw: NativeForeignKeyPatch,
): NativeDesignDocument {
  const patch = nativeForeignKeyPatchSchema.parse(raw),
    current = document.tableRelations?.find((value) => value.id === id);
  if (!current) throw new Error('document.object-not-found');
  const { deferrable: _deferrable, physical, ...otherFields } = patch;
  const result = patchDeferrable<NativeTableRelation>(current, patch, {
    ...otherFields,
    logical: { ...current.logical, ...patch.logical },
  });
  if (Object.hasOwn(patch, 'physical')) {
    if (physical === null) result.physical = null;
    else if (physical)
      result.physical = nativeStoredDesignDocumentSchema.in.shape.tableRelations
        .unwrap()
        .element.shape.physical.unwrap()
        .parse({ ...current.physical, ...physical });
  }
  return {
    ...document,
    tableRelations: document.tableRelations!.map((value) => (value.id === id ? result : value)),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

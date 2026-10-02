import {
  nativeDomainCommandSchema,
  nativeStoredDesignDocumentSchema,
  type NativeDomainCommand,
  nativeKeyPatchSchema,
  nativeForeignKeyPatchSchema,
  type NativeKeyPatch,
  type NativeForeignKeyPatch,
} from '@ezerd/contracts';
import {
  addNativeDomain,
  updateNativeDomain,
  removeNativeDomain,
  moveNativeTableDomain,
  updateNodeLayout,
  inspectNativeLegacyChanges,
  type NativeDesignDocument,
  type NativeTableKey,
  type NativeTableRelation,
} from '@ezerd/model';

/** Field deletion is explicit; don't persist null/undefined as a deferrable optional value. */
function patchDeferrable<T extends { deferrable?: NonNullable<NativeTableKey['deferrable']> }>(
  value: T,
  patch: { deferrable?: NonNullable<NativeTableKey['deferrable']> | null },
  otherFields: Partial<Omit<T, 'deferrable'>>,
): T {
  const result = { ...value, ...structuredClone(otherFields) };
  if (Object.hasOwn(patch, 'deferrable')) {
    if (patch.deferrable === undefined) throw new Error('deferrable.explicit-undefined');
    if (patch.deferrable === null) delete result.deferrable;
    else result.deferrable = structuredClone(patch.deferrable);
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
  if (patch.physical && !current.physical) throw new Error('foreign-key.physical-key-required');
  const { deferrable: _deferrable, ...otherFields } = patch;
  const result = patchDeferrable<NativeTableRelation>(current, patch, {
    ...otherFields,
    logical: { ...current.logical, ...patch.logical },
    physical: patch.physical ? { ...current.physical!, ...patch.physical } : current.physical,
  });
  return {
    ...document,
    tableRelations: document.tableRelations!.map((value) => (value.id === id ? result : value)),
  };
}

/** Ordinary command identity claims span a complete batch, even if earlier commands delete an ID. */
export interface NativeDomainCandidateClaims {
  occupiedIds: Set<string>;
  retiredIds?: ReadonlySet<string>;
}
export function nativeDomainCandidateClaims(
  document: NativeDesignDocument,
  retiredIds?: ReadonlySet<string>,
): NativeDomainCandidateClaims {
  return {
    occupiedIds: new Set(
      [
        ...document.domains,
        ...document.domainRelations,
        ...document.notes,
        ...(document.views ?? []),
        ...(document.tables ?? []),
        ...(document.columns ?? []),
        ...(document.keys ?? []),
        ...(document.tableRelations ?? []),
        ...(document.enums ?? []),
        ...(document.indexes ?? []),
        ...(document.checks ?? []),
        ...document.layout.nodes,
      ].map((item) => item.id),
    ),
    ...(retiredIds ? { retiredIds } : {}),
  };
}
function claim(claims: NativeDomainCandidateClaims, id: string) {
  if (claims.retiredIds?.has(id)) throw new Error('sync.identity-retired');
  if (claims.occupiedIds.has(id)) throw new Error('document.duplicate-identities');
  claims.occupiedIds.add(id);
}
/** Domain branch for the native renderer. The caller's locked sync remains the write authority. */
export function applyNativeDomainEditorCommand(
  document: NativeDesignDocument,
  raw: NativeDomainCommand,
  claims: NativeDomainCandidateClaims,
): NativeDesignDocument {
  const command = nativeDomainCommandSchema.parse(raw);
  switch (command.type) {
    case 'add_domain': {
      claim(claims, command.value.id);
      let candidate = addNativeDomain(
        document,
        command.value,
        command.placement,
        command.nodeId ? { nodeId: command.nodeId } : {},
      );
      const node = candidate.layout.nodes.find(
        (node) => node.objectId === command.value.id && node.viewId === 'overview',
      )!;
      claim(claims, node.id);
      if (command.placement.width !== undefined || command.placement.height !== undefined)
        candidate = updateNodeLayout(candidate, node.id, {
          ...(command.placement.width !== undefined ? { width: command.placement.width } : {}),
          ...(command.placement.height !== undefined ? { height: command.placement.height } : {}),
        });
      return candidate;
    }
    case 'patch_domain':
      return updateNativeDomain(document, command.id, command.patch);
    case 'delete_domain':
      return removeNativeDomain(document, command.id, command.policy);
    case 'move_table_domain':
      return moveNativeTableDomain(document, command.tableId, command.targetDomainId);
  }
}
export function nativeDomainEditorCandidate(
  document: NativeDesignDocument,
  commands: NativeDomainCommand[],
  options: { retiredIds?: ReadonlySet<string> } = {},
): NativeDesignDocument {
  if (!commands.length || commands.length > 100) throw new Error('native.command-invalid');
  const claims = nativeDomainCandidateClaims(document, options.retiredIds);
  let candidate = structuredClone(document);
  for (const command of commands)
    candidate = applyNativeDomainEditorCommand(candidate, command, claims);
  const legacy = inspectNativeLegacyChanges(candidate, document)[0];
  if (legacy) throw new Error(legacy.code);
  return nativeStoredDesignDocumentSchema.parse(candidate);
}

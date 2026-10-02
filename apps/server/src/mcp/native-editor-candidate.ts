import {
  nativeDomainCommandSchema,
  nativeStoredDesignDocumentSchema,
  type NativeDomainCommand,
} from '@ezerd/contracts';
import {
  addNativeDomain,
  updateNativeDomain,
  removeNativeDomain,
  moveNativeTableDomain,
  updateNodeLayout,
  inspectNativeLegacyChanges,
  type NativeDesignDocument,
} from '@ezerd/model';

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

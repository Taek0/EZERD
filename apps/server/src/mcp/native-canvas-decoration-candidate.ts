import {
  nativeCanvasStyleCommandSchema,
  nativeDomainRelationCommandSchema,
  nativeStoredDesignDocumentSchema,
  type NativeCanvasStyleCommand,
  type NativeDomainRelationCommand,
} from '@ezerd/contracts';
import {
  updateNativeTable,
  updateNativeDomain,
  updateNote,
  upsertDomainRelation,
  removeDomainRelation,
  type NativeDesignDocument,
} from '@ezerd/model';
export function applyNativeDomainRelation(
  document: NativeDesignDocument,
  raw: NativeDomainRelationCommand,
): NativeDesignDocument {
  const command = nativeDomainRelationCommandSchema.parse(raw);
  const current =
    command.type !== 'add_domain_relation'
      ? document.domainRelations.find((relation) => relation.id === command.id)
      : undefined;
  if (command.type !== 'add_domain_relation' && !current)
    throw Error('canvas.domain-relation-not-found');
  const next =
    command.type === 'delete_domain_relation'
      ? removeDomainRelation(document, command.id)
      : upsertDomainRelation(
          document,
          command.type === 'add_domain_relation'
            ? command.value
            : { ...current!, ...command.patch },
        );
  return nativeStoredDesignDocumentSchema.parse(
    command.type === 'delete_domain_relation'
      ? {
          ...next,
          layout: {
            ...next.layout,
            relations: (next.layout.relations ?? []).filter(
              (route) => route.relationId !== command.id,
            ),
          },
        }
      : next,
  );
}
/** Common presentation only. The locked caller still owns context/ordinary validation and claims. */
export function applyNativeCanvasStyle(
  document: NativeDesignDocument,
  raw: NativeCanvasStyleCommand,
): NativeDesignDocument {
  const command = nativeCanvasStyleCommandSchema.parse(raw),
    { target, patch } = command;
  if (target.kind === 'table') {
    const current = document.tables?.find((table) => table.id === target.id);
    if (!current) throw Error('document.table-not-found');
    return updateNativeTable(document, target.id, {
      ...(Object.hasOwn(patch, 'color') ? { color: patch.color ?? undefined } : {}),
      ...(patch.canvasDisplay
        ? { canvasDisplay: { ...current.canvasDisplay, ...patch.canvasDisplay } }
        : {}),
    });
  }
  if (target.kind === 'domain')
    return updateNativeDomain(
      document,
      target.id,
      Object.hasOwn(patch, 'color') ? { color: patch.color ?? null } : {},
    );
  const note = document.notes.find((note) => note.id === target.id);
  if (!note) throw Error('canvas.note-not-found');
  if (
    document.views?.some((view) => view.id === note.viewId) ||
    !['overview', '__tables__', ...document.domains.map((domain) => domain.id)].includes(
      note.viewId,
    )
  )
    throw Error('canvas.shared-view-required');
  let next = updateNote(document, note.id, { color: patch.color ?? undefined });
  if (patch.color === null)
    next = {
      ...next,
      notes: next.notes.map((item) => {
        if (item.id !== note.id) return item;
        const { color: _color, ...rest } = item;
        return rest;
      }),
    };
  return next;
}

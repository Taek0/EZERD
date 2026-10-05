import { nativeEditorCommandSchema, type NativeEditorCommand } from '@ezerd/contracts';
import {
  planNativeDeletion,
  planNativeDomainDeletion,
  type NativeDesignDocument,
} from '@ezerd/model';

/** Context-menu, cut and Delete share the same cascade preview and private isolation. */
export function nativeCanvasDeleteCommands(
  source: NativeDesignDocument,
  ids: string[],
  viewId: string,
  personal = false,
): NativeEditorCommand[] {
  const commands: NativeEditorCommand[] = [];
  let candidate = source;
  const unique = [...new Set(ids)];
  if (personal) {
    if (!source.views?.some((view) => view.id === viewId))
      throw Error('canvas.personal-view-required');
    for (const id of unique) {
      const node = source.layout.nodes.find((n) => n.objectId === id && n.viewId === viewId);
      if (!node) throw Error('canvas.node-not-found');
      commands.push(
        nativeEditorCommandSchema.parse(
          source.notes.some((n) => n.id === id && n.viewId === viewId)
            ? { type: 'delete_note', id }
            : { type: 'remove_table_reference', nodeId: node.id },
        ),
      );
    }
    return commands;
  }
  for (const id of unique) {
    if (!candidate.domains.some((d) => d.id === id)) continue;
    const plan = planNativeDomainDeletion(candidate, id, { kind: 'deleteTables' });
    if (plan.deletion?.blockers.length) throw Error('deletion.blocked');
    candidate = plan.document;
    commands.push(
      nativeEditorCommandSchema.parse({
        type: 'delete_domain',
        id,
        policy: { kind: 'deleteTables' },
      }),
    );
  }
  const targets = unique
    .filter((id) => candidate.tables?.some((t) => t.id === id))
    .map((id) => ({ collection: 'tables' as const, id }));
  if (targets.length) {
    const plan = planNativeDeletion(candidate, targets);
    if (plan.blockers.length) throw Error('deletion.blocked');
    candidate = plan.document;
    commands.push(nativeEditorCommandSchema.parse({ type: 'delete_objects', targets }));
  }
  for (const id of unique)
    if (candidate.notes.some((note) => note.id === id))
      commands.push(nativeEditorCommandSchema.parse({ type: 'delete_note', id }));
  return commands;
}

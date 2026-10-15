import { nativeEditorCommandSchema, type NativeEditorCommand } from '@ezerd/contracts';
import {
  planNativeDeletion,
  planNativeDomainDeletion,
  type NativeDesignDocument,
} from '@ezerd/model';

/** Context-menu, cut and Delete share the same cascade preview. */
export function nativeCanvasDeleteCommands(
  source: NativeDesignDocument,
  ids: string[],
): NativeEditorCommand[] {
  const commands: NativeEditorCommand[] = [];
  let candidate = source;
  const unique = [...new Set(ids)];
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

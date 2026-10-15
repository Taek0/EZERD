import type { NativeHistoryPage, NativeSyncOperationResult } from '@ezerd/contracts';
import type { DocumentChange } from '@ezerd/model';

/** Mirror the server's persisted compensation metadata for the local performance fixture. */
export function relationArrangeFixtureHistory(
  results: Iterable<NativeSyncOperationResult>,
  changesByOperation: ReadonlyMap<string, DocumentChange[]>,
  clientIds: ReadonlyMap<string, string>,
  historySources: ReadonlyMap<string, string>,
  since: number,
  limit: number,
): Pick<NativeHistoryPage, 'history' | 'nextSince'> {
  const entries = [...results]
    .filter((result) => result.status === 'accepted' && result.sequence > since)
    .sort((a, b) => a.sequence - b.sequence);
  const page = entries.slice(0, limit);
  return {
    history: page.map((result) => {
      const sourceOperationId = historySources.get(result.operationId);
      return {
        operationId: result.operationId,
        sequence: result.sequence,
        clientId: clientIds.get(result.operationId)!,
        kind: 'online',
        format: 'native',
        result,
        changes: changesByOperation.get(result.operationId) ?? [],
        ...(sourceOperationId
          ? {
              deletionSnapshot: {
                nativeHistory: { command: 'undo', sourceOperationId, identityMap: [] },
              },
            }
          : {}),
      };
    }),
    nextSince: entries.length > limit ? page.at(-1)!.sequence : null,
  };
}

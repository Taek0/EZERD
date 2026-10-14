import { nativePendingSaveSchema } from '@ezerd/contracts';
import { addNativeColumn, updateNativeColumn, type NativeDesignDocument } from '@ezerd/model';
import type { NativePendingSave, NativeWebCommand } from './native-save.js';

export type ProjectionStorage = Pick<
  Storage,
  'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'
>;
export interface NativeLocalEntry {
  key: string;
  pending: NativePendingSave;
  ackSequence?: number;
}
const scope = (user: string, project: string) => JSON.stringify([user, project]);
export const localIntentPrefix = (user: string, project: string) =>
  `ezerd.native.intent:${scope(user, project)}:`;
const bridgePrefix = (user: string, project: string) =>
  `ezerd.native.visual-ack:${scope(user, project)}:`;
const listeners = new Map<string, Set<() => void>>();
const memory = new WeakMap<ProjectionStorage, Map<string, NativeLocalEntry>>();
export function subscribeNativeLocalChanges(user: string, project: string, listener: () => void) {
  const key = scope(user, project),
    set = listeners.get(key) ?? new Set();
  listeners.set(key, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(key);
  };
}
export function notifyNativeLocalChanges(user: string, project: string) {
  const set = listeners.get(scope(user, project));
  if (set)
    queueMicrotask(() => {
      for (const listener of set) listener();
    });
}
export function supportsNativeLocalColumns(commands: readonly NativeWebCommand[]) {
  return (
    commands.length > 0 &&
    commands.every((command) => {
      if (command.type === 'add_column') return true;
      if (command.type !== 'patch_column') return false;
      return (
        Object.keys(command.patch).every((key) => key === 'physical' || key === 'logical') &&
        Object.keys(command.patch.physical ?? {}).every((key) => key === 'name') &&
        Object.keys(command.patch.logical ?? {}).every((key) => key === 'name')
      );
    })
  );
}
/** The original transport intent is never rewritten. This bridge only prevents an ACK-to-render gap. */
export function recordNativeLocalResult(
  entry: NativeLocalEntry,
  accepted: boolean,
  sequence: number,
  storage: ProjectionStorage,
) {
  if (!supportsNativeLocalColumns(entry.pending.request.commands)) return;
  const marker =
    bridgePrefix(entry.pending.userId, entry.pending.projectId) + entry.pending.request.operationId;
  const map = memory.get(storage) ?? new Map<string, NativeLocalEntry>();
  memory.set(storage, map);
  if (accepted) {
    const bridge = { ...entry, ackSequence: sequence };
    map.set(marker, bridge);
    try {
      storage.setItem(marker, JSON.stringify(bridge));
    } catch {
      /* In-memory bridge remains; never lose an accepted ACK because optional visual persistence failed. */
    }
  } else {
    map.delete(marker);
    try {
      storage.removeItem(marker);
    } catch {
      /* Original rejected intent remains authoritative. */
    }
  }
}
export function readNativeLocalEntries(
  user: string,
  project: string,
  storage: ProjectionStorage,
): NativeLocalEntry[] {
  const pendingPrefix = localIntentPrefix(user, project),
    acceptedPrefix = bridgePrefix(user, project);
  const entries = new Map<string, NativeLocalEntry>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    if (key.startsWith(pendingPrefix)) {
      const pending = nativePendingSaveSchema.parse(JSON.parse(storage.getItem(key)!));
      if (pending.userId !== user || pending.projectId !== project)
        throw Error('native.pending-invalid');
      entries.set(key, { key, pending });
    } else if (key.startsWith(acceptedPrefix)) {
      const raw = JSON.parse(storage.getItem(key)!);
      const pending = nativePendingSaveSchema.parse(raw.pending);
      if (
        pending.userId !== user ||
        pending.projectId !== project ||
        typeof raw.key !== 'string' ||
        !raw.key.startsWith(pendingPrefix) ||
        !Number.isSafeInteger(raw.ackSequence) ||
        raw.ackSequence < 0
      )
        throw Error('native.pending-invalid');
      entries.set(raw.key, { key: raw.key, pending, ackSequence: raw.ackSequence });
    }
  }
  for (const [key, entry] of memory.get(storage) ?? []) {
    if (key.startsWith(acceptedPrefix)) entries.set(entry.key, entry);
  }
  return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
}
export function pruneNativeLocalBridges(
  user: string,
  project: string,
  sequence: number,
  revision: number,
  storage: ProjectionStorage,
) {
  const prefix = bridgePrefix(user, project),
    map = memory.get(storage);
  const keys = new Set<string>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.add(key);
  }
  for (const key of map?.keys() ?? []) if (key.startsWith(prefix)) keys.add(key);
  for (const key of keys) {
    const entry = map?.get(key) ?? JSON.parse(storage.getItem(key)!);
    if (
      entry.ackSequence <= sequence ||
      entry.pending.request.expectedDatabaseRevision !== revision
    ) {
      map?.delete(key);
      try {
        storage.removeItem(key);
      } catch {
        /* Reads still filter the confirmed sequence. */
      }
    }
  }
}
export function projectNativeLocalColumns(
  document: NativeDesignDocument,
  entries: readonly NativeLocalEntry[],
  sequence: number,
  revision: number,
) {
  let projected = document,
    pending = 0,
    blocked = 0;
  for (const entry of entries) {
    const commands = entry.pending.request.commands;
    if (!supportsNativeLocalColumns(commands)) continue;
    if (entry.ackSequence !== undefined && entry.ackSequence <= sequence) continue;
    if (entry.pending.request.expectedDatabaseRevision !== revision) {
      if (entry.ackSequence === undefined) blocked++;
      continue;
    }
    let next = projected;
    try {
      for (const command of commands) {
        if (command.type === 'add_column') {
          if (!next.columns?.some((column) => column.id === command.value.id))
            next = addNativeColumn(next, command.value);
        } else if (command.type === 'patch_column') {
          const column = next.columns?.find((column) => column.id === command.id);
          if (!column) throw Error('document.column-not-found');
          if (
            (command.patch.physical?.name !== undefined &&
              command.patch.physical.name !== column.physical.name) ||
            (command.patch.logical?.name !== undefined &&
              command.patch.logical.name !== column.logical.name)
          )
            next = updateNativeColumn(next, command.id, command.patch);
        }
      }
      projected = next;
      if (entry.ackSequence === undefined) pending++;
    } catch {
      if (entry.ackSequence === undefined) blocked++;
    }
  }
  return { document: projected, pending, blocked };
}

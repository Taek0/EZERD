import { requestFingerprint } from '@ezerd/model';

export type NativeDurableKind =
  'commands' | 'history' | 'privateCanvas' | 'upgrade' | 'databaseChange';
export interface NativeDurablePending {
  userId: string;
  projectId: string;
  operationId: string;
  kind: NativeDurableKind;
  payload: unknown;
}
interface Row extends NativeDurablePending {
  fingerprint: string;
  transmission: { token: string; owner: string; expiresAt: number } | string | null;
  uncertain: boolean;
}
export interface NativeDurableOptions {
  now?: () => number;
  leaseMs?: number;
  ownerId?: string;
}
export type NativeDurableState = 'unknown' | 'empty' | 'pending' | 'sending';
const scope = (userId: string, projectId: string) => JSON.stringify([userId, projectId]);
const table = 'pending';
const stores = new WeakMap<IDBFactory, NativeDurableQueue>();
const unavailable = () => new Error('native.pending-storage-unknown');
/** getRandomValues is available on HTTP LAN origins; randomUUID need not be. */
export function nativeDurableId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** One durable row per actor/project for every native writer, including database changes. */
export class NativeDurableQueue {
  private database: Promise<IDBDatabase> | undefined;
  private states = new Map<string, NativeDurableState>();
  private listeners = new Map<string, Set<() => void>>();
  private channel?: BroadcastChannel;
  private now: () => number;
  private leaseMs: number;
  private ownerId: string;
  private polling: ReturnType<typeof setInterval> | undefined;
  constructor(
    private factory: IDBFactory,
    private name = 'ezerd-native-durable-v1',
    options: NativeDurableOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.leaseMs = options.leaseMs ?? 30000;
    this.ownerId = options.ownerId ?? nativeDurableId();
    if (!Number.isFinite(this.leaseMs) || this.leaseMs <= 0) throw unavailable();
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(name);
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (!Array.isArray(data) || data.length !== 2 || data.some((v) => typeof v !== 'string'))
          return;
        void this.read(data[0] as string, data[1] as string).catch(() => {});
      };
    }
  }
  state(userId: string, projectId: string): NativeDurableState {
    return this.states.get(scope(userId, projectId)) ?? 'unknown';
  }
  subscribe(userId: string, projectId: string, listener: () => void): () => void {
    const key = scope(userId, projectId),
      listeners = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    if (typeof window !== 'undefined' && !this.polling)
      this.polling = setInterval(() => {
        for (const key of this.listeners.keys()) {
          const [actor, project] = JSON.parse(key) as [string, string];
          void this.read(actor, project).catch(() => {});
        }
      }, 4000);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
      if (!this.listeners.size && this.polling) {
        clearInterval(this.polling);
        this.polling = undefined;
      }
    };
  }
  private status(userId: string, projectId: string, row: Row | null, failed = false) {
    const key = scope(userId, projectId);
    this.states.set(
      key,
      failed
        ? 'unknown'
        : row
          ? this.leaseActive(row)
            ? 'sending'
            : row.uncertain
              ? 'unknown'
              : 'pending'
          : 'empty',
    );
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
  private open(): Promise<IDBDatabase> {
    return (this.database ??= new Promise((resolve, reject) => {
      const opening = this.factory.open(this.name, 1);
      let failed = false;
      opening.onupgradeneeded = () => opening.result.createObjectStore(table);
      opening.onerror = () => {
        failed = true;
        this.database = undefined;
        reject(opening.error ?? unavailable());
      };
      opening.onblocked = () => {
        failed = true;
        this.database = undefined;
        reject(unavailable());
      };
      opening.onsuccess = () => {
        const db = opening.result;
        if (failed) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
    }));
  }
  private validate(value: unknown, userId: string, projectId: string): Row | null {
    if (value === undefined) return null;
    if (!value || typeof value !== 'object') throw unavailable();
    const row = value as Row;
    if (
      row.userId !== userId ||
      row.projectId !== projectId ||
      typeof row.userId !== 'string' ||
      !row.userId ||
      typeof row.projectId !== 'string' ||
      !row.projectId ||
      typeof row.operationId !== 'string' ||
      !row.operationId ||
      !['commands', 'history', 'privateCanvas', 'upgrade', 'databaseChange'].includes(row.kind) ||
      !(
        row.transmission === null ||
        typeof row.transmission === 'string' ||
        (row.transmission &&
          typeof row.transmission.token === 'string' &&
          !!row.transmission.token &&
          typeof row.transmission.owner === 'string' &&
          !!row.transmission.owner &&
          Number.isFinite(row.transmission.expiresAt))
      ) ||
      !(row.uncertain === undefined || typeof row.uncertain === 'boolean') ||
      row.fingerprint !== requestFingerprint(row.payload)
    )
      throw unavailable();
    return { ...row, uncertain: row.uncertain ?? !!row.transmission };
  }
  private leaseActive(row: Row): boolean {
    return (
      !!row.transmission &&
      typeof row.transmission !== 'string' &&
      row.transmission.expiresAt > this.now()
    );
  }
  private tokenMatches(row: Row, token: string): boolean {
    return typeof row.transmission === 'string'
      ? row.transmission === token
      : row.transmission?.token === token;
  }
  private async transaction<T>(
    userId: string,
    projectId: string,
    write: boolean,
    mutate: (row: Row | null) => { row: Row | null; result: T },
    guard?: () => void,
  ): Promise<T> {
    try {
      const db = await this.open(),
        key = scope(userId, projectId);
      let committed: Row | null = null;
      const output = await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(
            table,
            write ? 'readwrite' : 'readonly',
            write ? { durability: 'strict' } : {},
          ),
          store = tx.objectStore(table);
        let result: T, error: unknown;
        tx.onabort = () => reject(error ?? tx.error ?? unavailable());
        tx.onerror = () => {
          error ??= tx.error ?? unavailable();
        };
        tx.oncomplete = () => resolve(result);
        const get = store.get(key);
        get.onsuccess = () => {
          try {
            const current = this.validate(get.result, userId, projectId);
            const changed = mutate(current);
            guard?.();
            committed = changed.row;
            result = changed.result;
            if (write) {
              if (changed.row) store.put(changed.row, key);
              else store.delete(key);
            }
          } catch (cause) {
            error = cause;
            tx.abort();
          }
        };
      });
      this.status(userId, projectId, committed);
      if (write) this.channel?.postMessage([userId, projectId]);
      return output;
    } catch (error) {
      // Busy/conflicting claims are known states, not an excuse to fall back to memory writes.
      if (!(
        error instanceof Error &&
        ['native.pending-exists', 'native.transmission-busy', 'native.pending-changed'].includes(
          error.message,
        )
      ))
        this.status(userId, projectId, null, true);
      throw error;
    }
  }
  read(userId: string, projectId: string): Promise<NativeDurablePending | null> {
    return this.transaction(userId, projectId, false, (row) => ({
      row,
      result: row ? this.publicRow(row) : null,
    }));
  }
  private publicRow(row: Row): NativeDurablePending {
    const {
      fingerprint: _fingerprint,
      transmission: _transmission,
      uncertain: _uncertain,
      ...value
    } = row;
    return structuredClone(value);
  }
  private matches(row: Row | null, pending: NativeDurablePending): row is Row {
    return (
      !!row &&
      row.kind === pending.kind &&
      row.operationId === pending.operationId &&
      row.fingerprint === requestFingerprint(pending.payload)
    );
  }
  claim(
    pending: NativeDurablePending,
    guard?: () => void,
    adopt = false,
  ): Promise<NativeDurablePending> {
    const copy = structuredClone(pending);
    return this.transaction(
      copy.userId,
      copy.projectId,
      true,
      (row) => {
        if (row) {
          if (adopt && this.matches(row, copy)) return { row, result: this.publicRow(row) };
          throw Error('native.pending-exists');
        }
        const next: Row = {
          ...copy,
          fingerprint: requestFingerprint(copy.payload),
          transmission: null,
          uncertain: adopt,
        };
        this.validate(next, copy.userId, copy.projectId);
        return { row: next, result: this.publicRow(next) };
      },
      guard,
    );
  }
  beginTransmission(pending: NativeDurablePending): Promise<string> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => {
      if (!this.matches(row, pending)) throw Error('native.pending-changed');
      if (this.leaseActive(row)) throw Error('native.transmission-busy');
      const token = nativeDurableId();
      return {
        row: {
          ...row,
          uncertain: true,
          transmission: { token, owner: this.ownerId, expiresAt: this.now() + this.leaseMs },
        },
        result: token,
      };
    });
  }
  endTransmission(pending: NativeDurablePending, token: string): Promise<void> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => ({
      row:
        this.matches(row, pending) && this.tokenMatches(row, token)
          ? { ...row, transmission: null }
          : row,
      result: undefined,
    }));
  }
  renewTransmission(pending: NativeDurablePending, token: string): Promise<boolean> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => {
      if (
        !this.matches(row, pending) ||
        !this.tokenMatches(row, token) ||
        typeof row.transmission === 'string' ||
        !row.transmission
      )
        return { row, result: false };
      return {
        row: {
          ...row,
          transmission: { ...row.transmission, expiresAt: this.now() + this.leaseMs },
        },
        result: true,
      };
    });
  }
  /** Personal PUT has no ledger. The caller proves its monotonic CAS precondition is consumed. */
  confirmPrivateCASPreconditionConsumed(
    pending: NativeDurablePending,
    token: string,
    guard?: () => void,
  ): Promise<boolean> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => {
      if (
        pending.kind !== 'privateCanvas' ||
        !this.matches(row, pending) ||
        !this.leaseActive(row) ||
        !this.tokenMatches(row, token) ||
        !row.transmission ||
        typeof row.transmission === 'string' ||
        row.transmission.owner !== this.ownerId
      )
        return { row, result: false };
      guard?.();
      return { row: { ...row, uncertain: false }, result: true };
    });
  }
  /**
   * No-new-mutation proof, not a terminal ledger rejection or proof nothing was applied earlier.
   * The required synchronous guard checks fresh remote/actor context and durably archives the
   * exact original request. Keep the row and live lease; callers end transmission then explicitly
   * discard. A subsequent transmission makes the row uncertain again and requires fresh proof.
   */
  confirmDatabaseChangePreconditionConsumed(
    pending: NativeDurablePending,
    token: string,
    guard: () => void,
  ): Promise<boolean> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => {
      if (
        pending.kind !== 'databaseChange' ||
        !this.matches(row, pending) ||
        !row.uncertain ||
        !this.leaseActive(row) ||
        !this.tokenMatches(row, token) ||
        !row.transmission ||
        typeof row.transmission === 'string' ||
        row.transmission.owner !== this.ownerId
      )
        return { row, result: false };
      const result: unknown = guard();
      if (result && typeof (result as { then?: unknown }).then === 'function')
        throw Error('native.database-change-proof-guard-async');
      return { row: { ...row, uncertain: false }, result: true };
    });
  }
  /** Only a validated terminal ledger rejection establishes that no mutation was applied. */
  confirmRejected(pending: NativeDurablePending): Promise<boolean> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => {
      if (!this.matches(row, pending)) return { row, result: false };
      return { row: { ...row, uncertain: false }, result: true };
    });
  }
  /** Caller must validate its endpoint's accepted ACK first; exact request is compared again atomically. */
  acknowledge(pending: NativeDurablePending, cleanup?: () => void): Promise<boolean> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => {
      if (!this.matches(row, pending)) return { row, result: false };
      cleanup?.();
      return { row: null, result: true };
    });
  }
  discard(pending: NativeDurablePending): Promise<boolean> {
    return this.transaction(pending.userId, pending.projectId, true, (row) => {
      if (!this.matches(row, pending)) return { row, result: false };
      if (this.leaseActive(row)) throw Error('native.transmission-busy');
      if (row.uncertain) throw Error('native.transmission-unknown');
      return { row: null, result: true };
    });
  }
  async close() {
    if (this.polling) {
      clearInterval(this.polling);
      this.polling = undefined;
    }
    this.channel?.close();
    (await this.database)?.close();
    this.database = undefined;
  }
}
export function getNativeDurableQueue(): NativeDurableQueue {
  if (typeof indexedDB === 'undefined') throw unavailable();
  let queue = stores.get(indexedDB);
  if (!queue) {
    queue = new NativeDurableQueue(indexedDB);
    stores.set(indexedDB, queue);
  }
  return queue;
}

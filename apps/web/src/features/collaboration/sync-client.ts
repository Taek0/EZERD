import { translate as t } from '../../shared/i18n/index.js';
import './translations.js';
import {
  syncEventSchema,
  syncHistoryEntrySchema,
  syncOperationResultSchema,
  personalStateSnapshotSchema,
  type PersonalState,
  type SyncEvent,
  type SyncHistoryEntry,
  type SyncOperationInput,
  type SyncOperationResult,
} from '@ezerd/contracts';
import {
  applyChanges,
  applyOperationsOverlay,
  diffSharedDocument,
  extractPersonalState,
  mergeStoredPersonalState,
  sharedDocument,
  type DesignDocument,
  type DocumentChange,
} from '@ezerd/model';
import { newId } from '../../shared/api/client.js';
import { SyncEventCursor } from './sync-events.js';
import { DurableSyncQueue, type QueueListener } from './sync-queue.js';
import {
  createSyncOperationStore,
  type StoredSyncOperation,
  type SyncOperationStore,
} from './sync-storage.js';

export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'action-needed';
export type SyncSession = { token: string; expiresAt: string; baselineIssuedAt: string };
export type SyncSnapshot = {
  document: DesignDocument;
  status: SyncStatus;
  pending: StoredSyncOperation<SyncOperationInput>[];
  history: SyncHistoryEntry[];
  storageFailure?: string;
  error?: string;
  canUndo: boolean;
  canRedo: boolean;
};

type OwnEdit = {
  operation: SyncOperationInput;
  acceptedSequence?: number;
  commandSourceId?: string;
};
type RebasedSyncOperation = SyncOperationInput & { rebaseAncestors?: string[] };
type IssuedBaseline = {
  baselineId: string;
  sequence: number;
  baselineIssuedAt: string;
  document: DesignDocument;
};
type RuntimeOptions = {
  projectId: string;
  userId: string;
  clientId: string;
  session: SyncSession;
  initialDocument: DesignDocument;
  initialSequence?: number;
  sharedReadOnly?: boolean;
  personalReadOnly?: boolean;
  fetcher?: typeof fetch;
  socketFactory?: (url: string) => WebSocket;
  store?: SyncOperationStore<SyncOperationInput>;
  onChange: (snapshot: SyncSnapshot) => void;
  onWorkspaceAccessChange?: (workspaceId: string) => void;
};

function arrayPayload(value: unknown, key: 'events' | 'history'): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>)[key]))
    return (value as Record<string, unknown>)[key] as unknown[];
  return [];
}

function modelChanges(
  changes: readonly {
    path: string;
    before: unknown;
    after: unknown;
    beforeExists?: boolean | undefined;
    afterExists?: boolean | undefined;
  }[],
): DocumentChange[] {
  return changes.map((change) => ({
    path: change.path,
    before: change.before,
    after: change.after,
    ...(change.beforeExists === undefined ? {} : { beforeExists: change.beforeExists }),
    ...(change.afterExists === undefined ? {} : { afterExists: change.afterExists }),
  }));
}

/** Reattaches camera and combined-view layout after rebuilding the shared optimistic document. */
export function mergePersonalState(
  shared: DesignDocument,
  personal: DesignDocument,
): DesignDocument {
  return mergeStoredPersonalState(shared, extractPersonalState(personal));
}

export function stableClientId(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): string {
  const key = 'ezerd.sync.clientId';
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const value = newId();
    storage.setItem(key, value);
    return value;
  } catch {
    return newId();
  }
}

export class ProjectSyncRuntime {
  private fetcher: typeof fetch;
  private socketFactory: (url: string) => WebSocket;
  private store?: SyncOperationStore<SyncOperationInput>;
  private queue?: DurableSyncQueue<SyncOperationInput, SyncOperationResult>;
  private serverDocument: DesignDocument;
  private visibleDocument: DesignDocument;
  private pending: StoredSyncOperation<SyncOperationInput>[] = [];
  private history: SyncHistoryEntry[] = [];
  private ownPast: OwnEdit[] = [];
  private ownFuture: OwnEdit[] = [];
  private historyBusy = false;
  private settlingOwn: OwnEdit | undefined;
  private connected = false;
  private stopped = false;
  private starting?: Promise<void>;
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private headTimer?: ReturnType<typeof setInterval>;
  private error: string | undefined;
  private storageFailure: string | undefined;
  private sequence: number;
  private baselineSequence: number;
  private baselineIssuedAt: string;
  private baselineId = newId();
  private baselineDocument: DesignDocument;
  private baselineRefresh: Promise<void> | undefined;
  private baselineRefreshFailed = false;
  private personalVersion = 0;
  private personalLoaded = false;
  private personalPending: PersonalState | undefined;
  private personalSaving = false;
  private personalConflict = false;
  private cursor: SyncEventCursor<SyncEvent>;
  private readonly rebases = new Map<
    string,
    { baselineId: string; baseSequence: number; baselineIssuedAt: string; document: DesignDocument }
  >();

  constructor(private readonly options: RuntimeOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.serverDocument = sharedDocument(options.initialDocument);
    this.baselineDocument = this.serverDocument;
    this.visibleDocument = options.initialDocument;
    this.sequence = options.initialSequence ?? 0;
    this.baselineSequence = this.sequence;
    this.baselineIssuedAt = options.session.baselineIssuedAt;
    this.cursor = new SyncEventCursor(
      this.sequence,
      (since) => this.fetchEvents(since),
      (event) => this.applyEvent(event),
    );
  }

  start() {
    if (this.stopped) return Promise.resolve();
    this.starting ??= this.initialize();
    return this.starting;
  }

  private async initialize() {
    try {
      const baseline = (
        this.options.personalReadOnly
          ? {}
          : await this.api('/sync-baseline', {
              method: 'POST',
              body: JSON.stringify({ clientId: this.options.clientId }),
            })
      ) as {
        baselineId?: unknown;
        sequence?: unknown;
        baselineIssuedAt?: unknown;
        document?: unknown;
      };
      if (this.stopped) return;
      if (typeof baseline.sequence === 'number' && typeof baseline.baselineIssuedAt === 'string') {
        this.sequence = baseline.sequence;
        this.baselineSequence = baseline.sequence;
        this.baselineIssuedAt = baseline.baselineIssuedAt;
        if (typeof baseline.baselineId === 'string') this.baselineId = baseline.baselineId;
        if (baseline.document) {
          this.serverDocument = sharedDocument(baseline.document as DesignDocument);
          this.baselineDocument = this.serverDocument;
          this.visibleDocument = mergePersonalState(this.serverDocument, this.visibleDocument);
        }
        this.cursor = new SyncEventCursor(
          this.sequence,
          (since) => this.fetchEvents(since),
          (event) => this.applyEvent(event),
        );
      }
    } catch {
      /* Existing durable operations remain usable while offline. */
    }
    try {
      await this.refreshPersonal();
    } catch {
      /* Personal edits stay visible and can be saved after connectivity returns. */
    }
    if (this.stopped) return;
    const selected = this.options.store
      ? { store: this.options.store }
      : await createSyncOperationStore<SyncOperationInput>();
    if (this.stopped) return;
    this.store = selected.store;
    this.storageFailure = 'failure' in selected ? selected.failure : undefined;
    this.queue = new DurableSyncQueue(
      `${this.options.userId}:${this.options.projectId}`,
      this.store,
      {
        prepare: async (operation) => {
          if (this.stopped) throw new Error(t('동기화가 중지되었습니다.'));
          const local = operation as RebasedSyncOperation;
          const rebase = [operation.baselineId, ...(local.rebaseAncestors ?? [])]
            .map((baselineId) => this.rebases.get(baselineId))
            .filter(
              (value): value is NonNullable<typeof value> =>
                !!value && value.baseSequence >= operation.baseSequence,
            )
            .sort((left, right) => right.baseSequence - left.baseSequence)[0];
          if (!rebase) return operation;
          const candidate = applyChanges(rebase.document, modelChanges(operation.changes));
          return {
            ...operation,
            rebaseAncestors: [...new Set([...(local.rebaseAncestors ?? []), operation.baselineId])],
            baselineId: rebase.baselineId,
            baseSequence: rebase.baseSequence,
            baselineIssuedAt: rebase.baselineIssuedAt,
            baselineDocument: rebase.document,
            changes: diffSharedDocument(rebase.document, candidate),
            document: candidate,
          };
        },
        submit: (operation) => {
          if (this.stopped) return Promise.reject(new Error(t('동기화가 중지되었습니다.')));
          const { rebaseAncestors: _localAncestry, ...wireOperation } =
            operation as RebasedSyncOperation;
          return this.api(`/operations`, {
            method: 'POST',
            body: JSON.stringify(wireOperation),
          }).then(syncOperationResultSchema.parse);
        },
        lookup: (operationId) => this.lookup(operationId),
      },
      (operation) => operation.operationId,
      (operation) => Date.parse(operation.baselineIssuedAt),
      (result) => ({
        accepted: result.status === 'accepted',
        ...(result.reason ? { reason: result.reason } : {}),
      }),
      (event) => this.queueEvent(event),
    );
    await this.queue.load();
    if (this.stopped) return;
    this.connect();
    this.headTimer = setInterval(() => void this.pollHead(), 15_000);
    await Promise.allSettled([
      this.pumpShared(),
      this.refreshHistory(),
      this.cursor.receiveHead(Number.MAX_SAFE_INTEGER),
    ]);
    if (!this.stopped) this.publish();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.headTimer) clearInterval(this.headTimer);
    this.socket?.close();
  }

  private async pumpShared() {
    if (!this.stopped && !this.options.sharedReadOnly) await this.queue?.pump();
  }

  async edit(next: DesignDocument) {
    if (this.stopped || this.options.personalReadOnly) return;
    const changes = diffSharedDocument(this.visibleDocument, next);
    if (this.options.sharedReadOnly && changes.length) return;
    if (
      JSON.stringify(extractPersonalState(this.visibleDocument)) !==
      JSON.stringify(extractPersonalState(next))
    ) {
      this.personalPending = extractPersonalState(next);
      void this.flushPersonal();
    }
    this.visibleDocument = next;
    if (!changes.length) {
      this.publish();
      return;
    }
    await this.starting;
    if (this.stopped) return;
    await this.ensureCurrentBaseline();
    if (this.stopped) return;
    if (!this.queue) {
      this.error = t('동기화 대기열이 준비되지 않아 편집을 보관하지 못했습니다.');
      this.publish();
      return;
    }
    const operationBaseline = sharedDocument(this.baselineDocument);
    let candidate: DesignDocument;
    let claimed = changes;
    let representable = true;
    try {
      candidate = applyChanges(operationBaseline, changes);
      claimed = diffSharedDocument(operationBaseline, candidate);
    } catch {
      // Keep intent durable without sending a partial claim/full-document mismatch.
      candidate = sharedDocument(next);
      representable = false;
    }
    const predecessorBaselines = this.pending
      .filter((item) => item.state !== 'unresolved')
      .flatMap((item) => {
        const predecessor = item.operation as RebasedSyncOperation;
        return [predecessor.baselineId, ...(predecessor.rebaseAncestors ?? [])];
      });
    const operation: RebasedSyncOperation = {
      operationId: newId(),
      groupId: newId(),
      clientId: this.options.clientId,
      baselineId: this.baselineId,
      baseSequence: this.baselineSequence,
      baselineIssuedAt: this.baselineIssuedAt,
      kind: this.connected ? 'online' : 'reconnect',
      dependencyPaths: [],
      changes: claimed,
      baselineDocument: operationBaseline,
      document: candidate,
      ...(predecessorBaselines.length
        ? { rebaseAncestors: [...new Set(predecessorBaselines)] }
        : {}),
    };
    const hasPendingPredecessor = this.pending.some((item) => item.state !== 'unresolved');
    this.ownPast.push({ operation });
    this.ownFuture = [];
    try {
      await this.queue.enqueue(operation);
      if (!representable && !hasPendingPredecessor) {
        await this.queue.markUnresolved(
          operation.operationId,
          t('현재 서버 기준에서 변경 대상을 찾을 수 없습니다. 연결을 복구한 뒤 재적용해 주세요.'),
        );
        this.error = t('편집 의도는 로컬에 보관했지만 현재 서버 기준에 자동 반영할 수 없습니다.');
        this.publish();
        return;
      }
      void this.pumpShared();
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('로컬 변경을 보관하지 못했습니다.');
    }
    this.publish();
  }

  async reapply(operationId: string) {
    if (this.options.sharedReadOnly) return;
    await this.starting;
    if (this.stopped || !this.queue) return;
    const source = (await this.queue.items()).find(
      (item) => item.operationId === operationId && item.state === 'unresolved',
    );
    if (!source) return;
    await this.ensureCurrentBaseline();
    if (this.stopped) return;
    const operationBaseline = sharedDocument(this.baselineDocument);
    let candidate: DesignDocument;
    try {
      candidate = applyChanges(operationBaseline, modelChanges(source.operation.changes));
    } catch {
      this.error = t('현재 문서에서 변경 대상을 찾을 수 없어 재적용하지 못했습니다.');
      this.publish();
      return;
    }
    const changes = diffSharedDocument(operationBaseline, candidate);
    if (!changes.length) {
      await this.queue.discard(source.operationId);
      this.error = undefined;
      return;
    }
    const operation: SyncOperationInput = {
      ...source.operation,
      operationId: newId(),
      groupId: newId(),
      baselineId: this.baselineId,
      baseSequence: this.baselineSequence,
      baselineIssuedAt: this.baselineIssuedAt,
      kind: 'reconnect',
      changes,
      baselineDocument: operationBaseline,
      document: candidate,
    };
    await this.queue.enqueue(operation);
    await this.queue.discard(source.operationId);
    this.ownPast = this.ownPast.filter(
      (value) => value.operation.operationId !== source.operationId,
    );
    this.ownPast.push({ operation });
    this.ownFuture = [];
    this.error = undefined;
    void this.pumpShared();
  }

  async discard(operationId: string) {
    await this.starting;
    if (this.stopped || !this.queue) return;
    const source = (await this.queue.items()).find(
      (item) => item.operationId === operationId && item.state === 'unresolved',
    );
    if (!source) return;
    await this.queue.discard(operationId);
    this.ownPast = this.ownPast.filter((value) => value.operation.operationId !== operationId);
    this.ownFuture = this.ownFuture.filter((value) => value.operation.operationId !== operationId);
    void this.pumpShared();
  }

  async undo() {
    if (this.historyBusy || this.options.sharedReadOnly) return;
    this.historyBusy = true;
    try {
      await this.undoOne();
    } finally {
      this.historyBusy = false;
    }
  }

  private async undoOne() {
    const own = this.ownPast.pop();
    if (!own || !this.queue) return;
    const queued = this.pending.find((item) => item.operationId === own.operation.operationId);
    if (queued?.state === 'queued' || queued?.state === 'unresolved') {
      const discarded = await this.queue.discard(queued.operationId);
      if (!discarded) {
        this.settlingOwn = own;
        try {
          await this.pumpShared();
        } finally {
          this.settlingOwn = undefined;
        }
        const remaining = (await this.queue.items()).find(
          (item) => item.operationId === queued.operationId,
        );
        if (remaining || own.acceptedSequence === undefined) {
          this.ownPast.push(own);
          return;
        }
        try {
          await this.toggleAcceptedEdit(own);
        } catch (error) {
          this.ownPast.push(own);
          this.error =
            error instanceof Error ? error.message : t('작업을 실행 취소하지 못했습니다.');
          this.publish();
          throw error;
        }
      }
    } else if (own.acceptedSequence !== undefined) {
      try {
        await this.toggleAcceptedEdit(own);
      } catch (error) {
        this.ownPast.push(own);
        this.error = error instanceof Error ? error.message : t('작업을 실행 취소하지 못했습니다.');
        this.publish();
        throw error;
      }
    } else {
      if (queued && (queued.state === 'sending' || queued.state === 'unknown')) {
        this.settlingOwn = own;
        try {
          await this.pumpShared();
        } finally {
          this.settlingOwn = undefined;
        }
        const remaining = (await this.queue.items()).find(
          (item) => item.operationId === queued.operationId,
        );
        if (remaining) {
          this.ownPast.push(own);
          return;
        }
        if (own.acceptedSequence !== undefined) {
          try {
            await this.toggleAcceptedEdit(own);
            this.ownFuture.push(own);
            this.rebuildVisible();
            return;
          } catch (error) {
            this.ownPast.push(own);
            this.error =
              error instanceof Error ? error.message : t('작업을 실행 취소하지 못했습니다.');
            this.publish();
            throw error;
          }
        }
      }
      this.ownPast.push(own);
      return;
    }
    this.ownFuture.push(own);
    this.rebuildVisible();
  }

  async redo() {
    if (this.historyBusy || this.options.sharedReadOnly) return;
    this.historyBusy = true;
    try {
      await this.redoOne();
    } finally {
      this.historyBusy = false;
    }
  }

  private async redoOne() {
    const own = this.ownFuture.pop();
    if (!own || !this.queue) return;
    if (own.acceptedSequence !== undefined) {
      try {
        await this.toggleAcceptedEdit(own);
        this.ownPast.push(own);
        this.rebuildVisible();
      } catch (error) {
        this.ownFuture.push(own);
        this.error = error instanceof Error ? error.message : t('작업을 다시 실행하지 못했습니다.');
        this.publish();
        throw error;
      }
      return;
    }
    let document: DesignDocument;
    try {
      document = applyChanges(this.baselineDocument, modelChanges(own.operation.changes));
    } catch (error) {
      this.ownFuture.push(own);
      this.error = t('현재 문서에서 작업을 다시 실행할 수 없습니다.');
      this.publish();
      throw error;
    }
    const operation = {
      ...own.operation,
      operationId: newId(),
      groupId: newId(),
      baselineId: this.baselineId,
      baseSequence: this.baselineSequence,
      baselineIssuedAt: this.baselineIssuedAt,
      baselineDocument: this.baselineDocument,
      document,
      changes: diffSharedDocument(this.baselineDocument, document),
      kind: 'reconnect' as const,
    };
    await this.queue.enqueue(operation);
    this.ownPast.push({ operation });
    void this.pumpShared();
  }

  private async toggleAcceptedEdit(own: OwnEdit) {
    const sourceOperationId = own.commandSourceId ?? own.operation.operationId;
    const result = syncOperationResultSchema.parse(
      await this.api(`/operations/${encodeURIComponent(sourceOperationId)}/undo`, {
        method: 'POST',
        body: JSON.stringify({
          operationId: newId(),
          groupId: newId(),
          clientId: this.options.clientId,
        }),
      }),
    );
    if (result.status !== 'accepted')
      throw new Error(result.reason ?? t('서버가 작업을 되돌리지 않았습니다.'));
    own.commandSourceId = result.operationId;
    own.acceptedSequence = result.sequence;
    const newest = result.sequence >= this.sequence;
    this.sequence = Math.max(this.sequence, result.sequence);
    if (result.document && newest) this.serverDocument = sharedDocument(result.document);
    if (result.sequence >= this.baselineSequence) {
      this.baselineId = result.nextBaseline.baselineId;
      this.baselineSequence = result.nextBaseline.baseSequence;
      this.baselineIssuedAt = result.nextBaseline.baselineIssuedAt;
      if (result.document) this.baselineDocument = sharedDocument(result.document);
    }
    this.error = undefined;
    this.rebuildVisible();
    void this.refreshHistory();
  }

  async refreshHistory() {
    try {
      const payload = await this.api('/history?since=0');
      if (this.stopped) return;
      this.history = arrayPayload(payload, 'history').map((value) =>
        syncHistoryEntrySchema.parse(value),
      );
      this.publish();
    } catch {
      /* The editor can keep syncing while history is temporarily unavailable. */
    }
  }

  private async lookup(operationId: string) {
    const response = await this.raw(`/operations/${encodeURIComponent(operationId)}`);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        t('작업 처리 상태를 확인하지 못했습니다 ({status}).', { status: response.status }),
      );
    return syncOperationResultSchema.parse(await response.json());
  }

  private async fetchEvents(since: number) {
    const payload = await this.api(`/events?since=${since}`);
    return arrayPayload(payload, 'events').map((value) => syncEventSchema.parse(value));
  }

  private async ensureCurrentBaseline() {
    if (this.options.personalReadOnly) return;
    while (!this.stopped && this.baselineSequence < this.sequence) {
      if (!this.baselineRefresh) {
        this.baselineRefreshFailed = false;
        const refresh = (async () => {
          try {
            const value = (await this.api('/sync-baseline', {
              method: 'POST',
              body: JSON.stringify({ clientId: this.options.clientId }),
            })) as IssuedBaseline;
            if (
              this.stopped ||
              typeof value.sequence !== 'number' ||
              typeof value.baselineId !== 'string' ||
              typeof value.baselineIssuedAt !== 'string' ||
              !value.document
            )
              return;
            if (value.sequence < this.sequence) return;
            this.baselineId = value.baselineId;
            this.baselineSequence = value.sequence;
            this.baselineIssuedAt = value.baselineIssuedAt;
            this.baselineDocument = sharedDocument(value.document);
            this.serverDocument = sharedDocument(value.document);
            this.sequence = Math.max(this.sequence, value.sequence);
            this.error = undefined;
            this.rebuildVisible();
          } catch (error) {
            if (this.stopped) return;
            this.baselineRefreshFailed = true;
            this.connected = false;
            this.error =
              error instanceof Error ? error.message : t('최신 동기화 기준을 받지 못했습니다.');
            this.publish();
          }
        })();
        this.baselineRefresh = refresh;
        void refresh.finally(() => {
          if (this.baselineRefresh === refresh) this.baselineRefresh = undefined;
        });
      }
      await this.baselineRefresh;
      if (this.baselineSequence < this.sequence && this.baselineRefreshFailed) break;
    }
  }

  private applyEvent(event: SyncEvent) {
    if (this.stopped) return;
    if (event.sequence <= this.sequence) return;
    this.sequence = event.sequence;
    if (event.status === 'accepted') {
      this.serverDocument = event.document
        ? sharedDocument(event.document)
        : applyChanges(this.serverDocument, modelChanges(event.changes));
    }
    this.rebuildVisible();
  }

  private queueEvent(event: Parameters<QueueListener<SyncOperationInput, SyncOperationResult>>[0]) {
    if (this.stopped) return;
    if (event.type === 'changed') {
      this.pending = event.items;
      this.rebuildVisible();
    } else if (event.type === 'ack') {
      const result = event.result;
      if (result.status === 'accepted') {
        const newest = result.sequence >= this.sequence;
        this.sequence = Math.max(this.sequence, result.sequence);
        if (result.document && newest) {
          this.serverDocument = sharedDocument(result.document);
        }
        const own =
          this.ownPast.find((value) => value.operation.operationId === result.operationId) ??
          (this.settlingOwn?.operation.operationId === result.operationId
            ? this.settlingOwn
            : undefined);
        if (own) {
          own.acceptedSequence = result.sequence;
          own.commandSourceId = result.operationId;
        }
        if (result.document) {
          const local = event.item.operation as RebasedSyncOperation;
          for (const sourceBaselineId of [local.baselineId, ...(local.rebaseAncestors ?? [])]) {
            const existing = this.rebases.get(sourceBaselineId);
            if (!existing || result.nextBaseline.baseSequence >= existing.baseSequence) {
              this.rebases.set(sourceBaselineId, {
                baselineId: result.nextBaseline.baselineId,
                baseSequence: result.nextBaseline.baseSequence,
                baselineIssuedAt: result.nextBaseline.baselineIssuedAt,
                document: sharedDocument(result.document),
              });
            }
          }
        }
      }
      if (result.status === 'accepted' && result.sequence >= this.baselineSequence) {
        this.baselineId = result.nextBaseline.baselineId;
        this.baselineSequence = result.nextBaseline.baseSequence;
        this.baselineIssuedAt = result.nextBaseline.baselineIssuedAt;
        this.baselineDocument = result.document
          ? sharedDocument(result.document)
          : this.baselineDocument;
      }
      this.rebuildVisible();
      void this.refreshHistory();
    } else if (event.type === 'expired') {
      this.storageFailure = t(
        '7일이 지난 로컬 미반영 편집을 정리했습니다. 해당 편집은 더 이상 복원할 수 없습니다.',
      );
      this.publish();
    } else if (event.type === 'error') {
      this.connected = false;
      this.error = event.error instanceof Error ? event.error.message : t('연결이 끊겼습니다.');
      this.publish();
    }
  }

  private rebuildVisible() {
    let shared = this.serverDocument;
    for (const item of this.pending) {
      try {
        shared = applyChanges(shared, modelChanges(item.operation.changes));
      } catch {
        if (item.state !== 'unresolved') {
          const unresolved = {
            ...item,
            state: 'unresolved' as const,
            reason: t('변경 대상이 삭제되어 자동 반영할 수 없습니다.'),
          };
          this.pending = this.pending.map((value) =>
            value.operationId === item.operationId ? unresolved : value,
          );
          void this.store?.put(unresolved);
        }
      }
    }
    this.visibleDocument = mergePersonalState(shared, this.visibleDocument);
    this.publish();
  }

  private publish() {
    const unresolved = this.pending.some((item) => item.state === 'unresolved');
    const active = this.pending.some((item) => item.state !== 'unresolved');
    const status: SyncStatus =
      this.storageFailure || unresolved || this.personalConflict
        ? 'action-needed'
        : active
          ? this.connected
            ? 'syncing'
            : 'offline'
          : this.connected
            ? 'synced'
            : 'offline';
    this.options.onChange({
      document: this.visibleDocument,
      status,
      pending: this.pending,
      history: this.history,
      ...(this.storageFailure ? { storageFailure: this.storageFailure } : {}),
      ...(this.error ? { error: this.error } : {}),
      canUndo: this.ownPast.length > 0,
      canRedo: this.ownFuture.length > 0,
    });
  }

  private connect() {
    if (this.stopped) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socketFactory(
      `${protocol}//${location.host}/api/sync?token=${encodeURIComponent(this.options.session.token)}`,
    );
    this.socket = socket;
    socket.onopen = () => {
      if (!this.stopped && this.socket === socket)
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            projectId: this.options.projectId,
            clientId: this.options.clientId,
            since: this.sequence,
          }),
        );
    };
    socket.onmessage = (message) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const value = JSON.parse(String(message.data)) as {
          type?: string;
          projectId?: string;
          workspaceId?: string;
          sequence?: number;
          event?: unknown;
        };
        if (value.type === 'workspace-access-changed' && value.workspaceId) {
          this.stop();
          this.options.onWorkspaceAccessChange?.(value.workspaceId);
          return;
        }
        if (value.projectId !== this.options.projectId) return;
        if (value.type === 'subscribed') {
          this.connected = true;
          this.error = undefined;
          void this.cursor
            .receiveHead(value.sequence ?? this.sequence)
            .then(() => this.pumpShared());
          this.publish();
        } else if (value.type === 'head')
          void this.cursor.receiveHead(value.sequence ?? this.sequence);
        else if (value.type === 'operation')
          void this.cursor.receive(syncEventSchema.parse(value.event));
      } catch {
        this.error = t('실시간 변경을 해석하지 못했습니다.');
        this.publish();
      }
    };
    socket.onclose = () => {
      if (this.stopped || this.socket !== socket) return;
      this.connected = false;
      this.publish();
      this.reconnectTimer = setTimeout(() => this.connect(), 2_000);
    };
    socket.onerror = () => {
      if (this.stopped || this.socket !== socket) return;
      this.connected = false;
      this.publish();
    };
  }

  private async pollHead() {
    if (this.stopped) return;
    try {
      const events = await this.fetchEvents(this.cursor.current);
      if (this.stopped) return;
      for (const event of events) await this.cursor.receive(event);
      if (events.length) this.connected = true;
      await this.pumpShared();
      await this.refreshPersonal().catch(() => undefined);
      void this.flushPersonal();
    } catch {
      if (this.stopped) return;
      this.connected = false;
      this.publish();
    }
  }

  private raw(path: string, init?: RequestInit) {
    return this.fetcher(`/api/projects/${this.options.projectId}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.session.token}`,
        ...init?.headers,
      },
    });
  }

  private async refreshPersonal() {
    const snapshot = personalStateSnapshotSchema.parse(await this.api('/personal-state'));
    if (this.stopped) return;
    if (this.personalLoaded && snapshot.version <= this.personalVersion) return;
    if (this.personalPending || this.personalSaving) {
      if (this.personalLoaded) {
        this.personalConflict = true;
        this.error = t('개인 화면이 다른 곳에서 변경되었습니다. 프로젝트를 다시 열어 주세요.');
        this.publish();
      } else {
        this.personalVersion = snapshot.version;
        this.personalLoaded = true;
        void this.flushPersonal();
      }
      return;
    }
    this.personalVersion = snapshot.version;
    this.personalLoaded = true;
    this.visibleDocument = mergeStoredPersonalState(
      sharedDocument(this.visibleDocument),
      snapshot.state,
    );
    this.publish();
    void this.flushPersonal();
  }

  private async flushPersonal() {
    if (this.stopped || this.options.personalReadOnly) return;
    if (this.personalSaving || !this.personalLoaded || this.personalConflict) return;
    this.personalSaving = true;
    try {
      while (!this.stopped && this.personalPending) {
        const state = this.personalPending;
        this.personalPending = undefined;
        try {
          const response = await this.raw('/personal-state', {
            method: 'PUT',
            body: JSON.stringify({ expectedVersion: this.personalVersion, state }),
          });
          if (!response.ok) {
            if (response.status === 409) this.personalConflict = true;
            throw new Error(
              t('개인 화면을 저장하지 못했습니다 ({status}).', { status: response.status }),
            );
          }
          const saved = personalStateSnapshotSchema.parse(await response.json());
          this.personalVersion = saved.version;
          if (this.error?.startsWith(t('개인 화면을 저장하지 못했습니다'))) this.error = undefined;
        } catch (error) {
          this.personalPending ??= state;
          this.error =
            error instanceof Error ? error.message : t('개인 화면을 저장하지 못했습니다.');
          this.publish();
          break;
        }
      }
    } finally {
      this.personalSaving = false;
    }
  }

  private async api(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.raw(path, init);
    if (!response.ok)
      throw new Error(
        t('동기화 요청을 완료하지 못했습니다 ({status}).', { status: response.status }),
      );
    return response.json();
  }
}

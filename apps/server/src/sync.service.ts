import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { designDocumentSchema, syncEventSchema, syncOperationResultSchema } from '@ezerd/contracts';
import type { SyncActor, SyncEvent, SyncHistoryEntry, SyncOperationInput, SyncOperationResult } from '@ezerd/contracts';
import { applyChanges, claimedChangesMatch, deletionSnapshots, deriveOperationChanges, deriveStructuralDependencyPaths, diagnoseDocument, findFieldVersionConflicts, findInverseConflicts, inverseChanges, requestFingerprint, sharedDocument } from '@ezerd/model';
import type { DesignDocument, DocumentChange } from '@ezerd/model';
import { DatabaseService } from './db/database.service.js';
import { projects, syncClientBaselines, syncFieldVersions, syncOperations, syncTombstones } from './db/schema.js';
import type { AuthenticatedUser } from './session.js';
import { SyncGateway } from './sync.gateway.js';

const RECONNECT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function fingerprint(input: SyncOperationInput): string {
  return createHash('sha256').update(requestFingerprint(input)).digest('hex');
}
function actor(user: AuthenticatedUser): SyncActor { return { id: user.id, username: user.username, color: user.color }; }
function eventFrom(row: typeof syncOperations.$inferSelect): SyncEvent {
  const result = syncOperationResultSchema.parse(row.result);
  return syncEventSchema.parse({ ...result, changes: row.changes });
}
type ApplyOptions = {
  inverseGuard?: { paths: string[]; acceptedSequence: number };
  requestHash?: string;
  operationMetadata?: Record<string, unknown>;
};
type RestoreMetadata = { command: 'restore' | 'undo'; sourceOperationId: string; omittedRelations: string[] };
function restoreMetadata(value: unknown): RestoreMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const metadata = value as Partial<RestoreMetadata>;
  return (metadata.command === 'restore' || metadata.command === 'undo') && typeof metadata.sourceOperationId === 'string' && Array.isArray(metadata.omittedRelations)
    ? metadata as RestoreMetadata : undefined;
}
const knownIdFields = new Set(['id', 'domainId', 'sourceDomainId', 'targetDomainId', 'viewId', 'objectId', 'tableId', 'sourceTableId', 'targetTableId', 'relationId', 'enumId']);
const knownIdArrays = new Set(['domainIds', 'columnIds', 'sourceColumnIds', 'targetColumnIds']);
function remapDesignIds(value: unknown, idMap: ReadonlyMap<string, string>, key?: string): unknown {
  if (typeof value === 'string') return key && knownIdFields.has(key) ? idMap.get(value) ?? value : value;
  if (Array.isArray(value)) return key && knownIdArrays.has(key) ? value.map(item => typeof item === 'string' ? idMap.get(item) ?? item : item) : value.map(item => remapDesignIds(item, idMap));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, remapDesignIds(child, idMap, childKey)]));
  return value;
}
function referencedDesignIds(value: unknown, key?: string, output = new Set<string>()): Set<string> {
  if (typeof value === 'string' && key && knownIdFields.has(key) && key !== 'id') output.add(value);
  else if (Array.isArray(value)) {
    if (key && knownIdArrays.has(key)) for (const item of value) if (typeof item === 'string') output.add(item);
    else for (const item of value) referencedDesignIds(item, undefined, output);
  } else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) referencedDesignIds(child, childKey, output);
  return output;
}

@Injectable()
export class SyncService implements OnModuleInit, OnApplicationShutdown {
  private cleanupTimer?: NodeJS.Timeout;
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(SyncGateway) private readonly gateway: SyncGateway) {}

  onModuleInit(): void {
    void this.cleanupExpired().catch(() => undefined);
    this.cleanupTimer = setInterval(() => void this.cleanupExpired().catch(() => undefined), 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }
  onApplicationShutdown(): void { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  async apply(projectId: string, input: SyncOperationInput, user: AuthenticatedUser, options: ApplyOptions = {}): Promise<SyncOperationResult> {
    const requestHash = options.requestHash ?? fingerprint(input);
    const outcome = await this.database.db.transaction(async tx => {
      // Idempotency is checked before age, baseline, status, and conflict validation.
      const [replay] = await tx.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, input.operationId)));
      if (replay) {
        if (replay.fingerprint !== requestHash || replay.actorId !== user.id) throw new ConflictException('같은 작업 ID에 다른 요청을 사용할 수 없습니다.');
        return { result: syncOperationResultSchema.parse(replay.result), event: undefined };
      }

      const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const [lockedReplay] = await tx.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, input.operationId)));
      if (lockedReplay) {
        if (lockedReplay.fingerprint !== requestHash || lockedReplay.actorId !== user.id) throw new ConflictException('같은 작업 ID에 다른 요청을 사용할 수 없습니다.');
        return { result: syncOperationResultSchema.parse(lockedReplay.result), event: undefined };
      }
      if (project.status !== 'active') throw new ConflictException('보관된 프로젝트는 편집할 수 없습니다.');
      if (project.syncSequence >= MAX_SEQUENCE) throw new ConflictException('프로젝트 변경 순서 한도를 초과했습니다.');

      const derived = deriveOperationChanges(input.baselineDocument, input.document);
      const dependencyPaths = deriveStructuralDependencyPaths(input.document, derived);
      const claimed: DocumentChange[] = input.changes.map(change => ({
        path: change.path, before: change.before, after: change.after,
        ...(change.beforeExists !== undefined ? { beforeExists: change.beforeExists } : {}),
        ...(change.afterExists !== undefined ? { afterExists: change.afterExists } : {}),
      }));
      if (!claimedChangesMatch(derived, claimed)) throw new BadRequestException('문서와 변경 목록이 일치하지 않습니다.');

      const versionRows = await tx.select({ path: syncFieldVersions.path, sequence: syncFieldVersions.sequence }).from(syncFieldVersions).where(eq(syncFieldVersions.projectId, projectId));
      const versions = new Map(versionRows.map(row => [row.path, row.sequence]));
      let reason: string | undefined;
      if (options.inverseGuard) {
        const conflicts = findInverseConflicts(options.inverseGuard.paths.map(path => ({ path, before: null, after: null })), options.inverseGuard.acceptedSequence, versions);
        if (conflicts.length) reason = `후속 변경 때문에 실행 취소할 수 없습니다: ${conflicts.join(', ')}`;
      }
      const [baseline] = await tx.select().from(syncClientBaselines).where(and(
        eq(syncClientBaselines.projectId, projectId), eq(syncClientBaselines.baselineId, input.baselineId),
        eq(syncClientBaselines.clientId, input.clientId), eq(syncClientBaselines.userId, user.id),
      ));
      const issuedAt = new Date(input.baselineIssuedAt);
      if (!reason && (!baseline || baseline.lastSuccessfulSyncAt.getTime() !== issuedAt.getTime() || baseline.lastSequence !== input.baseSequence || input.baseSequence > project.syncSequence || requestFingerprint(sharedDocument(baseline.document)) !== requestFingerprint(input.baselineDocument) || Date.now() - baseline.lastSuccessfulSyncAt.getTime() > RECONNECT_MAX_AGE_MS)) {
        reason = '서버가 발급한 동기화 기준이 만료되었거나 일치하지 않습니다.';
      } else if (!reason && input.kind === 'reconnect') {
          const conflicts = findFieldVersionConflicts({ kind: input.kind, baseSequence: input.baseSequence, changes: derived, dependencyPaths }, versions);
          if (conflicts.length) reason = `다른 변경과 겹친 속성입니다: ${conflicts.join(', ')}`;
      }

      if (!reason) for (const change of derived) {
        if (change.before === null && change.after && versions.has(change.path)) { reason = '과거에 삭제되거나 사용된 객체 ID는 다시 사용할 수 없습니다.'; break; }
      }

      let nextDocument: DesignDocument | undefined;
      let acceptedChanges: DocumentChange[] = [];
      if (!reason) {
        try { nextDocument = applyChanges(project.document, derived); }
        catch { reason = '변경 대상이 삭제되었거나 현재 문서에 없습니다.'; }
      }
      if (!reason && nextDocument) {
        const valid = designDocumentSchema.safeParse(nextDocument);
        if (!valid.success) reason = '변경 후 문서 구조가 유효하지 않습니다.';
        else { nextDocument = valid.data; acceptedChanges = deriveOperationChanges(project.document, nextDocument); }
      }

      const sequence = project.syncSequence + 1;
      const createdAt = new Date();
      const nextBaselineId = reason ? input.baselineId : randomUUID();
      const nextBaselineSequence = reason ? input.baseSequence : sequence;
      const nextBaselineIssuedAt = reason ? input.baselineIssuedAt : createdAt.toISOString();
      const result: SyncOperationResult = syncOperationResultSchema.parse({
        operationId: input.operationId, groupId: input.groupId, sequence,
        status: reason ? 'rejected' : 'accepted', ...(reason && { reason }), actor: actor(user),
        changedPaths: reason ? [] : acceptedChanges.map(change => change.path), createdAt: createdAt.toISOString(),
        ...(!reason && nextDocument && { document: nextDocument }),
        nextBaseline: { baselineId: nextBaselineId, baseSequence: nextBaselineSequence, baselineIssuedAt: nextBaselineIssuedAt },
      });
      const snapshots = reason ? [] : deletionSnapshots(acceptedChanges);
      await tx.update(projects).set({
        syncSequence: sequence, ...(!reason && nextDocument ? { document: nextDocument, version: sql`${projects.version} + 1` } : {}), updatedAt: createdAt,
      }).where(eq(projects.id, projectId));
      await tx.insert(syncOperations).values({
        projectId, operationId: input.operationId, groupId: input.groupId, clientId: input.clientId, actorId: user.id,
        sequence, baseSequence: input.baseSequence, baselineIssuedAt: new Date(input.baselineIssuedAt), baselineId: input.baselineId, kind: input.kind,
        fingerprint: requestHash, changes: acceptedChanges, result: result as unknown as Record<string, unknown>,
        deletionSnapshot: snapshots.length || options.operationMetadata ? { ...(snapshots.length ? { items: snapshots } : {}), ...(options.operationMetadata ?? {}) } : null, createdAt,
      });
      if (!reason) {
        for (const change of acceptedChanges) await tx.insert(syncFieldVersions).values({ projectId, path: change.path, sequence, operationId: input.operationId, updatedAt: createdAt })
          .onConflictDoUpdate({ target: [syncFieldVersions.projectId, syncFieldVersions.path], set: { sequence, operationId: input.operationId, updatedAt: createdAt } });
        const expiresAt = new Date(createdAt.getTime() + HISTORY_RETENTION_MS);
        for (const item of snapshots) {
          const objectId = item.path.split('/').at(-1)!;
          await tx.insert(syncTombstones).values({ projectId, objectId, operationId: input.operationId, sequence, snapshot: item as Record<string, unknown>, createdAt, expiresAt })
            .onConflictDoUpdate({ target: [syncTombstones.projectId, syncTombstones.objectId], set: { operationId: input.operationId, sequence, snapshot: item as Record<string, unknown>, createdAt, expiresAt } });
        }
      }
      if (!reason) await tx.insert(syncClientBaselines).values({ baselineId: nextBaselineId, projectId, clientId: input.clientId, userId: user.id, lastSuccessfulSyncAt: createdAt, lastSequence: sequence, document: sharedDocument(nextDocument!) });
      const event = syncEventSchema.parse({ ...result, changes: acceptedChanges });
      return { result, event };
    });
    if (outcome.event) this.gateway.publish(projectId, outcome.event);
    return outcome.result;
  }

  async lookup(projectId: string, operationId: string, user: AuthenticatedUser): Promise<SyncOperationResult> {
    const [row] = await this.database.db.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, operationId)));
    if (!row) throw new NotFoundException('작업 결과를 찾을 수 없습니다.');
    // All collaborators can inspect project history, but authentication is mandatory.
    void user;
    return syncOperationResultSchema.parse(row.result);
  }

  async events(projectId: string, since: number): Promise<{ sequence: number; events: SyncEvent[]; resetRequired: boolean; document?: DesignDocument }> {
    return this.database.db.transaction(async tx => {
      const [project] = await tx.select({ sequence: projects.syncSequence, document: projects.document }).from(projects).where(eq(projects.id, projectId));
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const rows = await tx.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), gt(syncOperations.sequence, since))).orderBy(asc(syncOperations.sequence));
      const resetRequired = project.sequence > since && (!rows.length || rows[0]!.sequence > since + 1);
      return { sequence: project.sequence, events: rows.map(eventFrom), resetRequired, ...(resetRequired ? { document: project.document } : {}) };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async history(projectId: string, since: number): Promise<SyncHistoryEntry[]> {
    const rows = await this.database.db.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), gt(syncOperations.sequence, since))).orderBy(asc(syncOperations.sequence));
    return rows.map(row => {
      const snapshot = row.deletionSnapshot as { items?: unknown[] } | null;
      return { ...eventFrom(row), clientId: row.clientId, kind: row.kind as 'online' | 'reconnect', ...(snapshot?.items?.length ? { deletionSnapshot: { items: snapshot.items } } : {}) };
    });
  }

  async establishBaseline(projectId: string, clientId: string, user: AuthenticatedUser): Promise<{ baselineId: string; sequence: number; baselineIssuedAt: string; document: DesignDocument }> {
    return this.database.db.transaction(async tx => {
      const [project] = await tx.select({ sequence: projects.syncSequence, document: projects.document }).from(projects).where(eq(projects.id, projectId));
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const now = new Date();
      const baselineId = randomUUID();
      const document = sharedDocument(project.document);
      await tx.insert(syncClientBaselines).values({ baselineId, projectId, clientId, userId: user.id, lastSuccessfulSyncAt: now, lastSequence: project.sequence, document });
      return { baselineId, sequence: project.sequence, baselineIssuedAt: now.toISOString(), document };
    });
  }

  async restore(projectId: string, deletedOperationId: string, request: { operationId: string; groupId: string; clientId: string }, user: AuthenticatedUser, command: 'restore' | 'undo' = 'restore') {
    const commandHash = createHash('sha256').update(requestFingerprint({ command, projectId, ...(command === 'restore' ? { deletedOperationId } : { sourceOperationId: deletedOperationId }), ...request })).digest('hex');
    const [replay] = await this.database.db.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, request.operationId)));
    if (replay) {
      const metadata = restoreMetadata(replay.deletionSnapshot);
      if (replay.actorId !== user.id || replay.fingerprint !== commandHash || replay.groupId !== request.groupId || replay.clientId !== request.clientId || metadata?.command !== command || metadata.sourceOperationId !== deletedOperationId) throw new ConflictException('같은 복원 작업 ID에 다른 요청을 사용할 수 없습니다.');
      return { result: syncOperationResultSchema.parse(replay.result), omittedRelations: metadata.omittedRelations };
    }
    const [source] = await this.database.db.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, deletedOperationId)));
    const rawItems = (source?.deletionSnapshot as { items?: Array<{ path: string; snapshot: unknown }> } | null)?.items;
    if (!source || !rawItems?.length || source.createdAt.getTime() < Date.now() - HISTORY_RETENTION_MS) throw new NotFoundException('복원 가능한 삭제 기록을 찾을 수 없습니다.');
    const [project] = await this.database.db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    if (project.status !== 'active') throw new ConflictException('보관된 프로젝트는 복원할 수 없습니다.');

    const idMap = new Map<string, string>();
    for (const item of rawItems) {
      const snapshot = item.snapshot as { id?: unknown };
      if (snapshot && typeof snapshot === 'object' && typeof snapshot.id === 'string') idMap.set(snapshot.id, randomUUID());
    }
    const existingIds = new Set<string>(['overview']);
    const collect = (items: unknown[] | undefined) => items?.forEach(item => { if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') existingIds.add((item as { id: string }).id); });
    collect(project.document.domains); collect(project.document.views); collect(project.document.enums); collect(project.document.tables); collect(project.document.columns);
    collect(project.document.keys); collect(project.document.tableRelations); collect(project.document.domainRelations); collect(project.document.notes); collect(project.document.layout.nodes);
    for (const id of idMap.values()) existingIds.add(id);
    const omittableCollections = new Set(['domainRelations', 'tableRelations', 'keys', 'relations']);
    const omittedRelations: string[] = [];
    const changes: DocumentChange[] = [];
    for (const item of rawItems) {
      const snapshot = remapDesignIds(item.snapshot, idMap) as Record<string, unknown>;
      const segments = item.path.split('/').filter(Boolean);
      const collection = segments.at(-2)!;
      const invalidReference = [...referencedDesignIds(snapshot)].some(id => !existingIds.has(id));
      if (invalidReference) {
        if (omittableCollections.has(collection)) { omittedRelations.push(item.path); continue; }
        throw new ConflictException(`복원 대상의 필수 참조를 찾을 수 없습니다: ${item.path}`);
      }
      let newKey: string;
      if (segments[0] === 'layout' && segments[1] === 'relations') newKey = `${String(snapshot.viewId)}:${String(snapshot.relationId)}`;
      else {
        const oldKey = segments.at(-1)!;
        newKey = typeof snapshot.id === 'string' ? snapshot.id : idMap.get(oldKey) ?? randomUUID();
      }
      changes.push({ path: `/${segments.slice(0, -1).join('/')}/${newKey}`, before: null, after: snapshot, beforeExists: false });
    }
    const keptRelationIds = new Set([
      ...(project.document.tableRelations ?? []).map(relation => relation.id),
      ...changes.filter(change => change.path.startsWith('/tableRelations/')).map(change => String((change.after as { id?: unknown })?.id ?? '')).filter(Boolean),
    ]);
    for (let index = changes.length - 1; index >= 0; index--) {
      const change = changes[index]!;
      if (!change.path.startsWith('/layout/relations/')) continue;
      const relationId = String((change.after as { relationId?: unknown })?.relationId ?? '');
      if (!keptRelationIds.has(relationId)) { omittedRelations.push(change.path); changes.splice(index, 1); }
    }
    if (!changes.length) throw new ConflictException('현재 문서에 유효하게 복원할 객체가 없습니다.');
    const baseline = await this.establishBaseline(projectId, request.clientId, user);
    let candidate = applyChanges(baseline.document, changes);
    const restoredRelationIds = new Set(changes.filter(change => change.path.startsWith('/tableRelations/')).map(change => String((change.after as { id?: unknown })?.id ?? '')));
    const invalidRestoredRelations = new Set(diagnoseDocument(candidate).filter(item => restoredRelationIds.has(item.objectId)).map(item => item.objectId));
    if (invalidRestoredRelations.size) {
      for (const relationId of invalidRestoredRelations) omittedRelations.push(`/tableRelations/${relationId}`);
      const filtered = changes.filter(change => {
        if (change.path.startsWith('/tableRelations/') && invalidRestoredRelations.has(String((change.after as { id?: unknown })?.id ?? ''))) return false;
        if (change.path.startsWith('/layout/relations/') && invalidRestoredRelations.has(String((change.after as { relationId?: unknown })?.relationId ?? ''))) {
          omittedRelations.push(change.path);
          return false;
        }
        return true;
      });
      candidate = applyChanges(baseline.document, filtered);
      changes.splice(0, changes.length, ...filtered);
    }
    if (!designDocumentSchema.safeParse(candidate).success) throw new ConflictException('현재 문서 구조와 호환되는 범위를 복원할 수 없습니다.');
    const restoredIds = new Set(changes.map(change => String((change.after as { id?: unknown })?.id ?? '')).filter(Boolean));
    const newDiagnostics = diagnoseDocument(candidate).filter(item => restoredIds.has(item.objectId));
    if (newDiagnostics.length) throw new ConflictException(`현재 문서 구조와 호환되는 범위를 복원할 수 없습니다: ${newDiagnostics[0]!.message}`);
    const derived = deriveOperationChanges(baseline.document, candidate);
    const input: SyncOperationInput = {
      operationId: request.operationId, groupId: request.groupId, clientId: request.clientId,
      baselineId: baseline.baselineId, baseSequence: baseline.sequence, baselineIssuedAt: baseline.baselineIssuedAt, kind: 'online', dependencyPaths: [], changes: derived,
      baselineDocument: baseline.document, document: candidate,
    };
    const uniqueOmittedRelations = [...new Set(omittedRelations)];
    const metadata: RestoreMetadata = { command, sourceOperationId: deletedOperationId, omittedRelations: uniqueOmittedRelations };
    return { result: await this.apply(projectId, input, user, { requestHash: commandHash, operationMetadata: metadata }), omittedRelations: uniqueOmittedRelations };
  }

  async undo(projectId: string, sourceOperationId: string, request: { operationId: string; groupId: string; clientId: string }, user: AuthenticatedUser) {
    const commandHash = createHash('sha256').update(requestFingerprint({ command: 'undo', projectId, sourceOperationId, ...request })).digest('hex');
    const [replay] = await this.database.db.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, request.operationId)));
    if (replay) {
      if (replay.actorId !== user.id || replay.fingerprint !== commandHash || replay.groupId !== request.groupId || replay.clientId !== request.clientId) throw new ConflictException('같은 실행 취소 작업 ID에 다른 요청을 사용할 수 없습니다.');
      return syncOperationResultSchema.parse(replay.result);
    }
    const [source] = await this.database.db.select().from(syncOperations).where(and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, sourceOperationId)));
    if (!source) throw new NotFoundException('되돌릴 작업을 찾을 수 없습니다.');
    if (source.actorId !== user.id) throw new ConflictException('내가 승인받은 작업만 실행 취소할 수 있습니다.');
    const sourceResult = syncOperationResultSchema.parse(source.result);
    if (sourceResult.status !== 'accepted') throw new ConflictException('승인된 작업만 되돌릴 수 있습니다.');
    if ((source.changes as DocumentChange[]).some(change => deletionSnapshots([change]).length)) {
      return (await this.restore(projectId, sourceOperationId, request, user, 'undo')).result;
    }
    const baseline = await this.establishBaseline(projectId, request.clientId, user);
    const changes = inverseChanges(source.changes as DocumentChange[]);
    let candidate: DesignDocument;
    try { candidate = applyChanges(baseline.document, changes); }
    catch { throw new ConflictException('현재 문서에서 작업을 되돌릴 수 없습니다.'); }
    const input: SyncOperationInput = {
      operationId: request.operationId, groupId: request.groupId, clientId: request.clientId,
      baselineId: baseline.baselineId, baseSequence: baseline.sequence, baselineIssuedAt: baseline.baselineIssuedAt,
      kind: 'online', dependencyPaths: [], changes: deriveOperationChanges(baseline.document, candidate), baselineDocument: baseline.document, document: candidate,
    };
    const sourceDocument = sourceResult.document ?? baseline.document;
    const dependencies = deriveStructuralDependencyPaths(sourceDocument, source.changes as DocumentChange[]);
    return this.apply(projectId, input, user, {
      requestHash: commandHash,
      operationMetadata: { command: 'undo', sourceOperationId },
      inverseGuard: { paths: [...changes.map(change => change.path), ...dependencies], acceptedSequence: source.sequence },
    });
  }

  private async cleanupExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
    await this.database.db.delete(syncTombstones).where(lt(syncTombstones.expiresAt, new Date()));
    await this.database.db.delete(syncOperations).where(lt(syncOperations.createdAt, cutoff));
    await this.database.db.delete(syncClientBaselines).where(lt(syncClientBaselines.lastSuccessfulSyncAt, cutoff));
  }
}

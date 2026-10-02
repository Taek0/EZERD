import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MAX_DOCUMENT_BYTES,
  nativeHistoryCommandSchema,
  nativeHistoryCommandResultSchema,
  nativeHistoryPageSchema,
  nativeStoredDesignDocumentSchema,
  nativeSyncEventSchema,
  nativeSyncOperationResultSchema,
  syncChangeSchema,
  type NativeHistoryCommandResult,
  type NativeHistoryPage,
} from '@ezerd/contracts';
import {
  applyChanges,
  deletionSnapshots,
  deriveOperationChanges,
  deriveStructuralDependencyPaths,
  findInverseConflicts,
  inverseChanges,
  nativeReferenceProblems,
  remapNativeDocumentIds,
  requestFingerprint,
  resolveProjectDatabaseState,
  sharedDocument,
  validateDatabaseDocument,
  type DocumentChange,
  type NativeDesignDocument,
  type NativeIdentityRemap,
} from '@ezerd/model';
import { DatabaseService } from '../db/database.service.js';
import {
  projects,
  syncClientBaselines,
  syncFieldVersions,
  syncOperations,
  syncTombstones,
} from '../db/schema.js';
import type { AuthenticatedUser } from '../identity/session.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';
import { SyncGateway } from './sync.gateway.js';
import { readNativeHistoryCancellation } from './native-cancellation-record.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BASELINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const same = (a: unknown, b: unknown) => requestFingerprint(a) === requestFingerprint(b);
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');
const entityCollections = [
  'domains',
  'domainRelations',
  'notes',
  'views',
  'tables',
  'columns',
  'enums',
  'keys',
  'tableRelations',
  'indexes',
  'checks',
] as const;

function nativeDocument(raw: unknown): NativeDesignDocument {
  const parsed = nativeStoredDesignDocumentSchema.safeParse(raw);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_DOCUMENT_BYTES)
    throw new ConflictException({ code: 'history.document-invalid' });
  if (!same(parsed.data, raw))
    throw new ConflictException({ code: 'document.native-normalization-required' });
  return structuredClone(parsed.data);
}
function snapshotAt(document: NativeDesignDocument, path: string): unknown {
  const parts = path
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (
    parts.length === 2 &&
    entityCollections.includes(parts[0] as (typeof entityCollections)[number])
  )
    return document[parts[0] as (typeof entityCollections)[number]]?.find(
      (item) => item.id === parts[1],
    );
  if (parts.length === 3 && parts[0] === 'layout' && parts[1] === 'nodes')
    return document.layout.nodes.find((item) => item.id === parts[2]);
  if (parts.length === 3 && parts[0] === 'layout' && parts[1] === 'relations')
    return document.layout.relations?.find(
      (item) => `${item.viewId}:${item.relationId}` === parts[2],
    );
  return undefined;
}
function isCreation(change: DocumentChange) {
  return (
    change.beforeExists === false &&
    !!change.after &&
    typeof change.after === 'object' &&
    (/^\/(?:domains|domainRelations|notes|views|tables|columns|enums|keys|tableRelations|indexes|checks)\/[^/]+$/.test(
      change.path,
    ) ||
      /^\/layout\/(?:nodes|relations)\/[^/]+$/.test(change.path))
  );
}
function layoutDependencies(document: NativeDesignDocument, changes: DocumentChange[]): string[] {
  const paths = new Set<string>();
  const add = (collection: string, id: string, properties: string[] = ['@exists']) => {
    for (const property of properties) paths.add(`/${collection}/${segment(id)}/${property}`);
  };
  for (const change of changes) {
    if (!change.path.startsWith('/layout/')) continue;
    const path = change.path.split('/').slice(0, 4).join('/');
    const item = snapshotAt(document, path) as
      { objectId?: string; relationId?: string; viewId?: string } | undefined;
    if (!item) continue;
    if (item.viewId && !['overview', '__tables__'].includes(item.viewId)) {
      if (document.domains.some((domain) => domain.id === item.viewId)) add('domains', item.viewId);
      else add('views', item.viewId, ['@exists', 'domainIds']);
    }
    if (item.objectId) {
      if (document.tables?.some((table) => table.id === item.objectId))
        add('tables', item.objectId, ['@exists', 'domainId']);
      else if (document.notes.some((note) => note.id === item.objectId))
        add('notes', item.objectId, ['@exists', 'viewId']);
      else add('domains', item.objectId);
    }
    if (item.relationId) {
      add('tableRelations', item.relationId, [
        '@exists',
        'scope',
        'sourceTableId',
        'targetTableId',
        'physical',
      ]);
      // Dependencies below are derived from the stored relation, never client claims.
      const relation = document.tableRelations?.find((relation) => relation.id === item.relationId);
      if (relation)
        for (const path of deriveStructuralDependencyPaths(document, [
          { path: `/tableRelations/${segment(relation.id)}`, before: relation, after: relation },
        ]))
          paths.add(path);
    }
  }
  return [...paths];
}
function freshMapping(
  documents: NativeDesignDocument[],
  snapshots: ReturnType<typeof deletionSnapshots>,
) {
  const entities = new Map<string, string>(),
    nodes = new Map<string, string>();
  for (const document of documents) {
    for (const collection of entityCollections)
      for (const item of document[collection] ?? []) entities.set(item.id, item.id);
    for (const node of document.layout.nodes) nodes.set(node.id, node.id);
  }
  const identityMap: NativeHistoryCommandResult['identityMap'] = [];
  for (const snapshot of snapshots) {
    const item = snapshot.snapshot as { id?: unknown };
    if (typeof item?.id !== 'string') continue; // Route identity is the remapped view/relation pair.
    const kind = snapshot.path.startsWith('/layout/nodes/') ? 'node' : 'entity';
    const mapping = kind === 'node' ? nodes : entities;
    const to = randomUUID();
    mapping.set(item.id, to);
    identityMap.push({ kind, from: item.id, to });
  }
  return { mapping: { entities, nodes } satisfies NativeIdentityRemap, identityMap };
}

@Injectable()
export class NativeHistoryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(SyncGateway) private readonly gateway: SyncGateway,
  ) {}

  history(
    projectId: string,
    since: number,
    limit: number,
    user: AuthenticatedUser,
  ): Promise<NativeHistoryPage> {
    return this.access.runProject(user.id, projectId, 'read', async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
      if (!project) throw new NotFoundException({ code: 'history.project-not-found' });
      const rows = await tx
        .select()
        .from(syncOperations)
        .where(and(eq(syncOperations.projectId, projectId), gt(syncOperations.sequence, since)))
        .orderBy(asc(syncOperations.sequence))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return nativeHistoryPageSchema.parse({
        protocolVersion: 2,
        projectId,
        version: project.version,
        sequence: project.syncSequence,
        database: resolveProjectDatabaseState(project),
        history: page.map((row) => ({
          operationId: row.operationId,
          sequence: row.sequence,
          clientId: row.clientId,
          kind: row.kind,
          format:
            row.result.protocolVersion !== 2
              ? 'legacy'
              : row.result.reasonCode === 'document.upgraded'
                ? 'upgrade'
                : 'native',
          result: structuredClone(row.result),
          changes: structuredClone(row.changes),
          ...(row.deletionSnapshot
            ? { deletionSnapshot: structuredClone(row.deletionSnapshot) }
            : {}),
        })),
        nextSince: rows.length > limit ? page.at(-1)!.sequence : null,
      });
    });
  }

  async compensate(
    projectId: string,
    sourceOperationId: string,
    command: 'undo' | 'restore',
    raw: unknown,
    user: AuthenticatedUser,
  ): Promise<NativeHistoryCommandResult> {
    const identity = z.object({ operationId: z.uuid() }).passthrough().safeParse(raw);
    if (!identity.success) throw new BadRequestException({ code: 'history.input-invalid' });
    const fingerprint = createHash('sha256')
      .update(
        requestFingerprint({
          command: `native-history.${command}`,
          projectId,
          sourceOperationId,
          input: raw,
        }),
      )
      .digest('hex');
    const outcome = await this.database.db.transaction(async (tx) => {
      // Replaying an immutable ACK only needs retained read access. Keep this transaction
      // writable so a new command can acquire the current row lock and design permission.
      await this.access.requireProject(user.id, projectId, 'read', tx);
      const replay = async () => {
        const [row] = await tx
          .select()
          .from(syncOperations)
          .where(
            and(
              eq(syncOperations.projectId, projectId),
              eq(syncOperations.operationId, identity.data.operationId),
            ),
          );
        if (!row)
          return readNativeHistoryCancellation(
            tx,
            projectId,
            identity.data.operationId,
            user.id,
            fingerprint,
            command,
            sourceOperationId,
          );
        if (row.actorId !== user.id)
          throw new ForbiddenException({ code: 'history.replay-actor-mismatch' });
        if (row.fingerprint !== fingerprint)
          throw new ConflictException({ code: 'sync.replay-mismatch' });
        const metadata = row.deletionSnapshot as { nativeHistory?: unknown } | null;
        const output = nativeHistoryCommandResultSchema.safeParse({
          ...(metadata?.nativeHistory as object),
          result: row.result,
        });
        if (
          !output.success ||
          output.data.command !== command ||
          output.data.sourceOperationId !== sourceOperationId
        )
          throw new ConflictException({ code: 'sync.replay-mismatch' });
        return structuredClone({
          ...(metadata?.nativeHistory as object),
          result: row.result,
        }) as NativeHistoryCommandResult;
      };
      const old = await replay();
      if (old) return { output: old };
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update');
      if (!project) throw new NotFoundException({ code: 'history.project-not-found' });
      const lockedReplay = await replay();
      if (lockedReplay) return { output: lockedReplay };
      await this.access.requireProject(user.id, projectId, 'design', tx);
      const input = nativeHistoryCommandSchema.safeParse(raw);
      if (!input.success)
        throw new BadRequestException({
          code: 'history.input-invalid',
          issues: input.error.issues,
        });
      const request = input.data,
        database = resolveProjectDatabaseState(project);
      if (project.status !== 'active') throw new ConflictException({ code: 'project.archived' });
      if (
        request.expectedVersion !== project.version ||
        request.expectedSequence !== project.syncSequence ||
        request.databaseRevision !== database.revision ||
        request.database.kind !== database.kind ||
        request.database.profileId !== database.profileId
      )
        throw new ConflictException({ code: 'database.context-changed' });
      if (project.version >= 2147483647 || project.syncSequence >= 2147483647)
        throw new ConflictException({ code: 'sync.sequence-limit' });
      const current = nativeDocument(project.document);
      if (
        current.database.kind !== database.kind ||
        current.database.profileId !== database.profileId
      )
        throw new ConflictException({ code: 'database.context-changed' });
      const [baseline] = await tx
        .select()
        .from(syncClientBaselines)
        .where(
          and(
            eq(syncClientBaselines.projectId, projectId),
            eq(syncClientBaselines.baselineId, request.baselineId),
            eq(syncClientBaselines.clientId, request.clientId),
            eq(syncClientBaselines.userId, user.id),
          ),
        );
      const now = new Date();
      if (
        !baseline ||
        baseline.lastSequence !== project.syncSequence ||
        baseline.databaseRevision !== database.revision ||
        baseline.lastSuccessfulSyncAt.getTime() !== new Date(request.baselineIssuedAt).getTime() ||
        now.getTime() < baseline.lastSuccessfulSyncAt.getTime() ||
        now.getTime() - baseline.lastSuccessfulSyncAt.getTime() > BASELINE_MAX_AGE_MS ||
        !same(baseline.document, sharedDocument(current))
      )
        throw new ConflictException({ code: 'history.baseline-invalid' });
      const [source] = await tx
        .select()
        .from(syncOperations)
        .where(
          and(
            eq(syncOperations.projectId, projectId),
            eq(syncOperations.operationId, sourceOperationId),
          ),
        );
      if (!source) throw new NotFoundException({ code: 'history.source-not-found' });
      if (source.actorId !== user.id)
        throw new ForbiddenException({ code: 'history.source-actor-mismatch' });
      const accepted = nativeSyncOperationResultSchema.safeParse(source.result);
      if (!accepted.success || accepted.data.reasonCode === 'document.upgraded')
        throw new ConflictException({ code: 'history.format-boundary' });
      const sourceResult = accepted.data;
      if (
        sourceResult.status !== 'accepted' ||
        !sourceResult.document ||
        sourceResult.operationId !== source.operationId ||
        sourceResult.groupId !== source.groupId ||
        sourceResult.sequence !== source.sequence ||
        sourceResult.nextBaseline.baseSequence !== source.sequence ||
        sourceResult.actor.id !== source.actorId ||
        source.sequence > project.syncSequence
      )
        throw new ConflictException({ code: 'history.source-invalid' });
      if (
        sourceResult.databaseRevision !== database.revision ||
        sourceResult.database.kind !== database.kind ||
        sourceResult.database.profileId !== database.profileId
      )
        throw new ConflictException({ code: 'database.context-changed' });
      if (source.createdAt.getTime() < now.getTime() - RETENTION_MS || source.createdAt > now)
        throw new ConflictException({ code: 'history.source-expired' });
      const [consumed] = await tx
        .select({ id: syncOperations.id })
        .from(syncOperations)
        .where(
          and(
            eq(syncOperations.projectId, projectId),
            sql`${syncOperations.deletionSnapshot}->'nativeHistory'->>'sourceOperationId' = ${sourceOperationId}`,
            sql`${syncOperations.result}->>'status' = 'accepted'`,
          ),
        )
        .limit(1);
      if (consumed) throw new ConflictException({ code: 'history.source-already-compensated' });
      const parsedChanges = z.array(syncChangeSchema).min(1).max(1000).safeParse(source.changes);
      if (
        !parsedChanges.success ||
        !same(parsedChanges.data, source.changes) ||
        parsedChanges.data.some((change) =>
          /^\/(?:database|schemaVersion)(?:\/|$)/.test(change.path),
        )
      )
        throw new ConflictException({ code: 'history.source-invalid' });
      const originalChanges: DocumentChange[] = parsedChanges.data.map((change) => ({
        path: change.path,
        before: change.before,
        after: change.after,
        ...(change.beforeExists !== undefined ? { beforeExists: change.beforeExists } : {}),
        ...(change.afterExists !== undefined ? { afterExists: change.afterExists } : {}),
      }));
      const after = nativeDocument(source.result.document);
      const [sourceAck] = await tx
        .select()
        .from(syncClientBaselines)
        .where(
          and(
            eq(syncClientBaselines.projectId, projectId),
            eq(syncClientBaselines.baselineId, sourceResult.nextBaseline.baselineId),
            eq(syncClientBaselines.userId, source.actorId),
            eq(syncClientBaselines.clientId, source.clientId),
          ),
        );
      // Bind the accepted ledger document to its independently stored server-issued ACK.
      // If retention removed this proof, refuse a new restoration rather than invent authority.
      if (
        !sourceAck ||
        sourceAck.lastSequence !== source.sequence ||
        sourceAck.databaseRevision !== sourceResult.databaseRevision ||
        sourceAck.lastSuccessfulSyncAt.getTime() !==
          new Date(sourceResult.nextBaseline.baselineIssuedAt).getTime() ||
        !same(sourceAck.document, sharedDocument(after))
      )
        throw new ConflictException({ code: 'history.source-provenance-invalid' });
      let before: NativeDesignDocument;
      try {
        before = nativeDocument(applyChanges(after, inverseChanges(originalChanges)));
        if (
          !same(applyChanges(before, originalChanges), after) ||
          !same(deriveOperationChanges(before, after), originalChanges)
        )
          throw new Error('history.source-invalid');
      } catch {
        throw new ConflictException({ code: 'history.source-invalid' });
      }
      const versionRows = await tx
        .select()
        .from(syncFieldVersions)
        .where(eq(syncFieldVersions.projectId, projectId));
      const versions = new Map(versionRows.map((row) => [row.path, row.sequence]));
      const snapshots = deletionSnapshots(originalChanges);
      if (command === 'restore' && !snapshots.length)
        throw new ConflictException({ code: 'history.not-a-deletion' });
      const deletedPaths = new Set(snapshots.map((snapshot) => snapshot.path));
      const restoresDeletedPath = (change: DocumentChange) =>
        deletedPaths.has(change.path) || deletedPaths.has(change.path.replace('/@move/', '/'));
      // Restore recreates deleted objects/positions; undo compensates the entire accepted bundle.
      // Unrelated scalar edits or additions in the deletion operation survive a plain restore.
      const inverse = inverseChanges(originalChanges).filter(
        (change) => command === 'undo' || restoresDeletedPath(change),
      );
      const guardedChanges = originalChanges.filter(
        (change) => command === 'undo' || restoresDeletedPath(change),
      );
      const dependencies = [
        ...new Set([
          ...deriveStructuralDependencyPaths(before, guardedChanges),
          ...deriveStructuralDependencyPaths(after, guardedChanges),
          ...deriveStructuralDependencyPaths(current, inverse),
          ...layoutDependencies(before, guardedChanges),
          ...layoutDependencies(current, inverse),
        ]),
      ];
      const conflicts = findInverseConflicts(inverse, source.sequence, versions, dependencies);
      if (conflicts.length)
        throw new ConflictException({
          code: 'history.field-conflict',
          conflictingPaths: conflicts,
        });

      const storedSnapshot = source.deletionSnapshot as { items?: unknown } | null;
      if (snapshots.length && !same(storedSnapshot?.items, snapshots))
        throw new ConflictException({ code: 'history.deletion-provenance-invalid' });
      for (const snapshot of snapshots) {
        const objectId = snapshot.path
          .split('/')
          .at(-1)!
          .replaceAll('~1', '/')
          .replaceAll('~0', '~');
        const [tombstone] = await tx
          .select()
          .from(syncTombstones)
          .where(
            and(eq(syncTombstones.projectId, projectId), eq(syncTombstones.objectId, objectId)),
          );
        if (
          !tombstone ||
          tombstone.operationId !== sourceOperationId ||
          tombstone.sequence !== source.sequence ||
          tombstone.expiresAt <= now ||
          !same(tombstone.snapshot, snapshot) ||
          versions.get(snapshot.path) !== source.sequence ||
          snapshotAt(current, snapshot.path) !== undefined
        )
          throw new ConflictException({ code: 'history.deletion-provenance-invalid' });
      }
      let historicalPrevious: NativeDesignDocument | undefined;
      const restoredObjectIds = new Set<string>();
      const provenRoutePaths = new Set<string>();
      let candidate: NativeDesignDocument,
        trustedPrevious = structuredClone(current);
      let identityMap: NativeHistoryCommandResult['identityMap'] = [];
      try {
        candidate = applyChanges(current, inverse);
        if (snapshots.length) {
          const fresh = freshMapping([before, candidate], snapshots);
          identityMap = fresh.identityMap;
          candidate = remapNativeDocumentIds(candidate, fresh.mapping);
          const trustedBefore = remapNativeDocumentIds(before, fresh.mapping);
          historicalPrevious = trustedBefore;
          const creations = deriveOperationChanges(current, candidate).filter(isCreation);
          // Only exact restored entities from the server's proven deletion snapshots become previous.
          // Existing scalar/type changes retain locked current as their only recovery authority.
          const authorizedPaths = new Set(
            snapshots.map((snapshot) => {
              const old = snapshot.snapshot as { id?: string };
              if (old.id) {
                const map = snapshot.path.startsWith('/layout/nodes/')
                  ? fresh.mapping.nodes
                  : fresh.mapping.entities;
                return (
                  snapshot.path.slice(0, snapshot.path.lastIndexOf('/') + 1) +
                  segment(map.get(old.id)!)
                );
              }
              const route = snapshot.snapshot as { viewId: string; relationId: string };
              const viewId = fresh.mapping.entities.get(route.viewId) ?? route.viewId;
              const relationId = fresh.mapping.entities.get(route.relationId) ?? route.relationId;
              const remappedPath = '/layout/relations/' + segment(`${viewId}:${relationId}`);
              // Routes have a virtual (view, relation) key rather than a reusable object ID.
              // Only the exact absent pair just proven by its latest tombstone may return.
              if (remappedPath === snapshot.path) provenRoutePaths.add(remappedPath);
              return remappedPath;
            }),
          );
          for (const creation of creations) {
            if (
              !authorizedPaths.has(creation.path) ||
              !same(creation.after, snapshotAt(trustedBefore, creation.path))
            )
              throw new Error('history.deletion-provenance-invalid');
            const value = creation.after as { id?: string };
            if (value.id && !creation.path.startsWith('/layout/')) restoredObjectIds.add(value.id);
          }
          trustedPrevious = applyChanges(
            current,
            creations.map((creation) => ({
              ...creation,
              after: structuredClone(snapshotAt(trustedBefore, creation.path)),
            })),
          );
          if (command === 'undo') {
            const deletedColumns = new Set(
              snapshots
                .filter((snapshot) => snapshot.path.startsWith('/columns/'))
                .map((snapshot) => (snapshot.snapshot as { id: string }).id),
            );
            // The deletion planner retains a both-scope FK as a logical relation after its
            // referenced column disappears. Undo may reinstate precisely that stored cleanup,
            // not unrelated legacy/type corrections or an arbitrary client's before value.
            for (const relation of before.tableRelations ?? []) {
              const cleaned = after.tableRelations?.find((item) => item.id === relation.id);
              if (
                relation.scope !== 'both' ||
                !relation.physical ||
                cleaned?.scope !== 'logical' ||
                cleaned.physical !== null ||
                ![...relation.physical.sourceColumnIds, ...relation.physical.targetColumnIds].some(
                  (id) => deletedColumns.has(id),
                )
              )
                continue;
              const prefix = `/tableRelations/${segment(relation.id)}`;
              if (
                !['physical', 'scope'].every((field) =>
                  originalChanges.some((change) => change.path === `${prefix}/${field}`),
                )
              )
                continue;
              const proven = trustedBefore.tableRelations!.find((item) => item.id === relation.id)!;
              const retained = current.tableRelations!.find((item) => item.id === relation.id)!;
              trustedPrevious = applyChanges(trustedPrevious, [
                {
                  path: `${prefix}/physical`,
                  before: retained.physical,
                  after: structuredClone(proven.physical),
                },
                { path: `${prefix}/scope`, before: retained.scope, after: proven.scope },
              ]);
              restoredObjectIds.add(relation.id);
            }
          }
        }
        candidate = nativeDocument(candidate);
      } catch (error) {
        if (error instanceof ConflictException) throw error;
        throw new ConflictException({ code: 'history.restore-invalid' });
      }
      const graph = nativeReferenceProblems(candidate);
      if (graph.length)
        throw new UnprocessableEntityException({
          code: 'history.graph-invalid',
          issues: graph.map(({ cause: _cause, ...issue }) => ({
            ...issue,
            category: 'invalid',
            severity: 'error',
            params: {},
          })),
        });
      const issues = validateDatabaseDocument(candidate, database, {
        mode: 'write',
        previous: trustedPrevious,
      });
      // A restored entity must also match the historical cause, not an error newly caused
      // by today's document (e.g. a collaborator created a table with the old SQL name).
      if (historicalPrevious)
        issues.push(
          ...validateDatabaseDocument(candidate, database, {
            mode: 'write',
            previous: historicalPrevious,
          }).filter((issue) => issue.objectId !== null && restoredObjectIds.has(issue.objectId)),
        );
      if (issues.some((issue) => issue.severity === 'error'))
        throw new UnprocessableEntityException({ code: 'database.validation-failed', issues });
      const changes = deriveOperationChanges(current, candidate);
      if (!changes.length || changes.length > 1000)
        throw new ConflictException({ code: 'history.change-limit' });
      if (
        changes.some(
          (change) =>
            isCreation(change) && versions.has(change.path) && !provenRoutePaths.has(change.path),
        )
      )
        throw new ConflictException({ code: 'history.identity-collision' });
      const sequence = project.syncSequence + 1,
        nextBaselineId = randomUUID();
      const result = nativeSyncOperationResultSchema.parse({
        protocolVersion: 2,
        operationId: request.operationId,
        groupId: request.groupId,
        sequence,
        status: 'accepted',
        reasonCode: `history.${command}`,
        database: request.database,
        databaseRevision: database.revision,
        actor: { id: user.id, username: user.username, color: user.color },
        changedPaths: changes.map((change) => change.path),
        createdAt: now.toISOString(),
        document: candidate,
        nextBaseline: {
          baselineId: nextBaselineId,
          baseSequence: sequence,
          baselineIssuedAt: now.toISOString(),
          databaseRevision: database.revision,
        },
      });
      const output = nativeHistoryCommandResultSchema.parse({
        result,
        command,
        sourceOperationId,
        identityMap,
      });
      const deleted = deletionSnapshots(changes);
      await tx
        .update(projects)
        .set({
          document: sql`${JSON.stringify(candidate)}::jsonb`,
          version: sql`${projects.version} + 1`,
          syncSequence: sequence,
          updatedAt: now,
        })
        .where(eq(projects.id, projectId));
      await tx.insert(syncOperations).values({
        projectId,
        operationId: request.operationId,
        groupId: request.groupId,
        clientId: request.clientId,
        actorId: user.id,
        sequence,
        baseSequence: project.syncSequence,
        baselineId: request.baselineId,
        baselineIssuedAt: new Date(request.baselineIssuedAt),
        kind: 'online',
        fingerprint,
        changes,
        result: result as unknown as Record<string, unknown>,
        deletionSnapshot: {
          ...(deleted.length ? { items: deleted } : {}),
          nativeHistory: { command, sourceOperationId, identityMap },
        },
        createdAt: now,
      });
      for (const change of changes)
        await tx
          .insert(syncFieldVersions)
          .values({
            projectId,
            path: change.path,
            sequence,
            operationId: request.operationId,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [syncFieldVersions.projectId, syncFieldVersions.path],
            set: { sequence, operationId: request.operationId, updatedAt: now },
          });
      for (const snapshot of deleted) {
        const objectId = snapshot.path
          .split('/')
          .at(-1)!
          .replaceAll('~1', '/')
          .replaceAll('~0', '~');
        const expiresAt = new Date(now.getTime() + RETENTION_MS);
        await tx
          .insert(syncTombstones)
          .values({
            projectId,
            objectId,
            operationId: request.operationId,
            sequence,
            snapshot: snapshot as Record<string, unknown>,
            createdAt: now,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [syncTombstones.projectId, syncTombstones.objectId],
            set: {
              operationId: request.operationId,
              sequence,
              snapshot: snapshot as Record<string, unknown>,
              createdAt: now,
              expiresAt,
            },
          });
      }
      await tx.insert(syncClientBaselines).values({
        projectId,
        clientId: request.clientId,
        userId: user.id,
        baselineId: nextBaselineId,
        lastSequence: sequence,
        databaseRevision: database.revision,
        lastSuccessfulSyncAt: now,
        document: sql`${JSON.stringify(sharedDocument(candidate))}::jsonb`,
      });
      return { output, event: nativeSyncEventSchema.parse({ ...result, changes }) };
    });
    if (outcome.event) this.gateway.publish(projectId, outcome.event);
    return outcome.output;
  }
}

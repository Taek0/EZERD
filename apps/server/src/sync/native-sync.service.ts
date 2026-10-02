import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  nativeStoredDesignDocumentSchema,
  nativeSyncOperationInputSchema,
  nativeSyncOperationResultSchema,
  nativeSyncSnapshotSchema,
  nativeSyncEventSchema,
  type NativeSyncOperationInput,
  type NativeSyncOperationResult,
  type NativeSyncSnapshot,
} from '@ezerd/contracts';
import {
  deletionSnapshots,
  requestFingerprint,
  resolveProjectDatabaseState,
  sharedDocument,
} from '@ezerd/model';
import { DatabaseService } from '../db/database.service.js';
import {
  projects,
  syncClientBaselines,
  syncFieldVersions,
  syncOperations,
  syncTombstones,
  type ProjectRow,
} from '../db/schema.js';
import type { AuthenticatedUser } from '../identity/session.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';
import { prepareNativeSyncCandidate } from '../shared/native-sync-candidate.js';
import { SyncGateway } from './sync.gateway.js';
import { readNativeCancellation } from './native-cancellation-record.js';

function nativeDocument(value: unknown) {
  const parsed = nativeStoredDesignDocumentSchema.safeParse(value);
  if (!parsed.success) throw new ConflictException({ code: 'document.native-upgrade-required' });
  // Issuing a baseline is not a format migration or a license to rewrite a raw stored payload.
  if (requestFingerprint(parsed.data) !== requestFingerprint(value))
    throw new ConflictException({ code: 'document.native-normalization-required' });
  return parsed.data;
}
const resultFrom = (value: unknown) => {
  const result = nativeSyncOperationResultSchema.safeParse(value);
  if (!result.success) throw new ConflictException({ code: 'sync.protocol-mismatch' });
  // An ACK is historical evidence: validation must not trim or rewrite the stored payload.
  return structuredClone(value) as NativeSyncOperationResult;
};
type NativeTransaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type ExpectedNativeHead = { version: number; sequence: number; databaseRevision: number };
type NativeCommandPreparation = (
  issueBaseline: (clientId: string, expected?: ExpectedNativeHead) => Promise<NativeSyncSnapshot>,
) => Promise<unknown>;

@Injectable()
export class NativeSyncService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(SyncGateway) private readonly gateway: SyncGateway,
  ) {}
  async findReplay(
    projectId: string,
    operationId: string,
    fingerprint: string,
    user: AuthenticatedUser,
  ) {
    return this.access.runProject(user.id, projectId, 'read', async (tx) => {
      const [row] = await tx
        .select()
        .from(syncOperations)
        .where(
          and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, operationId)),
        );
      if (!row)
        return (
          await readNativeCancellation(tx, projectId, operationId, {
            actorId: user.id,
            fingerprint,
          })
        )?.result;
      if (row.actorId !== user.id || row.fingerprint !== fingerprint)
        throw new ConflictException({ code: 'sync.replay-mismatch' });
      return resultFrom(row.result);
    });
  }
  async baseline(
    projectId: string,
    clientId: string,
    user: AuthenticatedUser,
    expected?: ExpectedNativeHead,
  ) {
    return this.database.db.transaction(async (tx) => {
      await this.access.requireProject(user.id, projectId, 'design', tx);
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('share');
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      return this.issueBaseline(tx, project, clientId, user, expected);
    });
  }
  private async issueBaseline(
    tx: NativeTransaction,
    project: ProjectRow,
    clientId: string,
    user: AuthenticatedUser,
    expected?: ExpectedNativeHead,
  ): Promise<NativeSyncSnapshot> {
    const database = resolveProjectDatabaseState(project);
    if (project.status !== 'active') throw new ConflictException({ code: 'project.archived' });
    if (
      expected &&
      (expected.version !== project.version ||
        expected.sequence !== project.syncSequence ||
        expected.databaseRevision !== database.revision)
    )
      throw new ConflictException({ code: 'database.context-changed' });
    const document = sharedDocument(nativeDocument(project.document));
    if (
      document.database.kind !== database.kind ||
      document.database.profileId !== database.profileId
    )
      throw new ConflictException({ code: 'database.context-changed' });
    const now = new Date(),
      baselineId = randomUUID();
    await tx.insert(syncClientBaselines).values({
      projectId: project.id,
      clientId,
      userId: user.id,
      baselineId,
      lastSequence: project.syncSequence,
      databaseRevision: database.revision,
      lastSuccessfulSyncAt: now,
      document: sql`${JSON.stringify(document)}::jsonb`,
    });
    return nativeSyncSnapshotSchema.parse({
      protocolVersion: 2,
      projectVersion: project.version,
      sequence: project.syncSequence,
      baselineId,
      baselineIssuedAt: now.toISOString(),
      database: { kind: database.kind, profileId: database.profileId },
      databaseRevision: database.revision,
      document,
    });
  }
  async apply(
    projectId: string,
    raw: unknown,
    user: AuthenticatedUser,
    requestHash?: string,
    prepareCommand?: NativeCommandPreparation,
  ): Promise<NativeSyncOperationResult> {
    const identity = nativeSyncOperationInputSchema.shape.operationId.safeParse(
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).operationId
        : undefined,
    );
    if (!identity.success) throw new BadRequestException({ code: 'sync.input-invalid' });
    const fingerprint =
      requestHash ?? createHash('sha256').update(requestFingerprint(raw)).digest('hex');
    const outcome = await this.database.db.transaction(async (tx) => {
      // Retained read access permits an immutable replay even after downgrade/archive.
      // Keep the transaction writable for row locking and permission checks on fresh writes.
      await this.access.requireProject(user.id, projectId, 'read', tx);
      const replay = async () => {
        const [row] = await tx
          .select()
          .from(syncOperations)
          .where(
            and(
              eq(syncOperations.projectId, projectId),
              eq(syncOperations.operationId, identity.data),
            ),
          );
        if (!row)
          return (
            await readNativeCancellation(
              tx,
              projectId,
              identity.data,
              { actorId: user.id, fingerprint },
              [requestHash ? 'native-command' : 'protocol-operation'],
            )
          )?.result;
        if (row.actorId !== user.id || row.fingerprint !== fingerprint)
          throw new ConflictException({ code: 'sync.replay-mismatch' });
        return resultFrom(row.result);
      };
      const old = await replay();
      if (old) return { result: old };
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update');
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const lockedReplay = await replay();
      if (lockedReplay) return { result: lockedReplay };
      await this.access.requireProject(user.id, projectId, 'design', tx);
      // MCP validation/candidate preparation and baseline issuance share this locked context.
      // No command validation or new baseline occurs before both replay checks.
      const operation = prepareCommand
        ? await prepareCommand((clientId, expected) =>
            this.issueBaseline(tx, project, clientId, user, expected),
          )
        : raw;
      const parsed = nativeSyncOperationInputSchema.safeParse(operation);
      if (!parsed.success) throw new BadRequestException({ code: 'sync.input-invalid' });
      const input: NativeSyncOperationInput = parsed.data;
      if (input.operationId !== identity.data)
        throw new BadRequestException({ code: 'sync.input-invalid' });
      const database = resolveProjectDatabaseState(project);
      // The project/current raw payload remains the authority for previous errors and legacy origins.
      const [baseline] = await tx
        .select()
        .from(syncClientBaselines)
        .where(
          and(
            eq(syncClientBaselines.projectId, projectId),
            eq(syncClientBaselines.baselineId, input.baselineId),
            eq(syncClientBaselines.userId, user.id),
            eq(syncClientBaselines.clientId, input.clientId),
          ),
        );
      const versionRows = await tx
        .select()
        .from(syncFieldVersions)
        .where(eq(syncFieldVersions.projectId, projectId));
      const prepared = prepareNativeSyncCandidate(
        operation,
        {
          id: project.id,
          status: project.status,
          syncSequence: project.syncSequence,
          database,
          document: project.document,
        },
        baseline,
        user.id,
        new Map(versionRows.map((row) => [row.path, row.sequence])),
      );
      if (project.syncSequence >= 2147483647)
        throw new ConflictException({ code: 'sync.sequence-limit' });
      const accepted = prepared.status === 'prepared';
      const changes = accepted ? prepared.changes : [];
      const sequence = project.syncSequence + 1,
        now = new Date();
      const nextBaselineId = accepted ? randomUUID() : input.baselineId;
      const result = nativeSyncOperationResultSchema.parse({
        protocolVersion: 2,
        database: { kind: database.kind, profileId: database.profileId },
        databaseRevision: database.revision,
        operationId: input.operationId,
        groupId: input.groupId,
        sequence,
        status: accepted ? 'accepted' : 'rejected',
        ...(!accepted
          ? {
              reasonCode: prepared.code,
              reason: prepared.code,
              ...(prepared.issues ? { issues: prepared.issues.slice(0, 1000) } : {}),
            }
          : { document: prepared.document }),
        actor: { id: user.id, username: user.username, color: user.color },
        changedPaths: changes.map((change) => change.path),
        createdAt: now.toISOString(),
        nextBaseline: {
          baselineId: nextBaselineId,
          baseSequence: accepted ? sequence : input.baseSequence,
          baselineIssuedAt: accepted ? now.toISOString() : input.baselineIssuedAt,
          databaseRevision: accepted ? database.revision : input.databaseRevision,
        },
      });
      await tx
        .update(projects)
        .set({
          syncSequence: sequence,
          updatedAt: now,
          ...(accepted
            ? {
                version: sql`${projects.version} + 1`,
                document: sql`${JSON.stringify(prepared.document)}::jsonb`,
              }
            : {}),
        })
        .where(eq(projects.id, projectId));
      const snapshots = deletionSnapshots(changes);
      await tx.insert(syncOperations).values({
        projectId,
        operationId: input.operationId,
        groupId: input.groupId,
        clientId: input.clientId,
        actorId: user.id,
        sequence,
        baseSequence: input.baseSequence,
        baselineIssuedAt: new Date(input.baselineIssuedAt),
        baselineId: input.baselineId,
        kind: input.kind,
        fingerprint,
        changes,
        result: result as unknown as Record<string, unknown>,
        deletionSnapshot: snapshots.length ? { items: snapshots } : null,
        createdAt: now,
      });
      if (accepted) {
        for (const change of changes)
          await tx
            .insert(syncFieldVersions)
            .values({
              projectId,
              path: change.path,
              sequence,
              operationId: input.operationId,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [syncFieldVersions.projectId, syncFieldVersions.path],
              set: { sequence, operationId: input.operationId, updatedAt: now },
            });
        for (const snapshot of snapshots) {
          const objectId = snapshot.path
            .split('/')
            .at(-1)!
            .replaceAll('~1', '/')
            .replaceAll('~0', '~');
          const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          await tx
            .insert(syncTombstones)
            .values({
              projectId,
              objectId,
              operationId: input.operationId,
              sequence,
              snapshot: snapshot as Record<string, unknown>,
              createdAt: now,
              expiresAt,
            })
            .onConflictDoUpdate({
              target: [syncTombstones.projectId, syncTombstones.objectId],
              set: {
                operationId: input.operationId,
                sequence,
                snapshot: snapshot as Record<string, unknown>,
                createdAt: now,
                expiresAt,
              },
            });
        }
        await tx.insert(syncClientBaselines).values({
          projectId,
          clientId: input.clientId,
          userId: user.id,
          baselineId: nextBaselineId,
          lastSequence: sequence,
          databaseRevision: database.revision,
          lastSuccessfulSyncAt: now,
          document: sql`${JSON.stringify(sharedDocument(prepared.document))}::jsonb`,
        });
      }
      return { result, event: nativeSyncEventSchema.parse({ ...result, changes }) };
    });
    if (outcome.event) this.gateway.publish(projectId, outcome.event);
    return outcome.result;
  }
  async lookup(projectId: string, operationId: string, user: AuthenticatedUser) {
    return this.access.runProject(user.id, projectId, 'read', async (tx) => {
      const [row] = await tx
        .select()
        .from(syncOperations)
        .where(
          and(eq(syncOperations.projectId, projectId), eq(syncOperations.operationId, operationId)),
        );
      if (!row) {
        const marker = await readNativeCancellation(tx, projectId, operationId);
        if (marker) return marker.result;
        throw new NotFoundException('작업 결과를 찾을 수 없습니다.');
      }
      return resultFrom(row.result);
    });
  }
  async events(projectId: string, since: number, user: AuthenticatedUser) {
    return this.database.db.transaction(
      async (tx) => {
        await this.access.requireProject(user.id, projectId, 'read', tx);
        const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
        if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        const database = resolveProjectDatabaseState(project);
        const document = sharedDocument(nativeDocument(project.document));
        if (
          document.database.kind !== database.kind ||
          document.database.profileId !== database.profileId
        )
          throw new ConflictException({ code: 'database.context-changed' });
        const rows = await tx
          .select()
          .from(syncOperations)
          .where(and(eq(syncOperations.projectId, projectId), gt(syncOperations.sequence, since)))
          .orderBy(asc(syncOperations.sequence));
        const parsed = rows.map((row) =>
          nativeSyncEventSchema.safeParse({ ...row.result, changes: row.changes }),
        );
        const resetRequired =
          since > project.syncSequence ||
          (project.syncSequence > since && (!rows.length || rows[0]!.sequence !== since + 1)) ||
          parsed.some(
            (event) =>
              !event.success ||
              event.data.databaseRevision !== database.revision ||
              event.data.reasonCode === 'document.upgraded',
          );
        return {
          protocolVersion: 2,
          sequence: project.syncSequence,
          databaseRevision: database.revision,
          database: { kind: database.kind, profileId: database.profileId },
          resetRequired,
          events: resetRequired
            ? []
            : parsed.flatMap((event) => (event.success ? [event.data] : [])),
          ...(resetRequired ? { document } : {}),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}

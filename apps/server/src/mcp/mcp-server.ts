import { HttpException, Inject, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createMessageSchema,
  createWorkspaceSchema,
  createWorkspaceInvitationSchema,
  createProjectSchema,
  createThreadSchema,
  deleteProjectSchema,
  deleteThreadSchema,
  notificationSchema,
  projectTransferSchema,
  personalStateSnapshotSchema,
  projectQuerySchema,
  projectSchema,
  threadSchema,
  updateProjectSchema,
  updateNotificationSchema,
  updateThreadSchema,
  updateWorkspaceSchema,
  updateWorkspaceMemberSchema,
  workspaceSchema,
  workspaceMemberSchema,
  workspaceInvitationSchema,
  projectDatabaseCapabilitiesSchema,
  projectDocumentStateSchema,
  databaseIssueSchema,
  nativeSyncOperationResultSchema,
  upgradeProjectDocumentSchema,
  projectDDLExportSchema,
  nativeHistoryCommandSchema,
  nativeHistoryCommandResultSchema,
  nativeHistoryQuerySchema,
  nativeHistoryPageSchema,
  nativeSyncSnapshotSchema,
  nativeCancellationInputSchema,
  nativeCancellationResultSchema,
} from '@ezerd/contracts';

import type { AuthenticatedUser } from '../identity/session.js';
import { ReviewService } from '../review/review.service.js';
import { WorkspaceService } from '../workspace/workspace.service.js';
import { SpaceService } from '../workspace/space.service.js';
import { McpLogger } from './logging.js';
import { McpAuthService } from './mcp-auth.service.js';
import { NativeUpgradeService } from '../workspace/native-upgrade.service.js';
import { NativeDDLService } from '../workspace/native-ddl.service.js';
import { NativeHistoryService } from '../sync/native-history.service.js';
import { NativeSyncService } from '../sync/native-sync.service.js';
import { NativeCancellationService } from '../sync/native-cancellation.service.js';
import { applyPersonalChangesSchema, McpPersonalService } from './mcp-personal.service.js';
import {
  applyNativeProjectChangesMetadataSchema,
  McpNativeDocumentService,
} from './mcp-native-document.service.js';

const idSchema = z.uuid();
const TIMEOUT_MS = 60_000;
/** Historical ACKs are validated without rewriting their stored actor/document strings. */
function nativeOperationResult(raw: unknown) {
  nativeSyncOperationResultSchema.parse(raw);
  return structuredClone(raw) as z.infer<typeof nativeSyncOperationResultSchema>;
}
function nativeHistoryResult(raw: unknown) {
  nativeHistoryCommandResultSchema.parse(raw);
  return structuredClone(raw) as z.infer<typeof nativeHistoryCommandResultSchema>;
}
// SDK JSON Schema metadata cannot express custom raw/AST validation; the handler parses the full contract.
const documentBodySchema = z
  .object({ schemaVersion: z.union([z.literal(1), z.literal(2)]) })
  .passthrough();
const versionedProjectOutputSchema = z.strictObject({
  protocolVersion: z.literal(2),
  project: projectDocumentStateSchema.shape.project,
  sequence: projectDocumentStateSchema.shape.sequence,
  sourceDocument: documentBodySchema,
  native: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('available'),
      document: z.object({ schemaVersion: z.literal(2) }).passthrough(),
      migrationIssues: z.array(
        z.strictObject({ code: z.string(), objectId: z.string(), path: z.string() }),
      ),
      issues: z.array(databaseIssueSchema),
    }),
    z.strictObject({
      status: z.literal('unavailable'),
      code: z.enum(['database.context-changed', 'document.native-preview-invalid']),
    }),
  ]),
});
const pageLimit = z.number().int().min(1).max(100).default(50);
const listProjectsInputSchema = projectQuerySchema.extend({
  limit: pageLimit,
  cursor: z.string().min(1).max(500).optional(),
});
const listReviewThreadsInputSchema = z.strictObject({
  projectId: idSchema,
  limit: pageLimit,
  cursor: z.string().min(1).max(500).optional(),
});

@Injectable()
export class McpServerFactory {
  constructor(
    @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
    @Inject(ReviewService) private readonly reviews: ReviewService,
    @Inject(McpLogger) private readonly logger: McpLogger,
    @Inject(McpPersonalService) private readonly personal: McpPersonalService,
    @Inject(McpNativeDocumentService) private readonly nativeDocuments: McpNativeDocumentService,
    @Inject(SpaceService) private readonly spaces: SpaceService,
    @Inject(McpAuthService) private readonly auth: McpAuthService,
    @Inject(NativeUpgradeService) private readonly nativeUpgrade: NativeUpgradeService,
    @Inject(NativeDDLService) private readonly nativeDDL: NativeDDLService,
    @Inject(NativeHistoryService) private readonly nativeHistory: NativeHistoryService,
    @Inject(NativeSyncService) private readonly nativeSync: NativeSyncService,
    @Inject(NativeCancellationService)
    private readonly nativeCancellation: NativeCancellationService,
  ) {}

  create(user: AuthenticatedUser, tokenId: string, requestId: string): McpServer {
    const server = new McpServer(
      { name: 'ezerd', version: '0.1.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'get_project_database_capabilities로 DB/profile/revision과 usable 기능을 확인하고 get_project_document_state로 원본을 조회하세요. 원본 schemaVersion 2만 apply_native_project_changes로 편집합니다. v1 전용 조회·편집·이력 도구는 종료되었습니다. v1 원본 조회와 파일 가져오기·내보내기·upgrade는 호환 목적으로 유지합니다. get_personal_state/apply_personal_changes는 자신의 개인 캔버스만 다룹니다. ' +
          'EZERD 공간, 프로젝트와 리뷰를 조회하고 변경합니다. whoami로 현재 사용자를 확인하고 list_workspaces로 접근 가능한 공간과 역할을 확인하세요. 프로젝트 생성과 가져오기에는 workspaceId가 필요합니다. viewer는 설계 변경을 할 수 없으며' +
          ' active 공간에서 개인 상태와 리뷰는 사용할 수 있습니다. 보관된 공간에서는 쓰기가 제한됩니다. 쓰기 도구에는 최신 동시성 기준을 사용하세요. ' +
          '배치 전후 get_project_document_state의 sourceDocument.layout에서 공유 노드와 관계 좌표를 확인하세요. 개인 캔버스는 get_personal_state로 조회하고 apply_personal_changes로 변경하세요. ' +
          '배치 검증에는 브라우저 스킬이나 스크린샷 대신 문서의 x·y·width·height 좌표값 계산을 우선 사용하세요. ' +
          '같은 viewId의 각 카드 쌍에서 가로 또는 세로 경계가 40px 이상 떨어져 있는지 계산하고, 어느 축으로도 분리되지 않으면 겹침 또는 간격 부족으로 판단하세요. ' +
          '같은 뷰의 카드 경계와 콘텐츠에 필요한 크기를 고려해 서로 겹치지 않게 배치하고 최소 40px 간격을 두세요. ' +
          '테이블 카드는 이름·타입·컬럼 내용이 잘리지 않는 범위에서 불필요한 폭·높이·빈 공간을 줄여 콘텐츠에 맞는 크기로 지정하세요. ' +
          '핵심/상위 테이블과 종속/하위 테이블의 구조적 계층이 읽히도록 단계별로 정렬하고, 같은 계층의 카드 크기와 간격을 일관되게 맞추세요. ' +
          '객체 관계를 쉽게 읽을 수 있도록 연결된 객체는 가까이, 같은 도메인/업무 묶음은 같은 구역에 배치하세요. ' +
          '도메인의 흐름 방향과 테이블 PK→FK 방향이 왼쪽에서 오른쪽 또는 위에서 아래로 일관되게 보이도록 계층을 구성하세요. ' +
          '순환 관계는 무리한 일렬 배치 대신 관련 객체를 묶고, 관계선 교차·카드 관통·불필요하게 긴 연결을 최소화하세요. ' +
          '컬럼/설명 추가로 카드 크기가 커지는 경우에도 인접 카드와의 겹침을 다시 확인하세요. ' +
          '기존 사용자의 배치를 불필요하게 바꾸지 말고 빈 공간을 우선 사용하며, 자동 배치는 요청받은 범위에만 적용하세요. ' +
          '작업 후 get_project_document_state로 결과를 재조회해 같은 좌표 계산으로 겹침을 확인하고 수정하세요. 좌표를 생략해 모든 객체를 같은 위치에 생성하지 마세요.',
      },
    );
    const invoke = <T>(tool: string, callback: () => Promise<T>) =>
      this.invoke(tool, user, tokenId, requestId, callback);
    this.registerWorkspaceTools(server, user, invoke);

    server.registerTool(
      'list_projects',
      {
        description: '상태와 이름 검색어로 EZERD 프로젝트를 최대 100개씩 조회합니다.',
        inputSchema: listProjectsInputSchema,
        outputSchema: z.strictObject({
          projects: z.array(projectSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      (input) =>
        invoke('list_projects', async () => {
          const page = await this.workspace.listProjectsPage(user.id, input);
          return {
            projects: z.array(projectSchema).parse(page.projects),
            nextCursor: page.nextCursor,
          };
        }),
    );
    server.registerTool(
      'get_project_document_state',
      {
        description:
          '같은 저장 snapshot의 프로젝트 DB/profile/revision·version·sequence, 원본 sourceDocument와 별도 native preview/진단을 읽습니다. preview available은 편집·DDL 기능이 usable이라는 뜻이 아닙니다. 공유 문서 조회이며 개인 상태를 합치거나 baseline을 발급하지 않습니다. 전체 문서가 필요한 경우 사용하세요.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: versionedProjectOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('get_project_document_state', async () =>
          projectDocumentStateSchema.parse(
            await this.workspace.getVersionedProjectState(user.id, projectId),
          ),
        ),
    );
    server.registerTool(
      'export_project_ddl',
      {
        description:
          '같은 서버 snapshot의 DB/profile/revision과 version/sequence를 기준으로 프로젝트 전체 물리 설계를 SQL로 내보냅니다. 화면·도메인·선택 상태를 필터로 사용하지 않습니다. canExport=false이면 SQL은 비어 있고 objectId/path 진단을 확인해야 합니다. native 타입/기능은 readiness 검사까지 통과해야 하며 v1 MySQL/SQLite의 PG 타입은 재해석하지 않습니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: projectDDLExportSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('export_project_ddl', async () =>
          projectDDLExportSchema.parse(await this.nativeDDL.exportProject(user.id, projectId)),
        ),
    );
    server.registerTool(
      'get_project_database_capabilities',
      {
        description:
          '프로젝트의 DB 종류·프로필·변경 번호와 native v2 타입/옵션·기능을 조회합니다. supportedByEngine은 엔진 규칙이며 usable만 실제 사용 가능한 기능입니다. native 저장/preview는 get_project_document_state로 읽고 native 편집은 apply_native_project_changes를 사용합니다. 기능 적용 시 객체별 조건을 다시 검증해야 합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: projectDatabaseCapabilitiesSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('get_project_database_capabilities', async () =>
          projectDatabaseCapabilitiesSchema.parse(
            await this.workspace.getDatabaseCapabilities(user.id, projectId),
          ),
        ),
    );
    server.registerTool(
      'get_personal_state',
      {
        description: '인증된 사용자 자신의 결합 화면, 화면 배치·뷰포트와 개인 메모를 조회합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: personalStateSnapshotSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('get_personal_state', async () =>
          personalStateSnapshotSchema.parse(await this.personal.get(projectId, user)),
        ),
    );
    server.registerTool(
      'list_review_threads',
      {
        description:
          '프로젝트의 리뷰 핀 요약을 최대 100개씩 조회합니다. 답글은 get_review_thread로 조회합니다.',
        inputSchema: listReviewThreadsInputSchema,
        outputSchema: z.strictObject({
          threads: z.array(threadSchema.omit({ messages: true })),
          nextCursor: z.string().nullable(),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, limit, cursor }) =>
        invoke('list_review_threads', async () => {
          const page = await this.reviews.listPage(projectId, user.id, limit, cursor);
          return {
            threads: z.array(threadSchema.omit({ messages: true })).parse(page.threads),
            nextCursor: page.nextCursor,
          };
        }),
    );
    server.registerTool(
      'get_review_thread',
      {
        description: '리뷰 핀 한 개와 모든 답글을 조회합니다.',
        inputSchema: z.strictObject({ threadId: idSchema }),
        outputSchema: threadSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ threadId }) =>
        invoke('get_review_thread', async () =>
          threadSchema.parse(await this.reviews.getThread(threadId, user.id)),
        ),
    );
    server.registerTool(
      'list_notifications',
      {
        description: '인증된 사용자 자신의 알림을 최대 100개씩 조회합니다.',
        inputSchema: z.strictObject({
          limit: pageLimit,
          cursor: z.string().min(1).max(500).optional(),
          unreadOnly: z.boolean().default(false),
        }),
        outputSchema: z.strictObject({
          notifications: z.array(notificationSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ limit, cursor, unreadOnly }) =>
        invoke('list_notifications', async () => {
          const page = await this.reviews.listNotificationsPage(user.id, limit, cursor, unreadOnly);
          return {
            notifications: z.array(notificationSchema).parse(page.notifications),
            nextCursor: page.nextCursor,
          };
        }),
    );
    server.registerTool(
      'update_notification',
      {
        description: '인증된 사용자 자신의 알림 읽음 상태를 변경합니다.',
        inputSchema: z.strictObject({
          notificationId: idSchema,
          update: updateNotificationSchema,
        }),
        outputSchema: notificationSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ notificationId, update }) =>
        invoke('update_notification', async () =>
          notificationSchema.parse(
            await this.reviews.updateNotification(notificationId, update, user),
          ),
        ),
    );
    server.registerTool(
      'create_project',
      {
        description:
          '새 EZERD 프로젝트를 생성합니다. 이름 생략/공백은 워크스페이스에서 새 프로젝트 및 증가하는 숫자로 자동 지정합니다. formatVersion: 2 또는 생략은 선택 databaseKind/default profile의 빈 native 설계를 만들며 get_project_document_state 및 apply_native_project_changes로 조회/편집합니다. 새 프로젝트는 native 설계만 지원합니다. native 생성은 미검증 DB 기능의 사용 가능 상태를 켜지 않습니다.',
        inputSchema: createProjectSchema,
        outputSchema: projectSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (input) =>
        invoke('create_project', async () =>
          projectSchema.parse(await this.workspace.createProject(user.id, input)),
        ),
    );
    server.registerTool(
      'import_project',
      {
        description: '검증된 EZERD 프로젝트 전송 문서를 새 프로젝트로 가져옵니다.',
        inputSchema: z.strictObject({ workspaceId: idSchema, transfer: projectTransferSchema }),
        outputSchema: projectSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (input) =>
        invoke('import_project', async () =>
          projectSchema.parse(await this.workspace.importProject(user.id, input)),
        ),
    );
    server.registerTool(
      'export_project',
      {
        description: '프로젝트의 공유 설계 문서를 EZERD 전송 형식으로 내보냅니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: projectTransferSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('export_project', async () =>
          projectTransferSchema.parse(await this.workspace.exportProject(user.id, projectId)),
        ),
    );
    server.registerTool(
      'update_project',
      {
        description:
          '최신 expectedVersion을 기준으로 프로젝트 이름, 선택 DB 메타데이터 또는 보관 상태를 변경합니다. databaseKind 변경은 설계나 DDL 방언을 변환하지 않습니다.',
        inputSchema: z.strictObject({ projectId: idSchema, update: updateProjectSchema }),
        outputSchema: projectSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, update }) =>
        invoke('update_project', async () =>
          projectSchema.parse(await this.workspace.updateProject(user.id, projectId, update)),
        ),
    );
    server.registerTool(
      'delete_project',
      {
        description: '보관된 프로젝트의 최신 버전을 영구 삭제합니다.',
        inputSchema: z.strictObject({ projectId: idSchema, delete: deleteProjectSchema }),
        outputSchema: z.strictObject({ id: idSchema, deleted: z.literal(true) }),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ projectId, delete: input }) =>
        invoke('delete_project', () => this.workspace.deleteProject(user.id, projectId, input)),
    );
    server.registerTool(
      'create_review_thread',
      {
        description: '프로젝트 화면에 리뷰 핀과 첫 메시지를 생성합니다.',
        inputSchema: z.strictObject({ projectId: idSchema, thread: createThreadSchema }),
        outputSchema: threadSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, thread }) =>
        invoke('create_review_thread', async () =>
          threadSchema.parse(await this.reviews.create(projectId, thread, user)),
        ),
    );
    server.registerTool(
      'reply_review_thread',
      {
        description: '기존 리뷰 핀에 인증된 사용자 명의로 답글을 추가합니다.',
        inputSchema: z.strictObject({ threadId: idSchema, message: createMessageSchema }),
        outputSchema: threadSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ threadId, message }) =>
        invoke('reply_review_thread', async () =>
          threadSchema.parse(await this.reviews.reply(threadId, message, user)),
        ),
    );
    server.registerTool(
      'update_review_thread',
      {
        description: '리뷰 핀의 해결 상태를 변경합니다.',
        inputSchema: z.strictObject({ threadId: idSchema, update: updateThreadSchema }),
        outputSchema: threadSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ threadId, update }) =>
        invoke('update_review_thread', async () =>
          threadSchema.parse(await this.reviews.update(threadId, update, user)),
        ),
    );
    server.registerTool(
      'delete_review_thread',
      {
        description: '최신 expectedUpdatedAt을 기준으로 리뷰 핀과 답글을 삭제합니다.',
        inputSchema: z.strictObject({ threadId: idSchema, delete: deleteThreadSchema }),
        outputSchema: z.strictObject({ id: idSchema, deleted: z.literal(true) }),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ threadId, delete: input }) =>
        invoke('delete_review_thread', () => this.reviews.remove(threadId, input, user)),
    );
    server.registerTool(
      'upgrade_project_document',
      {
        description:
          'v1 저장 문서를 프로젝트 DB의 native 형식으로 명시 업그레이드합니다. operationId/clientId와 최신 version/sequence/databaseRevision이 필수이며 원본과 migration 진단을 이력에 보존합니다. MySQL/SQLite v1의 PG 타입과 unknown 값은 legacy로 유지합니다. 응답 뒤 get_project_document_state로 진단을 확인하고 apply_native_project_changes로 안전한 편집을 진행하세요.',
        inputSchema: upgradeProjectDocumentSchema.extend({ projectId: idSchema }),
        outputSchema: z.strictObject({
          ...nativeSyncOperationResultSchema.shape,
          document: z
            .object({ schemaVersion: z.literal(2) })
            .passthrough()
            .optional(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ projectId, ...input }) =>
        invoke('upgrade_project_document', async () =>
          nativeOperationResult(await this.nativeUpgrade.upgrade(projectId, input, user)),
        ),
    );
    server.registerTool(
      'apply_native_project_changes',
      {
        description:
          'schemaVersion 2로 저장된 프로젝트의 native 컬럼/테이블 부분 수정, 컬럼 추가, 삭제 계획 및 PK 기반 FK 생성을 수행합니다. get_project_document_state로 version/sequence/databaseRevision과 원본 형식을 먼저 확인하세요. 같은 DB 변경 번호에서는 이전 version/sequence의 명령도 현재 문서에 적용하며, 다른 속성은 병합하고 같은 속성은 서버에서 나중에 처리한 명령의 값으로 저장합니다. 입력에 명시한 속성만 수정하세요. expectedDatabaseRevision은 정확히 일치해야 하며 삭제된 대상, 유효하지 않은 구조, 신규 미검증 타입·기능과 신규 legacy는 차단됩니다. 승인/거부 ACK와 필요 시 native 문서를 반환하고 operationId로 재생합니다.',
        inputSchema: applyNativeProjectChangesMetadataSchema,
        outputSchema: z.strictObject({
          ...nativeSyncOperationResultSchema.shape,
          document: z
            .object({ schemaVersion: z.literal(2) })
            .passthrough()
            .optional(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      (input) =>
        invoke('apply_native_project_changes', async () =>
          nativeOperationResult(await this.nativeDocuments.apply(input, user)),
        ),
    );
    server.registerTool(
      'apply_personal_changes',
      {
        description:
          'native 프로젝트에서 인증된 사용자 자신의 결합 화면·참조 테이블·개인 배치·뷰포트·관계 경로·메모를 개인 버전 기준으로 변경합니다. native 신규 쓰기는 get_personal_state의 databaseRevision/projectVersion/syncSequence를 expectedDatabaseRevision/expectedProjectVersion/expectedSyncSequence로 함께 전달합니다. 기존 operation 재생은 같은 원문을 유지합니다. 공유 설계·DB 문맥·물리 타입은 변경하지 않습니다.',
        inputSchema: applyPersonalChangesSchema,
        outputSchema: personalStateSnapshotSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      (input) =>
        invoke('apply_personal_changes', async () =>
          personalStateSnapshotSchema.parse(await this.personal.apply(input, user)),
        ),
    );
    server.registerTool(
      'get_native_project_baseline',
      {
        description:
          'native 이력 보상에 사용할 현재 서버 baseline을 발급합니다. 설계 권한과 최신 version/sequence/databaseRevision이 필요합니다. clientId를 보관하고 응답의 baseline 좌표를 undo/restore 요청에 그대로 사용하세요.',
        inputSchema: z.strictObject({
          projectId: idSchema,
          clientId: idSchema,
          expected: z.strictObject({
            version: z.number().int().nonnegative().max(2147483647),
            sequence: z.number().int().nonnegative().max(2147483647),
            databaseRevision: z.number().int().nonnegative().max(2147483647),
          }),
        }),
        outputSchema: z.strictObject({
          ...nativeSyncSnapshotSchema.shape,
          document: z.object({ schemaVersion: z.literal(2) }).passthrough(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, clientId, expected }) =>
        invoke('get_native_project_baseline', async () =>
          nativeSyncSnapshotSchema.parse(
            await this.nativeSync.baseline(projectId, clientId, user, expected),
          ),
        ),
    );
    server.registerTool(
      'get_native_project_history',
      {
        description:
          'native 이력과 legacy/upgrade 경계를 sequence 순서로 조회합니다. 원본 변경·삭제 증거를 반환하며 native 보상은 자신의 accepted native 작업에 한정됩니다.',
        inputSchema: nativeHistoryQuerySchema.extend({ projectId: idSchema }),
        outputSchema: z.strictObject({
          ...nativeHistoryPageSchema.shape,
          history: z.array(z.object({ operationId: idSchema }).passthrough()).max(100),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, since, limit }) =>
        invoke('get_native_project_history', async () =>
          nativeHistoryPageSchema.parse(
            await this.nativeHistory.history(projectId, since, limit, user),
          ),
        ),
    );
    for (const command of ['undo', 'restore'] as const) {
      const name =
        command === 'undo' ? 'undo_native_project_operation' : 'restore_native_project_deletion';
      server.registerTool(
        name,
        {
          description:
            command === 'undo'
              ? '같은 actor의 accepted native 작업을 서버 이력 출처와 현재 충돌 규칙에 따라 실행 취소합니다. get_native_project_baseline의 현재 좌표가 필요하며 전송한 request를 보관해 응답 유실 시 동일 요청을 재생하세요.'
              : '같은 actor의 native 삭제 이력에서 입증된 객체를 새 ID로 복원합니다. 이전 native baseline 좌표나 클라이언트 snapshot을 신뢰하지 않습니다. 현재 baseline 좌표를 사용하고 요청 재생에는 동일 request를 사용하세요.',
          inputSchema: z.strictObject({
            projectId: idSchema,
            sourceOperationId: idSchema,
            request: nativeHistoryCommandSchema,
          }),
          outputSchema: z.strictObject({
            ...nativeHistoryCommandResultSchema.shape,
            result: z.strictObject({
              ...nativeSyncOperationResultSchema.shape,
              document: z
                .object({ schemaVersion: z.literal(2) })
                .passthrough()
                .optional(),
            }),
          }),
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        },
        ({ projectId, sourceOperationId, request }) =>
          invoke(name, async () =>
            nativeHistoryResult(
              await this.nativeHistory.compensate(
                projectId,
                sourceOperationId,
                command,
                request,
                user,
              ),
            ),
          ),
      );
    }
    server.registerTool(
      'cancel_native_project_request',
      {
        description:
          '보관한 원래 native operation/command/upgrade/history 요청을 서버에서 취소 확정합니다. 이미 처리된 같은 actor/fingerprint 요청은 원문 결과를 반환하고 미기록 요청은 취소 마커로 늦은 쓰기를 막습니다. request는 전송했던 원문 전체이며 최신 문서나 새 operationId로 바꾸지 마세요.',
        inputSchema: z.strictObject({
          projectId: idSchema,
          kind: z.enum([
            'protocol-operation',
            'native-command',
            'native-upgrade',
            'history-undo',
            'history-restore',
          ]),
          sourceOperationId: idSchema.optional(),
          request: z.unknown(),
        }),
        outputSchema: z.strictObject({
          outcome: z.enum(['recorded', 'cancelled']),
          result: z
            .object({ protocolVersion: z.union([z.literal(1), z.literal(2)]) })
            .passthrough(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ projectId, ...raw }) =>
        invoke('cancel_native_project_request', async () =>
          nativeCancellationResultSchema.parse(
            await this.nativeCancellation.cancel(
              projectId,
              nativeCancellationInputSchema.parse(raw),
              user,
            ),
          ),
        ),
    );
    return server;
  }

  private registerWorkspaceTools(
    server: McpServer,
    user: AuthenticatedUser,
    invoke: <T>(tool: string, callback: () => Promise<T>) => ReturnType<McpServerFactory['invoke']>,
  ) {
    const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    const destructive = { ...write, destructiveHint: true };
    const workspaceIdInput = z.strictObject({ workspaceId: idSchema });
    const invitationIdInput = z.strictObject({ invitationId: idSchema });
    const memberInput = workspaceIdInput.extend({ userId: idSchema });
    server.registerTool(
      'whoami',
      {
        description: '현재 MCP 토큰으로 인증된 사용자 ID, 이름과 색상을 조회합니다.',
        inputSchema: z.strictObject({}),
        outputSchema: z.strictObject({ userId: idSchema, username: z.string(), color: z.string() }),
        annotations: read,
      },
      () =>
        invoke('whoami', async () => ({
          userId: user.id,
          username: user.username,
          color: user.color,
        })),
    );
    server.registerTool(
      'create_workspace',
      {
        description: '인증된 사용자를 owner로 지정하여 새 공간을 생성합니다.',
        inputSchema: createWorkspaceSchema,
        outputSchema: workspaceSchema,
        annotations: write,
      },
      (input) =>
        invoke('create_workspace', async () =>
          workspaceSchema.parse(await this.spaces.createWorkspace(user.id, input)),
        ),
    );
    server.registerTool(
      'list_workspaces',
      {
        description: '인증된 사용자가 현재 멤버인 공간과 자신의 역할을 조회합니다.',
        inputSchema: z.strictObject({}),
        outputSchema: z.strictObject({ workspaces: z.array(workspaceSchema) }),
        annotations: read,
      },
      () =>
        invoke('list_workspaces', async () => ({
          workspaces: z.array(workspaceSchema).parse(await this.spaces.listWorkspaces(user.id)),
        })),
    );
    server.registerTool(
      'get_workspace',
      {
        description: '공간과 인증된 사용자의 현재 역할을 조회합니다.',
        inputSchema: workspaceIdInput,
        outputSchema: workspaceSchema,
        annotations: read,
      },
      ({ workspaceId }) =>
        invoke('get_workspace', async () =>
          workspaceSchema.parse(await this.spaces.getWorkspace(user.id, workspaceId)),
        ),
    );
    server.registerTool(
      'update_workspace',
      {
        description: 'owner가 공간 이름 또는 보관 상태를 변경합니다.',
        inputSchema: workspaceIdInput.extend({ update: updateWorkspaceSchema }),
        outputSchema: workspaceSchema,
        annotations: write,
      },
      ({ workspaceId, update }) =>
        invoke('update_workspace', async () =>
          workspaceSchema.parse(
            await this.spaces.updateWorkspace(user.id, workspaceId, {
              ...(update.name !== undefined ? { name: update.name } : {}),
              ...(update.status !== undefined ? { status: update.status } : {}),
            }),
          ),
        ),
    );
    server.registerTool(
      'delete_workspace',
      {
        description: 'owner가 프로젝트가 없는 공간을 영구 삭제합니다.',
        inputSchema: workspaceIdInput,
        outputSchema: z.strictObject({ deleted: z.literal(true) }),
        annotations: destructive,
      },
      ({ workspaceId }) =>
        invoke('delete_workspace', () => this.spaces.deleteWorkspace(user.id, workspaceId)),
    );
    server.registerTool(
      'list_workspace_members',
      {
        description: '공간의 현재 멤버와 역할을 조회합니다.',
        inputSchema: workspaceIdInput,
        outputSchema: z.strictObject({ members: z.array(workspaceMemberSchema) }),
        annotations: read,
      },
      ({ workspaceId }) =>
        invoke('list_workspace_members', async () => ({
          members: z
            .array(workspaceMemberSchema)
            .parse(await this.spaces.listMembers(user.id, workspaceId)),
        })),
    );
    server.registerTool(
      'update_workspace_member',
      {
        description: 'owner가 멤버 역할을 변경합니다. 마지막 owner의 강등은 거부됩니다.',
        inputSchema: memberInput.extend({ update: updateWorkspaceMemberSchema }),
        outputSchema: workspaceMemberSchema,
        annotations: write,
      },
      ({ workspaceId, userId, update }) =>
        invoke('update_workspace_member', async () =>
          workspaceMemberSchema.parse(
            await this.spaces.updateMember(user.id, workspaceId, userId, update),
          ),
        ),
    );
    server.registerTool(
      'remove_workspace_member',
      {
        description: 'owner가 공간 멤버를 제거합니다. 마지막 owner의 제거는 거부됩니다.',
        inputSchema: memberInput,
        outputSchema: z.strictObject({ removed: z.literal(true) }),
        annotations: destructive,
      },
      ({ workspaceId, userId }) =>
        invoke('remove_workspace_member', () =>
          this.spaces.removeMember(user.id, workspaceId, userId),
        ),
    );
    server.registerTool(
      'leave_workspace',
      {
        description: '인증된 사용자가 공간에서 탈퇴합니다. 마지막 owner의 탈퇴는 거부됩니다.',
        inputSchema: workspaceIdInput,
        outputSchema: z.strictObject({ removed: z.literal(true) }),
        annotations: destructive,
      },
      ({ workspaceId }) =>
        invoke('leave_workspace', () => this.spaces.leaveWorkspace(user.id, workspaceId)),
    );
    server.registerTool(
      'create_workspace_invitation',
      {
        description: 'owner가 앱 내부 사용자명으로 공간 초대를 생성합니다.',
        inputSchema: workspaceIdInput.extend({ invitation: createWorkspaceInvitationSchema }),
        outputSchema: workspaceInvitationSchema,
        annotations: write,
      },
      ({ workspaceId, invitation }) =>
        invoke('create_workspace_invitation', async () =>
          workspaceInvitationSchema.parse(
            await this.spaces.createInvitation(user.id, workspaceId, invitation),
          ),
        ),
    );
    server.registerTool(
      'list_workspace_invitations',
      {
        description: 'owner가 공간의 초대 상태를 조회합니다.',
        inputSchema: workspaceIdInput,
        outputSchema: z.strictObject({ invitations: z.array(workspaceInvitationSchema) }),
        annotations: read,
      },
      ({ workspaceId }) =>
        invoke('list_workspace_invitations', async () => ({
          invitations: z
            .array(workspaceInvitationSchema)
            .parse(await this.spaces.listInvitations(user.id, workspaceId)),
        })),
    );
    server.registerTool(
      'list_my_workspace_invitations',
      {
        description: '인증된 사용자에게 온 공간 초대를 조회합니다.',
        inputSchema: z.strictObject({}),
        outputSchema: z.strictObject({ invitations: z.array(workspaceInvitationSchema) }),
        annotations: read,
      },
      () =>
        invoke('list_my_workspace_invitations', async () => ({
          invitations: z
            .array(workspaceInvitationSchema)
            .parse(await this.spaces.invitationInbox(user.id)),
        })),
    );
    server.registerTool(
      'accept_workspace_invitation',
      {
        description: '인증된 사용자에게 온 유효한 공간 초대를 수락하고 멤버로 참여합니다.',
        inputSchema: invitationIdInput,
        outputSchema: workspaceInvitationSchema,
        annotations: write,
      },
      ({ invitationId }) =>
        invoke('accept_workspace_invitation', async () =>
          workspaceInvitationSchema.parse(
            await this.spaces.acceptInvitation(user.id, invitationId),
          ),
        ),
    );
    server.registerTool(
      'decline_workspace_invitation',
      {
        description: '인증된 사용자에게 온 공간 초대를 거절합니다.',
        inputSchema: invitationIdInput,
        outputSchema: workspaceInvitationSchema,
        annotations: write,
      },
      ({ invitationId }) =>
        invoke('decline_workspace_invitation', async () =>
          workspaceInvitationSchema.parse(
            await this.spaces.declineInvitation(user.id, invitationId),
          ),
        ),
    );
    server.registerTool(
      'cancel_workspace_invitation',
      {
        description: 'owner가 공간의 대기 중인 초대를 취소합니다.',
        inputSchema: workspaceIdInput.extend({ invitationId: idSchema }),
        outputSchema: workspaceInvitationSchema,
        annotations: write,
      },
      ({ workspaceId, invitationId }) =>
        invoke('cancel_workspace_invitation', async () =>
          workspaceInvitationSchema.parse(
            await this.spaces.cancelInvitation(user.id, workspaceId, invitationId),
          ),
        ),
    );
  }

  private async invoke<T>(
    tool: string,
    user: AuthenticatedUser,
    tokenId: string,
    requestId: string,
    callback: () => Promise<T>,
  ) {
    const started = Date.now();
    try {
      await this.auth.assertActiveToken(tokenId, user.id);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new HttpException(
                '도구 처리 시간이 초과되어 결과가 불명확합니다. 쓰기 작업은 이력에서 확인하세요.',
                504,
              ),
            ),
          TIMEOUT_MS,
        );
        timer.unref();
      });
      const value = await Promise.race([callback(), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      const structuredContent = value as Record<string, unknown>;
      const count = Array.isArray(value)
        ? value.length
        : value && typeof value === 'object'
          ? Object.values(value).find(Array.isArray)?.length
          : undefined;
      await this.logger.write({
        level: 'info',
        event: 'tool-finished',
        requestId,
        userId: user.id,
        tokenId,
        tool,
        durationMs: Date.now() - started,
        status: 'success',
        ...(count !== undefined ? { resultCount: count } : {}),
      });
      return { content: [{ type: 'text' as const, text: `${tool} 완료` }], structuredContent };
    } catch (error) {
      const expected = error instanceof HttpException;
      const errorCode = expected ? `HTTP_${error.getStatus()}` : 'INTERNAL';
      await this.logger.write({
        level: expected ? 'warn' : 'error',
        event: 'tool-finished',
        requestId,
        userId: user.id,
        tokenId,
        tool,
        durationMs: Date.now() - started,
        status: 'error',
        errorCode,
      });
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: expected ? error.message : `도구 실행에 실패했습니다. 요청 ID: ${requestId}`,
          },
        ],
      };
    }
  }
}

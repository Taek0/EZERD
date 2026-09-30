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
  projectDocumentSchema,
  projectTransferSchema,
  personalStateSnapshotSchema,
  projectQuerySchema,
  projectSchema,
  syncOperationResultSchema,
  threadSchema,
  updateProjectSchema,
  updateNotificationSchema,
  updateThreadSchema,
  updateWorkspaceSchema,
  updateWorkspaceMemberSchema,
  workspaceSchema,
  workspaceMemberSchema,
  workspaceInvitationSchema,
} from '@ezerd/contracts';
import { diagnoseDocument, mergeStoredPersonalState } from '@ezerd/model';
import type { AuthenticatedUser } from '../identity/session.js';
import { ReviewService } from '../review/review.service.js';
import { WorkspaceService } from '../workspace/workspace.service.js';
import { SpaceService } from '../workspace/space.service.js';
import { SyncService } from '../sync/sync.service.js';
import { McpLogger } from './logging.js';
import { McpAuthService } from './mcp-auth.service.js';
import { applyProjectChangesSchema, McpDocumentService } from './mcp-document.service.js';
import { applyPersonalChangesSchema, McpPersonalService } from './mcp-personal.service.js';
import {
  diagnoseLayout,
  layoutDiagnosisInputSchema,
  layoutDiagnosisSchema,
} from './mcp-layout-diagnostics.js';
import {
  listTables,
  listTablesInputSchema,
  listViewRelations,
  projectSummary,
  projectSummarySchema,
  projectView,
  projectViewInputSchema,
  projectViewSchema,
  tableDetails,
  tableDetailsSchema,
  tableListSchema,
  viewRelationsInputSchema,
  viewRelationsSchema,
} from './mcp-read.js';
import {
  historyInputSchema,
  historyPageSchema,
  operationResult,
  projectHistory,
} from './mcp-response.js';

const idSchema = z.uuid();
const TIMEOUT_MS = 60_000;
const projectStateSchema = projectDocumentSchema.extend({
  syncSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const commandRequestSchema = z.strictObject({
  operationId: idSchema,
  groupId: idSchema,
  clientId: idSchema,
});
const diagnosticSchema = z.strictObject({
  code: z.string(),
  objectId: z.string(),
  message: z.string(),
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
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(McpDocumentService) private readonly documents: McpDocumentService,
    @Inject(McpPersonalService) private readonly personal: McpPersonalService,
    @Inject(SpaceService) private readonly spaces: SpaceService,
    @Inject(McpAuthService) private readonly auth: McpAuthService,
  ) {}

  create(user: AuthenticatedUser, tokenId: string, requestId: string): McpServer {
    const server = new McpServer(
      { name: 'ezerd', version: '0.1.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'EZERD 공간, 프로젝트와 리뷰를 조회하고 변경합니다. whoami로 현재 사용자를 확인하고 list_workspaces로 접근 가능한 공간과 역할을 확인하세요. 프로젝트 생성과 가져오기에는 workspaceId가 필요합니다. viewer는 설계 변경을 할 수 없으며' +
          ' active 공간에서 개인 상태와 리뷰는 사용할 수 있습니다. 보관된 공간에서는 쓰기가 제한됩니다. 쓰기 도구에는 최신 동시성 기준을 사용하세요. ' +
          '프로젝트 탐색은 get_project_summary로 시작하고, 배치 작업 전에는 get_project_view의 모든 페이지로 대상 뷰의 최신 배치를 확인하세요. 화면의 관계는 list_view_relations로 조회하세요. 결합 화면·개인 화면 위치는 get_personal_state로 개인 버전을 확인하고 apply_personal_changes로 변경하세요. 테이블 컬럼·키·관계가 필요할 때 get_table_details를 사용하세요. 전체 스냅샷이 필요한 경우에만 get_project를 사용하세요. ' +
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
          '작업 후 get_project_view로 결과를 재조회해 같은 좌표 계산으로 겹침을 확인하고 수정하세요. 좌표를 생략해 모든 객체를 같은 위치에 생성하지 마세요.',
      },
    );
    const invoke = <T>(tool: string, callback: () => Promise<T>) =>
      this.invoke(tool, user, tokenId, requestId, callback);
    const projectState = async (projectId: string) => {
      const [shared, personal] = await Promise.all([
        this.workspace.getProjectState(user.id, projectId),
        this.personal.get(projectId, user),
      ]);
      return {
        ...shared,
        document: mergeStoredPersonalState(shared.document, personal.state),
      };
    };
    const requireAccepted = <
      T extends { status: 'accepted' | 'rejected'; reason?: string | undefined },
    >(
      result: T,
    ) => {
      if (result.status === 'rejected')
        throw new HttpException(result.reason ?? '작업이 동시성 규칙에 따라 거부되었습니다.', 409);
      return result;
    };

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
      'get_project',
      {
        description: '프로젝트 메타데이터와 현재 설계 문서를 조회합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: projectStateSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('get_project', async () => projectStateSchema.parse(await projectState(projectId))),
    );
    server.registerTool(
      'get_project_summary',
      {
        description:
          '전체 설계 문서 없이 프로젝트 버전, 객체 개수와 화면·도메인 목록을 조회합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: projectSummarySchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('get_project_summary', async () => projectSummary(await projectState(projectId))),
    );
    server.registerTool(
      'list_tables',
      {
        description: '테이블 이름과 ID를 도메인·검색어로 좁혀 최대 100개씩 조회합니다.',
        inputSchema: listTablesInputSchema,
        outputSchema: tableListSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      (input) =>
        invoke('list_tables', async () => listTables(await projectState(input.projectId), input)),
    );
    server.registerTool(
      'get_project_view',
      {
        description:
          '한 화면의 카드 요약·좌표와 페이지 내 연결 관계를 최대 100개 카드씩 조회합니다. 테이블 컬럼은 포함하지 않습니다.',
        inputSchema: projectViewInputSchema,
        outputSchema: projectViewSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, viewId, limit, cursor }) =>
        invoke('get_project_view', async () =>
          projectView(await projectState(projectId), viewId, limit, cursor),
        ),
    );
    server.registerTool(
      'list_view_relations',
      {
        description:
          '한 화면에 실제로 보이는 도메인·테이블 관계와 관계선 경로를 최대 100개씩 조회합니다.',
        inputSchema: viewRelationsInputSchema,
        outputSchema: viewRelationsSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, viewId, limit, cursor }) =>
        invoke('list_view_relations', async () =>
          listViewRelations(await projectState(projectId), viewId, limit, cursor),
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
      'get_table_details',
      {
        description: '한 테이블의 컬럼·키·연결 관계·배치 정보를 조회합니다.',
        inputSchema: z.strictObject({ projectId: idSchema, tableId: z.string().min(1).max(160) }),
        outputSchema: tableDetailsSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, tableId }) =>
        invoke('get_table_details', async () =>
          tableDetails(await projectState(projectId), tableId),
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
        description: '새 EZERD 프로젝트를 생성합니다.',
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
        description: '최신 expectedVersion을 기준으로 프로젝트 이름 또는 보관 상태를 변경합니다.',
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
      'diagnose_project',
      {
        description: '현재 설계 문서의 구조적 문제를 진단합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: z.strictObject({ diagnostics: z.array(diagnosticSchema) }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('diagnose_project', async () => {
          const { document } = await projectState(projectId);
          return { diagnostics: z.array(diagnosticSchema).parse(diagnoseDocument(document)) };
        }),
    );
    server.registerTool(
      'diagnose_layout',
      {
        description:
          '저장 좌표와 실제 렌더링 카드 크기로 화면의 카드 겹침·40px 미만 간격·테이블 자동 확장을 진단합니다. 결과는 배치를 자동 변경하지 않습니다.',
        inputSchema: layoutDiagnosisInputSchema,
        outputSchema: layoutDiagnosisSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, viewId, limit }) =>
        invoke('diagnose_layout', async () => {
          const state = await projectState(projectId);
          if (viewId) projectView(state, viewId);
          return diagnoseLayout(state.document, viewId, limit);
        }),
    );
    server.registerTool(
      'apply_project_changes',
      {
        description:
          '명시적인 도메인·테이블·컬럼·키·관계·노트·ENUM과 공유 화면 배치를 최신 기준에 원자적으로 적용합니다. 기존 객체의 일부 필드는 patch_* 명령으로 변경할 수 있습니다. 생성/이동할 카드의 크기와 같은 뷰의 기존 위치를 먼저 확인하고 최소 40px 간격으로 겹침 없이 배치하세요. 연결된 객체를 가까이 묶고 도메인 흐름 및 PK→FK 방향을 일관되게 표현하며 관계선 교차와 긴 연결을 줄인 뒤 결과를 재조회하세요.',
        inputSchema: applyProjectChangesSchema.extend({
          includeDocument: z.boolean().default(false),
        }),
        outputSchema: syncOperationResultSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ includeDocument, ...input }) =>
        invoke('apply_project_changes', async () =>
          operationResult(
            syncOperationResultSchema.parse(await this.documents.apply(input, user)),
            includeDocument,
          ),
        ),
    );
    server.registerTool(
      'apply_personal_changes',
      {
        description:
          '인증된 사용자 자신의 결합 화면·참조 테이블·개인 배치·뷰포트·관계 경로·메모를 개인 버전 기준으로 변경합니다.',
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
      'get_project_history',
      {
        description:
          '지정한 동기화 순서 이후의 이력을 최대 100건씩 조회합니다. 기본 응답은 변경 경로만 포함하며 변경값·전체 문서·삭제 스냅샷은 요청 시 포함합니다.',
        inputSchema: historyInputSchema,
        outputSchema: historyPageSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, since, limit, ...options }) =>
        invoke('get_project_history', async () =>
          projectHistory(await this.sync.historyPage(user.id, projectId, since, limit), options),
        ),
    );
    server.registerTool(
      'undo_project_operation',
      {
        description: '인증된 사용자가 승인받은 기존 작업을 현재 충돌 규칙에 따라 실행 취소합니다.',
        inputSchema: z.strictObject({
          projectId: idSchema,
          sourceOperationId: idSchema,
          request: commandRequestSchema,
          includeDocument: z.boolean().default(false),
        }),
        outputSchema: syncOperationResultSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ projectId, sourceOperationId, request, includeDocument }) =>
        invoke('undo_project_operation', async () =>
          operationResult(
            requireAccepted(
              syncOperationResultSchema.parse(
                await this.sync.undo(projectId, sourceOperationId, request, user),
              ),
            ),
            includeDocument,
          ),
        ),
    );
    server.registerTool(
      'restore_project_deletion',
      {
        description: '삭제 작업의 보존 스냅샷을 새 객체 ID로 복원합니다.',
        inputSchema: z.strictObject({
          projectId: idSchema,
          deletedOperationId: idSchema,
          request: commandRequestSchema,
          includeDocument: z.boolean().default(false),
        }),
        outputSchema: z.strictObject({
          result: syncOperationResultSchema,
          omittedRelations: z.array(z.string()),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, deletedOperationId, request, includeDocument }) =>
        invoke('restore_project_deletion', async () => {
          const outcome = await this.sync.restore(projectId, deletedOperationId, request, user);
          return {
            result: operationResult(
              requireAccepted(syncOperationResultSchema.parse(outcome.result)),
              includeDocument,
            ),
            omittedRelations: z.array(z.string()).parse(outcome.omittedRelations),
          };
        }),
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

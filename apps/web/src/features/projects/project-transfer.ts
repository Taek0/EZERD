import { registerTranslations, translate as t } from '../../shared/i18n/index.js';
import '../collaboration/translations.js';
import {
  diagnoseDocument,
  nativeReferenceProblems,
  resolveProjectDatabaseState,
  type DesignDocument,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  projectTransferSchema,
  MAX_PROJECT_TRANSFER_BYTES,
  nativeTransferReadSchema,
  importNativeProjectSchema,
  nativeTransferImportResultSchema,
  projectSchema,
  type NativeTransferRead,
  type Project,
} from '@ezerd/contracts';
import { body, request, storedAuthorization } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';

registerTranslations({
  '지원하지 않는 프로젝트 파일 버전입니다. 버전 1 또는 2 파일을 선택해 주세요.':
    'Unsupported project file version. Select a version 1 or 2 file.',
  '설계 참조가 올바르지 않습니다: {code} ({path})': 'Invalid design reference: {code} ({path})',
  '프로젝트 전송 대상이 변경되었습니다. 최신 화면에서 다시 시도해 주세요.':
    'The project transfer target changed. Retry from the current screen.',
});
export type ProjectTransferApi = (url: string, init?: RequestInit) => Promise<unknown>;
export interface ProjectTransferScope {
  userId: string;
  workspaceId?: string;
  projectId?: string;
}
export interface ProjectTransferControl {
  scope: ProjectTransferScope;
  currentScope: () => ProjectTransferScope | null;
}
export function currentTransferUserId(): string | undefined {
  try {
    const raw = sessionStorage.getItem('ezerd.sync.session');
    const userId = raw ? (JSON.parse(raw) as { userId?: unknown }).userId : undefined;
    return typeof userId === 'string' && userId ? userId : undefined;
  } catch {
    return undefined;
  }
}
/** Capture both visible scope and credentials; never download/apply a response into another actor. */
export function projectTransferGuard(
  control: ProjectTransferControl,
  authorization: () => string | undefined = storedAuthorization,
): () => void {
  const expected = { ...control.scope },
    token = authorization(),
    sessionActor = currentTransferUserId();
  return () => {
    const current = control.currentScope();
    if (
      !current ||
      current.userId !== expected.userId ||
      current.workspaceId !== expected.workspaceId ||
      current.projectId !== expected.projectId ||
      currentTransferUserId() !== sessionActor ||
      authorization() !== token
    )
      throw new Error(t('프로젝트 전송 대상이 변경되었습니다. 최신 화면에서 다시 시도해 주세요.'));
  };
}
export function projectTransferDocument(
  file: NativeTransferRead,
): DesignDocument | NativeDesignDocument {
  return 'sourceDocument' in file ? file.sourceDocument : file.document;
}
export function assertProjectTransferGraph(document: DesignDocument | NativeDesignDocument): void {
  if (document.schemaVersion === 1) {
    const issue = diagnoseDocument(document)[0];
    if (issue)
      throw new Error(t('설계 데이터를 확인해 주세요: {message}', { message: issue.message }));
  } else {
    const issue = nativeReferenceProblems(document)[0];
    if (issue)
      throw new Error(
        t('설계 참조가 올바르지 않습니다: {code} ({path})', { code: issue.code, path: issue.path }),
      );
  }
}

export function parseProjectTransfer(text: string): NativeTransferRead {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_TRANSFER_BYTES)
    throw new Error(t('프로젝트 파일은 2 MB까지 가져올 수 있습니다.'));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t('올바른 JSON 프로젝트 파일을 선택해 주세요.'));
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'formatVersion' in raw &&
    raw.formatVersion !== 1 &&
    raw.formatVersion !== 2
  )
    throw new Error(
      t('지원하지 않는 프로젝트 파일 버전입니다. 버전 1 또는 2 파일을 선택해 주세요.'),
    );
  const parsed = nativeTransferReadSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(t('프로젝트 파일 형식 또는 설계 데이터가 올바르지 않습니다.'));
  // Validate the full contract without returning parser-trimmed evidence or a v1 projection.
  const file = raw as NativeTransferRead;
  assertProjectTransferGraph(projectTransferDocument(file));
  if ('native' in file && file.native.status === 'available')
    assertProjectTransferGraph(file.native.document);
  return file;
}

export async function importProjectTransfer(
  file: NativeTransferRead,
  name: string,
  workspaceId: string,
  options: { api?: ProjectTransferApi; assertCurrent?: () => void; userId?: string } = {},
): Promise<Project> {
  const userId = options.userId ?? currentTransferUserId();
  if (!userId) throw new Error('project-transfer.identity-required');
  const api = captureNativeActorApi(userId, (options.api ?? request) as typeof request),
    assertCurrent = options.assertCurrent ?? (() => undefined);
  assertCurrent();
  const transfer = parseProjectTransfer(
    JSON.stringify({ ...file, project: { ...file.project, name: name.trim() } }),
  );
  if ('native' in transfer && transfer.native.status === 'unavailable')
    throw new Error(transfer.native.code);
  let project: Project;
  if (transfer.formatVersion === 1) {
    // Preserve the existing v1 endpoint, including its structural contract and server adapter.
    projectTransferSchema.parse(transfer);
    project = projectSchema.parse(
      await api('/api/projects/import', body('POST', { workspaceId, transfer })),
    );
  } else {
    const input = importNativeProjectSchema.parse({ workspaceId, transfer });
    // Contract validation must not replace raw aliases/identifiers in the uploaded evidence.
    const result = nativeTransferImportResultSchema.parse(
      await api('/api/projects/native-transfer/import', body('POST', { ...input, transfer })),
    );
    project = result.project;
  }
  assertCurrent();
  const database = resolveProjectDatabaseState(project);
  if (
    project.workspaceId !== workspaceId ||
    (transfer.formatVersion === 2 &&
      (project.databaseProfileId === undefined || project.databaseRevision === undefined)) ||
    database.kind !== (transfer.project.databaseKind ?? 'postgresql') ||
    (transfer.formatVersion === 2 && database.profileId !== transfer.project.databaseProfileId)
  )
    throw new Error('project-transfer.import-context-invalid');
  return project;
}

export function projectTransferFilename(name: string): string {
  return `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'project'}.ezerd.json`;
}

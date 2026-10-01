import { projectDatabasePreviewSchema } from '@ezerd/contracts';
import type { DatabaseKind } from '@ezerd/model';
import { body, request } from '../../shared/api/client.js';
import { registerTranslations, translate as t } from '../../shared/i18n/index.js';
registerTranslations({
  '물리 설계가 있는 프로젝트는 DB 종류 변경 전에 변환이 필요합니다.':
    'A project with a physical design needs conversion before changing its database.',
  '보관된 프로젝트의 DB 설정은 변경할 수 없습니다.':
    'Database settings cannot be changed for archived projects.',
  '프로젝트가 변경되었습니다. 최신 상태를 다시 확인해 주세요.':
    'The project changed. Check its latest state.',
  'DB 설정을 변경할 수 없습니다.': 'Cannot change the database settings.',
});

export async function previewDatabaseChange(
  project: {
    id: string;
    version: number;
    databaseKind?: DatabaseKind | undefined;
    databaseRevision?: number | undefined;
  },
  targetKind: DatabaseKind,
  call: (url: string, init: RequestInit) => Promise<unknown> = request,
) {
  if ((project.databaseKind ?? 'postgresql') === targetKind) return;
  const preview = projectDatabasePreviewSchema.parse(
    await call(
      `/api/projects/${project.id}/database/preview`,
      body('POST', { expectedVersion: project.version, targetKind }),
    ),
  );
  if (
    preview.projectId !== project.id ||
    preview.version !== project.version ||
    preview.current.kind !== (project.databaseKind ?? 'postgresql') ||
    preview.current.revision !== (project.databaseRevision ?? 0) ||
    preview.target.kind !== targetKind
  )
    throw new Error(t('프로젝트가 변경되었습니다. 최신 상태를 다시 확인해 주세요.'));
  if (!preview.canChange)
    throw new Error(
      t(
        preview.reasonCode === 'database.conversion-required'
          ? '물리 설계가 있는 프로젝트는 DB 종류 변경 전에 변환이 필요합니다.'
          : preview.reasonCode === 'database.project-archived'
            ? '보관된 프로젝트의 DB 설정은 변경할 수 없습니다.'
            : 'DB 설정을 변경할 수 없습니다.',
      ),
    );
}

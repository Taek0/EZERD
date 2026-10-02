import { versionedProjectTransferSchema } from '@ezerd/contracts';
import { request } from '../../shared/api/client.js';
import { projectTransferFilename } from './project-transfer.js';
export async function exportVersionedProjectFile(
  projectId: string,
  databaseRevision: number,
): Promise<void> {
  const file = versionedProjectTransferSchema.parse(
    await request(`/api/projects/${encodeURIComponent(projectId)}/native-transfer`, {
      cache: 'no-store',
    }),
  );
  if (file.source.projectId !== projectId || file.source.databaseRevision !== databaseRevision)
    throw Error('database.context-changed');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file)], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = projectTransferFilename(file.project.name);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

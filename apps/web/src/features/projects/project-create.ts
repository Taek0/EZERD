import { createProjectSchema } from '@ezerd/contracts';
import type { DatabaseKind } from '@ezerd/model';
export type GalleryProjectCreationOptions = { formatVersion: 1 | 2 };
/** Latest gallery explicitly requests native; omission at the REST boundary still means v1. */
export function galleryProjectCreationInput(
  workspaceId: string,
  name: string,
  databaseKind: DatabaseKind,
  options: GalleryProjectCreationOptions = { formatVersion: 2 },
) {
  return createProjectSchema.parse({
    workspaceId,
    name,
    databaseKind,
    formatVersion: options.formatVersion,
  });
}

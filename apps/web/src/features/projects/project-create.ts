import { createProjectSchema } from '@ezerd/contracts';
import type { DatabaseKind } from '@ezerd/model';
export type GalleryProjectCreationOptions = { formatVersion: 2 };
/** New projects always start with a native document. */
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

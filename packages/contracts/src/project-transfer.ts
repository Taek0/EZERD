import { z } from 'zod';
import { createProjectSchema, designDocumentSchema } from './workspace.js';

export const MAX_PROJECT_TRANSFER_BYTES = 2_000_000;
export const projectTransferSchema = z
  .strictObject({
    format: z.literal('ezerd-project'),
    formatVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    project: createProjectSchema.strict(),
    document: designDocumentSchema,
  })
  .superRefine((file, ctx) => {
    let bytes = 0;
    for (const character of JSON.stringify(file)) {
      const code = character.codePointAt(0)!;
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (bytes > MAX_PROJECT_TRANSFER_BYTES) break;
    }
    if (bytes > MAX_PROJECT_TRANSFER_BYTES)
      ctx.addIssue({ code: 'custom', message: '프로젝트 파일은 2 MB까지 가져올 수 있습니다.' });
  });
export type ProjectTransfer = z.infer<typeof projectTransferSchema>;

import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const cursorSchema = z.strictObject({
  updatedAt: z.iso.datetime(),
  id: z.uuid(),
});
export type UpdatedCursor = z.infer<typeof cursorSchema>;

export function encodeUpdatedCursor(cursor: UpdatedCursor) {
  return Buffer.from(JSON.stringify(cursorSchema.parse(cursor))).toString('base64url');
}

export function decodeUpdatedCursor(raw: string | undefined): UpdatedCursor | undefined {
  if (!raw) return undefined;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== raw)
      throw new Error('Invalid cursor encoding.');
    return cursorSchema.parse(JSON.parse(decoded));
  } catch {
    throw new BadRequestException('목록 커서가 올바르지 않습니다.');
  }
}

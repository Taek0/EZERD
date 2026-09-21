import { createMessageSchema, createThreadSchema } from '@ezerd/contracts';
import type { ReviewTarget } from './comments-state.js';

export function replyRequest(body: string, mentionIds: string[]) {
  return createMessageSchema.parse({ body, mentionIds });
}

export function pinRequest(target: ReviewTarget, body: string, mentionIds: string[]) {
  return createThreadSchema.parse({
    viewId: target.viewId,
    objectId: target.objectId,
    x: target.x,
    y: target.y,
    body,
    mentionIds,
  });
}

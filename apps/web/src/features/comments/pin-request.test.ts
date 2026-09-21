import { expect, it } from 'vitest';
import { createThreadSchema, createMessageSchema } from '@ezerd/contracts';
import { pinRequest, replyRequest } from './pin-request.js';

it('sends canvas pins using the server contract without client authorship', () => {
  const input = pinRequest(
    { viewId: 'overview', objectId: null, x: 865.374646480042, y: 78.10153961117038 },
    'test',
    [],
  );
  expect(createThreadSchema.parse(input)).toEqual(input);
  expect(input).not.toHaveProperty('authorId');
  expect(input.objectId).toBeNull();
  expect(input.x).toBe(865.374646480042);
});
it('sends replies without authorship and normalizes mentions', () => {
  const id = 'c1ce0a8d-f421-450b-ba48-5ef5e9fd1433';
  const input = replyRequest(' reply ', [id, id]);
  expect(createMessageSchema.parse(input)).toEqual({ body: 'reply', mentionIds: [id] });
  expect(input).not.toHaveProperty('authorId');
});

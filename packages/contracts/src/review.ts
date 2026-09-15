import { z } from 'zod';
const uuid = z.uuid();
const objectId = z.string().trim().min(1).max(160);
const body = z.string().trim().min(1).max(10000);
const mentions = z
  .array(uuid)
  .max(100)
  .transform((ids) => [...new Set(ids)]);
export const createMessageSchema = z.strictObject({ body, mentionIds: mentions });
export const createThreadSchema = z.strictObject({
  viewId: objectId,
  objectId: objectId.nullable(),
  x: z.number().min(-1e7).max(1e7),
  y: z.number().min(-1e7).max(1e7),
  body,
  mentionIds: mentions,
});
export const updateThreadSchema = z.strictObject({ resolved: z.boolean() });
export const updateNotificationSchema = z.strictObject({ read: z.boolean() });
export const commentMessageSchema = z.strictObject({
  id: uuid,
  threadId: uuid,
  authorId: uuid,
  body,
  mentionIds: z.array(uuid),
  createdAt: z.iso.datetime(),
});
export const threadSchema = z.strictObject({
  id: uuid,
  projectId: uuid,
  viewId: objectId,
  objectId: objectId.nullable(),
  x: z.number(),
  y: z.number(),
  resolved: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messages: z.array(commentMessageSchema),
});
export const notificationSchema = z.strictObject({
  id: uuid,
  userId: uuid,
  projectId: uuid,
  threadId: uuid,
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Thread = z.infer<typeof threadSchema>;
export type CommentMessage = z.infer<typeof commentMessageSchema>;
export type Notification = z.infer<typeof notificationSchema>;

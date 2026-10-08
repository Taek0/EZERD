import { expect, it } from 'vitest';
import { nativeNotification } from '../src/sync/sync.gateway.js';
it('projects only native ordering metadata for opted-in subscriptions without mutating the event', () => {
  const message = {
    type: 'operation',
    projectId: 'p',
    event: {
      protocolVersion: 2,
      operationId: 'op',
      sequence: 5,
      databaseRevision: 1,
      status: 'accepted',
      document: { privateData: 'large document' },
      changes: [{ before: 'large value' }],
      actor: { username: 'name' },
    },
  };
  expect(nativeNotification(message)).toEqual({
    type: 'operation',
    projectId: 'p',
    event: {
      protocolVersion: 2,
      operationId: 'op',
      sequence: 5,
      databaseRevision: 1,
      status: 'accepted',
    },
  });
  expect(message.event.document).toBeDefined();
  const head = { type: 'head', projectId: 'p', sequence: 5, databaseRevision: 1 };
  expect(nativeNotification(head)).toBe(head);
});

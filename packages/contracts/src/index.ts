import { z } from 'zod';

export const healthSchema = z.object({
  service: z.literal('ezerd-api'),
  status: z.literal('ok'),
});

export const readinessSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    database: z.literal('connected'),
    schema: z.literal('ready'),
  }),
  z.object({ status: z.literal('unavailable'), message: z.string() }),
]);

export type Health = z.infer<typeof healthSchema>;
export type Readiness = z.infer<typeof readinessSchema>;

export * from './workspace.js';
export * from './relational.js';
export * from './review.js';

export * from './project-actions.js';

export * from './pin-actions.js';
export * from './sync.js';
export * from './project-transfer.js';
export * from './spaces.js';
export * from './native-document.js';
export * from './database-state.js';
export * from './database-capabilities.js';
export * from './native-sync.js';
export * from './native-clipboard.js';
export * from './project-document-state.js';
export * from './native-edit.js';
export * from './native-upgrade.js';
export * from './native-transfer.js';
export * from './native-ddl.js';
export * from './native-history.js';
export * from './native-cancellation.js';

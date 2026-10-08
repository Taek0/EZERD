import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { vi } from 'vitest';
import { projects, workspaceAuditEvents } from '../src/db/schema.js';
import { NativeTransferService } from '../src/workspace/native-transfer.service.js';

/** In-memory adapter for the real transfer service; PostgreSQL atomicity is tested separately. */
export function nativeTransferStore(fail = false) {
  const stored: any[] = [],
    audits: any[] = [];
  const db = {
    insert: vi.fn((table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        if (fail) throw Error('storage unavailable');
        if (table === workspaceAuditEvents) audits.push(value);
        return {
          returning: async () => {
            if (table !== projects) throw Error('Unexpected returning');
            const document = JSON.parse(
              new PgDialect().sqlToQuery(value.document as SQL).params[0] as string,
            );
            const row = {
              ...value,
              document,
              id: randomUUID(),
              status: 'active',
              version: 0,
              syncSequence: 0,
              databaseRevision: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            stored.push(row);
            return [row];
          },
        };
      },
    })),
  };
  const access = {
    runWorkspace: vi.fn(
      async (
        _actor: string,
        _workspace: string,
        _permission: string,
        run: (tx: unknown) => unknown,
      ) => run(db),
    ),
  };
  return {
    stored,
    audits,
    db,
    access,
    service: new NativeTransferService({ db } as never, access as never),
  };
}

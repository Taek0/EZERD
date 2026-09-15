import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { readConfig } from '../config.js';
import * as schema from './schema.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool = new pg.Pool({
    connectionString: readConfig().DATABASE_URL,
    connectionTimeoutMillis: 2000,
    query_timeout: 3000,
    max: 5,
  });

  readonly db = drizzle(this.pool, { schema });

  constructor() {
    this.pool.on('error', () => console.error('An idle database connection failed.'));
  }

  async checkReady(): Promise<void> {
    // Verify every migration needed by the current application.
    await this.db
      .select({
        id: schema.projects.id,
        version: schema.projects.version,
        document: schema.projects.document,
      })
      .from(schema.projects)
      .limit(1);
    await this.db.select({ id: schema.users.id }).from(schema.users).limit(1);
    await this.db.select().from(schema.threads).limit(1);
    await this.db.select().from(schema.messages).limit(1);
    await this.db.select().from(schema.notifications).limit(1);
    await this.db.select().from(schema.sessions).limit(1);
    await this.db.select().from(schema.syncOperations).limit(1);
    await this.db.select().from(schema.syncFieldVersions).limit(1);
    await this.db.select().from(schema.syncClientBaselines).limit(1);
    await this.db.select().from(schema.syncTombstones).limit(1);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

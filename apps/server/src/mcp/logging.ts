import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { readConfig } from '../config.js';

export type McpLogEntry = {
  level: 'info' | 'warn' | 'error';
  event:
    | 'start'
    | 'stop'
    | 'auth-rejected'
    | 'token-issued'
    | 'token-revoked'
    | 'token-failed'
    | 'tool-finished';
  requestId: string;
  userId?: string;
  tokenId?: string;
  tool?: string;
  durationMs?: number;
  status?: 'success' | 'error';
  errorCode?: string;
  resultCount?: number;
};

@Injectable()
export class McpLogger implements OnModuleInit, OnApplicationShutdown {
  private readonly directory = resolve(readConfig().MCP_LOG_DIR);
  private queue = Promise.resolve();

  onModuleInit(): void {
    void this.write({ level: 'info', event: 'start', requestId: 'startup' });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.write({ level: 'info', event: 'stop', requestId: 'shutdown' });
    await this.queue;
  }

  write(entry: McpLogEntry): Promise<void> {
    const date = new Date();
    const file = resolve(this.directory, `${date.toISOString().slice(0, 10)}.jsonl`);
    const safeEntry = {
      timestamp: date.toISOString(),
      level: entry.level,
      event: entry.event,
      requestId: entry.requestId,
      ...(entry.userId !== undefined ? { userId: entry.userId } : {}),
      ...(entry.tokenId !== undefined ? { tokenId: entry.tokenId } : {}),
      ...(entry.tool !== undefined ? { tool: entry.tool } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      ...(entry.status !== undefined ? { status: entry.status } : {}),
      ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
      ...(entry.resultCount !== undefined ? { resultCount: entry.resultCount } : {}),
    };
    const line = `${JSON.stringify(safeEntry)}\n`;
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
      })
      .catch(() => undefined);
    return this.queue;
  }
}

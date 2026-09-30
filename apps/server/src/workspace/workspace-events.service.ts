import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export type WorkspaceAccessChange = { workspaceId: string; userId?: string };

@Injectable()
export class WorkspaceEventsService {
  private readonly emitter = new EventEmitter();

  onAccessChanged(listener: (event: WorkspaceAccessChange) => void): () => void {
    this.emitter.on('accessChanged', listener);
    return () => this.emitter.off('accessChanged', listener);
  }

  accessChanged(event: WorkspaceAccessChange): void {
    this.emitter.emit('accessChanged', event);
  }
}

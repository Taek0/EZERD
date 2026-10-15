import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export type UserChange = {
  resource: 'workspaces' | 'invitations' | 'notifications' | 'projects';
  workspaceId?: string;
  userIds?: string[];
};

export type WorkspaceAccessChange = { workspaceId: string; userId?: string };

@Injectable()
export class WorkspaceEventsService {
  private readonly emitter = new EventEmitter();

  onUserChanged(listener: (event: UserChange) => void): () => void {
    this.emitter.on('userChanged', listener);
    return () => this.emitter.off('userChanged', listener);
  }

  userChanged(event: UserChange): void {
    this.emitter.emit('userChanged', event);
  }

  onAccessChanged(listener: (event: WorkspaceAccessChange) => void): () => void {
    this.emitter.on('accessChanged', listener);
    return () => this.emitter.off('accessChanged', listener);
  }

  accessChanged(event: WorkspaceAccessChange): void {
    this.emitter.emit('accessChanged', event);
  }
}

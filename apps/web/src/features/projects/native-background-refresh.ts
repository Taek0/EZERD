import { loadProjectEntry, type ProjectEntry } from './project-entry.js';

type NativeEntry = Extract<ProjectEntry, { kind: 'native' }>;
interface RefreshContext {
  identity: string;
  entry: NativeEntry;
}

/** Refresh document data without entering the navigation/leave-editor lifecycle. */
export class NativeBackgroundRefresh {
  private running: Promise<void> | undefined;
  private requested = false;
  constructor(
    private readonly options: {
      current: () => RefreshContext | null;
      load?: (projectId: string) => Promise<ProjectEntry>;
      apply: (entry: NativeEntry) => void;
      error: (cause: unknown) => void;
    },
  ) {}

  refresh(): Promise<void> {
    this.requested = true;
    if (!this.running)
      this.running = this.drain().finally(() => {
        this.running = undefined;
        if (this.requested) void this.refresh();
      });
    return this.running;
  }

  private async drain() {
    while (this.requested) {
      this.requested = false;
      const start = this.options.current();
      if (!start) continue;
      try {
        const next = await (this.options.load ?? loadProjectEntry)(start.entry.snapshot.project.id);
        const current = this.options.current();
        if (!current || current.identity !== start.identity) continue;
        if (
          next.kind !== 'native' ||
          next.snapshot.project.id !== current.entry.snapshot.project.id
        )
          continue;
        if (
          next.snapshot.sequence < current.entry.snapshot.sequence ||
          next.snapshot.project.version < current.entry.snapshot.project.version ||
          next.snapshot.project.databaseRevision < current.entry.snapshot.project.databaseRevision
        )
          continue;
        this.options.apply(next);
      } catch (cause) {
        if (this.options.current()?.identity === start.identity) this.options.error(cause);
      }
    }
  }
}

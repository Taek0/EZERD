vi.mock('../comments/CommentsPanel.js', () => ({
  CommentsPanel: () => null,
  CommentPins: () => null,
}));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import { NativeProjectView } from './NativeProjectView.js';
import { projectEntry } from './project-entry.js';

const harness = vi.hoisted(() => ({
  state: 'unknown',
  initializing: false,
  saving: false,
  canvas: null as Record<string, unknown> | null,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      // Identify the operation state by its meaning; inspector state can grow or reorder.
      const value =
        initial && typeof initial === 'object' && 'saving' in initial && 'pendingBlocked' in initial
          ? { ...initial, saving: harness.saving, pendingBlocked: harness.initializing }
          : initial;
      return actual.useState(value);
    },
  };
});
vi.mock('./native-export-state.js', () => ({
  useNativeDurableState: () => harness.state,
  useNativeExportBlocker: () => undefined,
}));
vi.mock('./NativeERDCanvas.js', async () => {
  const actual =
    await vi.importActual<typeof import('./NativeERDCanvas.js')>('./NativeERDCanvas.js');
  return {
    ...actual,
    NativeERDCanvas: (props: Record<string, unknown>) => {
      harness.canvas = props;
      return null;
    },
  };
});
afterEach(() => {
  harness.initializing = false;
  harness.saving = false;
  harness.canvas = null;
});
function render(busy = false) {
  const database = defaultDatabaseContext('postgresql'),
    document = createEmptyNativeDocument(database);
  const entry = projectEntry({
    protocolVersion: 2,
    project: {
      id: '00000000-0000-4000-8000-000000000002',
      workspaceId: '00000000-0000-4000-8000-000000000003',
      name: 'Recovery',
      databaseKind: database.kind,
      databaseProfileId: database.profileId,
      databaseRevision: 0,
      version: 0,
      status: 'active',
      createdAt: '2026-10-03T00:00:00Z',
      updatedAt: '2026-10-03T00:00:00Z',
    },
    sequence: 0,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  });
  if (entry.kind !== 'native') throw Error('Expected native');
  renderToStaticMarkup(
    createElement(NativeProjectView, {
      entry,
      busy,
      userId: '00000000-0000-4000-8000-000000000001',
      canEdit: true,
      canPersonalEdit: true,
      onLeave() {},
      onReload() {},
    }),
  );
  return harness.canvas!;
}
describe('native root passes operation busy separately from the row requiring recovery', () => {
  it.each(['unknown', 'pending', 'sending'])(
    '%s row still blocks new editing while recovery receives no false external operation',
    (state) => {
      harness.state = state;
      expect(render()).toMatchObject({ busy: true, recoveryBusy: false });
    },
  );
  it('keeps external operations, pending-state loading and shared saving as recovery blockers', () => {
    harness.state = 'unknown';
    expect(render(true)).toMatchObject({ busy: true, recoveryBusy: true });
    harness.initializing = true;
    expect(render()).toMatchObject({ busy: true, recoveryBusy: true });
    harness.initializing = false;
    harness.saving = true;
    expect(render()).toMatchObject({ busy: true, recoveryBusy: true });
  });
  it('keeps an initialized empty writer available for normal editing and recovery', () => {
    harness.state = 'empty';
    expect(render()).toMatchObject({ busy: false, recoveryBusy: false });
  });
});

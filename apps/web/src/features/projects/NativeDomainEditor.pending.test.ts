import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { NativeProjectView } from './NativeProjectView.js';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import type { NativePendingSave } from './native-save.js';

const io = vi.hoisted(() => ({
  load: vi.fn(),
  stage: vi.fn(),
  send: vi.fn(),
  discard: vi.fn(),
  recover: vi.fn(),
}));
const queue = vi.hoisted(() => ({ state: 'empty' }));
vi.mock('./native-export-state.js', () => ({
  useNativeDurableState: () => queue.state,
  useNativeExportBlocker() {},
}));
vi.mock('./native-save.js', async (original) => ({
  ...(await original<typeof import('./native-save.js')>()),
  loadNativePending: io.load,
  stageNativeSave: io.stage,
  sendNativePending: io.send,
  cancelNativePending: io.discard,
  recoverNativePending: io.recover,
}));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (value: string) => value }),
}));

// A small hook driver exercises the root's async callbacks without mounting child editors or a DOM.
// State/ref identity and effect cleanup are retained across actor/project renders.
const driver = vi.hoisted(() => ({
  slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined }[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useState(initial: unknown) {
      const index = driver.cursor++;
      const slot = (driver.slots[index] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (next: unknown) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = driver.cursor++;
      return (driver.slots[index] ??= { value: { current: initial } }).value;
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const index = driver.cursor++,
        slot = (driver.slots[index] ??= {});
      if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps![i]))) {
        driver.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = effect() || undefined;
        });
        slot.deps = deps;
      }
    },
  };
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function snapshot(projectId = 'project-a'): ProjectDocumentState {
  const document = createEmptyNativeDocument(defaultDatabaseContext('sqlite'));
  return {
    protocolVersion: 2,
    project: {
      id: projectId,
      workspaceId: 'workspace',
      name: 'Native',
      databaseKind: 'sqlite',
      databaseProfileId: document.database.profileId,
      databaseRevision: 3,
      version: 7,
      status: 'active',
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  };
}
function pending(state: ProjectDocumentState, userId = 'actor-a'): NativePendingSave {
  return {
    userId,
    projectId: state.project.id,
    request: {
      operationId: 'operation',
      groupId: 'operation',
      clientId: 'client',
      expectedVersion: state.project.version,
      expectedSequence: state.sequence,
      expectedDatabaseRevision: state.project.databaseRevision,
      commands: [{ type: 'patch_domain', id: 'd', patch: { name: 'New' } }],
      includeDocument: true,
    },
  };
}
function elements(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
function mount(state = snapshot(), userId = 'actor-a') {
  const reload = vi.fn();
  let current = state,
    actor = userId,
    editable = true;
  let tree: ReturnType<typeof NativeProjectView>;
  function render(next = current, nextActor = actor, canEdit = editable) {
    current = next;
    actor = nextActor;
    editable = canEdit;
    driver.cursor = 0;
    tree = NativeProjectView({
      entry: {
        kind: 'native',
        snapshot: current,
        document: current.sourceDocument as ReturnType<typeof createEmptyNativeDocument>,
        personalUnavailable: false,
      },
      userId: actor,
      canEdit,
      onLeave() {},
      onReload: reload,
    });
    driver.effects.splice(0).forEach((effect) => effect());
    return elements(tree);
  }
  function canvas() {
    return render().find((node) => node.type === NativeERDCanvas)!;
  }
  function save() {
    return (canvas().props.onSave as (commands: unknown[]) => Promise<boolean>)([
      { type: 'patch_domain', id: 'd', patch: { name: 'New' } },
    ]);
  }
  render();
  return { render, canvas, save, reload };
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  vi.stubGlobal('sessionStorage', {
    getItem: () =>
      JSON.stringify({
        userId: 'actor-a',
        token: 'test-session',
        expiresAt: '2099-01-01T00:00:00Z',
      }),
  });
  driver.slots = [];
  driver.cursor = 0;
  driver.effects = [];
  vi.clearAllMocks();
  queue.state = 'empty';
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  io.load.mockResolvedValue(null);
});

describe('native project asynchronous pending calls', () => {
  it.each(['unknown', 'pending', 'sending'])(
    'blocks writers when another durable queue consumer reports %s',
    async (state) => {
      const ui = mount();
      await flush();
      queue.state = state;
      expect(ui.canvas().props.busy).toBe(true);
      await ui.save();
      expect(io.stage).not.toHaveBeenCalled();
    },
  );
  it('awaits durable load/stage before send, and retains the staged request after a lost ACK', async () => {
    const baseline = snapshot(),
      staged = pending(baseline),
      wait = deferred<NativePendingSave>();
    const ui = mount(baseline);
    expect(ui.canvas().props.busy).toBe(true);
    await flush();
    io.stage.mockReturnValue(wait.promise);
    io.send.mockRejectedValue(new Error('Lost ACK'));
    const saving = ui.save();
    expect(io.stage).toHaveBeenCalledTimes(1);
    expect(io.send).not.toHaveBeenCalled();
    io.load.mockResolvedValue(staged);
    wait.resolve(staged);
    expect(await saving).toBe(false);
    expect(io.send).toHaveBeenCalledWith(staged, localStorage, expect.any(Function));
    expect(ui.canvas().props.busy).toBe(true);
    expect(
      ui.render().some((node) => node.props.role === 'alert' && node.props.children === 'Lost ACK'),
    ).toBe(true);
    expect(ui.reload).not.toHaveBeenCalled();
  });
  it('pins the same actor session before durable staging and refuses a replacement session', async () => {
    const state = snapshot(),
      staged = pending(state),
      wait = deferred<NativePendingSave>();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const ui = mount(state);
    await flush();
    io.stage.mockReturnValue(wait.promise);
    io.load.mockResolvedValue(staged);
    io.send.mockImplementation((_pending, _storage, actorApi) => actorApi('/test-pinned-session'));
    const saving = ui.save();
    vi.stubGlobal('sessionStorage', {
      getItem: () =>
        JSON.stringify({
          userId: 'actor-a',
          token: 'replacement-session',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
    });
    wait.resolve(staged);
    expect(await saving).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(ui.canvas().props.busy).toBe(true);
    expect(ui.reload).not.toHaveBeenCalled();
  });
  it('ignores delayed old-actor and old-project loads and refuses to send an old staged request', async () => {
    const oldLoad = deferred<NativePendingSave | null>(),
      newLoad = deferred<NativePendingSave | null>();
    io.load.mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(newLoad.promise);
    const ui = mount();
    ui.render(snapshot('project-b'), 'actor-b');
    newLoad.resolve(null);
    await flush();
    expect(ui.canvas().props.busy).toBe(false);
    oldLoad.resolve(pending(snapshot()));
    await flush();
    expect(ui.canvas().props.busy).toBe(false);
    const waiting = deferred<NativePendingSave>();
    io.stage.mockReturnValue(waiting.promise);
    const saving = ui.save();
    ui.render(snapshot('project-c'), 'actor-c');
    await flush();
    waiting.resolve(pending(snapshot('project-b'), 'actor-b'));
    expect(await saving).toBe(false);
    expect(io.send).not.toHaveBeenCalled();
    expect(ui.reload).not.toHaveBeenCalled();
    expect(ui.canvas().props.busy).toBe(false);
  });
  it.each(['permission', 'databaseRevision'])(
    'preserves staged input and refuses transmission after %s changes',
    async (reason) => {
      const state = snapshot(),
        staged = pending(state),
        wait = deferred<NativePendingSave>();
      const ui = mount(state);
      await flush();
      io.stage.mockReturnValue(wait.promise);
      const saving = ui.save();
      const changed = structuredClone(state);
      if (reason === 'databaseRevision') changed.project.databaseRevision++;
      ui.render(changed, 'actor-a', reason !== 'permission');
      wait.resolve(staged);
      expect(await saving).toBe(false);
      expect(io.send).not.toHaveBeenCalled();
      expect(ui.canvas().props.busy).toBe(true);
    },
  );
  it('keeps storage-unknown blocked and does not clear pending before discard completes', async () => {
    io.load.mockRejectedValueOnce(new Error('native.pending-storage-unknown'));
    const ui = mount();
    await flush();
    expect(ui.canvas().props.busy).toBe(true);
    await ui.save();
    expect(io.stage).not.toHaveBeenCalled();
    const retry = ui.render().find((node) => node.props.children === '저장 결과 확인')!;
    io.load.mockResolvedValue(pending(snapshot()));
    (retry.props.onClick as () => void)();
    await flush();
    const discard = ui.render().find((node) => node.props.children === '요청 취소 확정')!;
    const wait = deferred<{ status: 'rejected' }>();
    io.discard.mockReturnValue(wait.promise);
    (discard.props.onClick as () => void)();
    await flush();
    expect(ui.canvas().props.busy).toBe(true);
    expect(ui.render().some((node) => node.props.children === '요청 취소 확정')).toBe(true);
    io.load.mockResolvedValue(null);
    wait.resolve({ status: 'rejected' });
    await flush();
    await flush();
    expect(ui.canvas().props.busy).toBe(false);
    expect(ui.render().some((node) => node.props.children === '요청 취소 확정')).toBe(false);
  });
  it('retains pending and storage error when asynchronous discard fails', async () => {
    io.load.mockResolvedValue(pending(snapshot()));
    const ui = mount();
    await flush();
    io.discard.mockRejectedValue(new Error('native.pending-inflight'));
    const discard = ui.render().find((node) => node.props.children === '요청 취소 확정')!;
    (discard.props.onClick as () => void)();
    await flush();
    expect(ui.canvas().props.busy).toBe(true);
    expect(
      ui
        .render()
        .some(
          (node) =>
            node.props.role === 'alert' && node.props.children === 'native.pending-inflight',
        ),
    ).toBe(true);
  });
});

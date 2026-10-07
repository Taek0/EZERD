import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement } from 'react';
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
  enqueue: vi.fn(),
  flushIntent: vi.fn(),
  lookup: vi.fn(),
  intents: [] as { pending: { request: { operationId: string } } }[],
}));
const queue = vi.hoisted(() => ({ state: 'empty' }));
vi.mock('./native-export-state.js', () => ({
  useNativeDurableState: () => queue.state,
  useNativeExportBlocker() {},
  useNativeExportBlocked: () => false,
}));
vi.mock('./native-save.js', async (original) => ({
  ...(await original<typeof import('./native-save.js')>()),
  loadNativePending: io.load,
  stageNativeSave: io.stage,
  sendNativePending: io.send,
  cancelNativePending: io.discard,
  recoverNativePending: io.recover,
}));
vi.mock('./native-save-intents.js', () => ({
  enqueueNativeSave: io.enqueue,
  flushNativeSaveIntent: io.flushIntent,
  lookupNativeSaveIntentResult: io.lookup,
  nativeSaveIntents: () => io.intents,
  nativeRejectedSaveIntents: () => [],
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
function mount(
  state = snapshot(),
  userId = 'actor-a',
  projectActions?: Parameters<typeof NativeProjectView>[0]['projectActions'],
  onAcknowledged?: Parameters<typeof NativeProjectView>[0]['onAcknowledged'],
) {
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
      ...(onAcknowledged ? { onAcknowledged } : {}),
      ...(projectActions ? { projectActions } : {}),
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
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('navigator', { onLine: true });
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
  io.intents = [];
  io.flushIntent.mockResolvedValue(null);
  io.lookup.mockResolvedValue(null);
  io.enqueue.mockImplementation(() => {
    const operationId = `operation-${io.intents.length}`;
    io.intents.push({ pending: { request: { operationId } } });
    return operationId;
  });
  vi.useFakeTimers();
});

afterEach(() => {
  driver.slots.forEach((slot) => slot.cleanup?.());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('native project asynchronous pending calls', () => {
  it('starts transmission after the input event and uses a confirmed ACK without reopening the document', async () => {
    const acknowledged = vi.fn(() => true);
    const ui = mount(snapshot(), 'actor-a', undefined, acknowledged);
    await flush();
    io.flushIntent.mockClear();
    const serverAck = { status: 'accepted', operationId: 'operation-0' };
    io.flushIntent.mockImplementationOnce(async (...args: unknown[]) => {
      (args[5] as (ack: unknown) => void)(serverAck);
      return { operationId: 'operation-0', accepted: true };
    });
    const saved = ui.save();
    expect(io.enqueue).toHaveBeenCalledOnce();
    expect(io.flushIntent).not.toHaveBeenCalled();
    expect(ui.canvas().props.busy).toBe(false);
    await flush();
    expect(await saved).toBe(true);
    expect(acknowledged).toHaveBeenCalledWith(serverAck);
    expect(ui.reload).not.toHaveBeenCalled();
  });
  it('passes the PNG control to the shared toolbar renderer without rendering a second header menu', () => {
    const actions = vi.fn(() => createElement('span', null, 'Main actions'));
    const ui = mount(undefined, undefined, actions),
      png = { run: vi.fn(async () => {}), disabled: false, busy: false };
    const renderer = ui.canvas().props.renderExportActions as (control: typeof png) => ReactElement;
    expect(renderer(png)).toMatchObject({ props: { children: 'Main actions' } });
    expect(actions).toHaveBeenCalledWith(expect.any(Function), png);
  });
  it.each(['unknown', 'pending', 'sending'])(
    'keeps editing available while durable state is %s and retains a queued save',
    async (state) => {
      const ui = mount();
      await flush();
      queue.state = state;
      expect(ui.canvas().props.busy).toBe(false);
      void ui.save();
      expect(io.enqueue).toHaveBeenCalledTimes(1);
      expect(io.intents).toHaveLength(1);
    },
  );
  it('serializes queued callbacks without disabling canvas input during an outstanding ACK', async () => {
    const ui = mount();
    await flush();
    const waiting = deferred<{ operationId: string; accepted: boolean } | null>();
    io.flushIntent.mockReturnValueOnce(waiting.promise);
    const first = ui.save();
    void ui.save();
    expect(io.enqueue).toHaveBeenCalledTimes(2);
    expect(ui.canvas().props.busy).toBe(false);
    await flush();
    waiting.resolve({ operationId: 'operation-0', accepted: true });
    expect(await first).toBe(true);
    expect(ui.reload).toHaveBeenCalled();
  });
  it('retains input and reports unknown delivery while allowing subsequent edits', async () => {
    const ui = mount();
    await flush();
    io.flushIntent.mockRejectedValueOnce(Error('Lost ACK'));
    void ui.save();
    await flush();
    await flush();
    expect(io.intents).toHaveLength(1);
    expect(ui.canvas().props.busy).toBe(false);
    expect(
      ui.render().some((node) => node.props.role === 'alert' && node.props.children === 'Lost ACK'),
    ).toBe(true);
    expect(ui.reload).not.toHaveBeenCalled();
  });
  it('settles old actor callbacks and refuses further old-context transmission on identity change', async () => {
    const ui = mount();
    await flush();
    const waiting = deferred<null>();
    io.flushIntent.mockReturnValueOnce(waiting.promise);
    const saved = ui.save();
    await flush();
    const mayTransmit = io.flushIntent.mock.calls.at(-1)![4] as () => boolean;
    expect(mayTransmit()).toBe(true);
    ui.render(snapshot('project-b'), 'actor-b');
    expect(mayTransmit()).toBe(false);
    expect(await saved).toBe(false);
    waiting.resolve(null);
    await flush();
    expect(ui.reload).not.toHaveBeenCalled();
  });
  it.each(['permission', 'databaseRevision'])(
    'refuses the next transmission after %s changes, preserving local input',
    async (reason) => {
      const state = snapshot(),
        ui = mount(state);
      await flush();
      const waiting = deferred<null>();
      io.flushIntent.mockReturnValueOnce(waiting.promise);
      void ui.save();
      await flush();
      const mayTransmit = io.flushIntent.mock.calls.at(-1)![4] as () => boolean;
      const changed = structuredClone(state);
      if (reason === 'databaseRevision') changed.project.databaseRevision++;
      ui.render(changed, 'actor-a', reason !== 'permission');
      expect(mayTransmit()).toBe(false);
      expect(io.intents).toHaveLength(1);
      waiting.resolve(null);
      await flush();
      expect(ui.reload).not.toHaveBeenCalled();
    },
  );
  it('requires a verified result when another tab removes a queued intent', async () => {
    const ui = mount();
    await flush();
    const saved = ui.save();
    let settled = false;
    void saved.then(() => {
      settled = true;
    });
    await flush();
    const original = io.intents[0]!.pending;
    io.intents = [];
    await vi.advanceTimersByTimeAsync(4001);
    expect(io.lookup).toHaveBeenCalledWith(original, expect.any(Function), expect.any(Function));
    expect(settled).toBe(false);
    expect(ui.reload).not.toHaveBeenCalled();
    io.lookup.mockResolvedValueOnce(true);
    await vi.advanceTimersByTimeAsync(4001);
    expect(await saved).toBe(true);
    expect(ui.reload).toHaveBeenCalledTimes(1);
  });
  it('reports storage failure without disabling unrelated editors or dropping saved intents', async () => {
    const ui = mount();
    await flush();
    io.enqueue.mockImplementationOnce(() => {
      throw Error('storage-full');
    });
    expect(await ui.save()).toBe(false);
    expect(ui.canvas().props.busy).toBe(false);
    expect(
      ui
        .render()
        .some((node) => node.props.role === 'alert' && node.props.children === 'storage-full'),
    ).toBe(true);
  });
  it('retains pending cancellation until the server confirms it while leaving editors enabled', async () => {
    io.load.mockResolvedValue(pending(snapshot()));
    const ui = mount();
    await flush();
    (ui.canvas().props.onOpenRecovery as () => void)();
    const discard = ui.render().find((node) => node.props.children === '요청 취소 확정')!;
    const waiting = deferred<{ status: string }>();
    io.discard.mockReturnValue(waiting.promise);
    (discard.props.onClick as () => void)();
    expect(ui.canvas().props.busy).toBe(false);
    expect(ui.render().some((node) => node.props.children === '요청 취소 확정')).toBe(true);
    io.load.mockResolvedValue(null);
    waiting.resolve({ status: 'rejected' });
    await flush();
    await flush();
    expect(ui.render().some((node) => node.props.children === '요청 취소 확정')).toBe(false);
  });
});

import {
  createHookDriverState,
  type HookDriverState,
} from '../../shared/testing/react-hook-driver.js';
import { elementNodes as nodes } from '../../shared/testing/react-element-tree.js';
import {
  readNativeLocalDraftNames,
  projectNativeLocalDraftNames,
} from './native-local-draft-names.js';
import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';
vi.mock('./NativeLogicalMode.js', () => ({ useNativeLogicalMode: () => ({ enabled: true }) }));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativePropertyEditor } from './NativePropertyEditor.js';

import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
import { loadNativeDraft } from './native-save.js';

// Exercise the actual submit registration, field callback and native storage in Node;
// this driver models committed effects without claiming DOM or browser interaction coverage.
const hooks = vi.hoisted(() => ({
  active: null as HookDriverState | null,
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('../../shared/i18n/index.js', () => ({
  useI18n: () => ({ t: (value: string) => value }),
  registerTranslations() {},
}));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  const { mockReactHooks } = await import('../../shared/testing/react-hook-driver.js');
  return mockReactHooks(actual, () => hooks.active);
});

function fixture(save = vi.fn(async () => true)) {
  const state = createHookDriverState();
  const snapshot = decorationSnapshot();
  if (snapshot.native.status !== 'available') throw Error();
  const column = snapshot.native.document.columns![0]!;
  column.logical.name = '';
  const props: Parameters<typeof NativePropertyEditor>[0] = {
    userId: decorationUserId,
    snapshot,
    table: snapshot.native.document.tables![0]!,
    column,
    busy: false,
    onSave: save,
    mode: 'physical',
  };
  let change!: (event: { target: { value: string } }) => void;
  return {
    props,
    save,
    snapshot,
    column,
    render() {
      hooks.active = state;
      state.cursor = 0;
      try {
        const tree = NativePropertyEditor(props);
        change = nodes(tree).find(
          (n) => typeof n.props.onChange === 'function' && n.props.maxLength === 120,
        )!.props.onChange as typeof change;
        state.effects.splice(0).forEach((f) => f());
        return tree;
      } finally {
        hooks.active = null;
      }
    },
    change: (value: string) => change({ target: { value } }),
    unmount: () => state.slots.forEach((s) => s.cleanup?.()),
    draft: () => loadNativeDraft(decorationUserId, snapshot.project.id, 'column', column.id),
  };
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('property autosave lifecycle', () => {
  it('flushes input immediately before selection change without requiring a rerender', async () => {
    vi.useFakeTimers();
    const ui = fixture();
    ui.render();
    ui.change('typed');
    ui.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.save).toHaveBeenCalledTimes(1);
    expect(ui.draft()).toBeNull();
  });
  it('drains input typed during ACK after unmount and retains only the pending revision', async () => {
    vi.useFakeTimers();
    const a: ((value: boolean) => void)[] = [];
    const save = vi.fn(() => new Promise<boolean>((resolve) => a.push(resolve)));
    const ui = fixture(save);
    ui.render();
    ui.change('first');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.props.busy = true;
    ui.render();
    ui.change('last');
    ui.render();
    ui.unmount();
    a[0]!(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      (save.mock.calls[1] as unknown as [Array<{ patch: { physical: { name: string } } }>])[0][0]!
        .patch.physical.name,
    ).toBe('last');
    expect(ui.draft()?.before.physicalName).toBe('first');
    expect(ui.draft()?.values.physicalName).toBe('last');
    a[1]!(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.draft()).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('rebases against an ACK snapshot already observed and saves the next edit with its sequence', async () => {
    vi.useFakeTimers();
    let ack!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          ack = r;
        }),
    );
    const ui = fixture(save);
    ui.render();
    ui.change('first');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.change('next');
    ui.column.physical.name = 'first';
    ui.snapshot.sequence++;
    ui.snapshot.project.version++;
    ui.render();
    ack(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.render();
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1] as unknown as [unknown, { sequence: number }])[1].sequence).toBe(
      ui.snapshot.sequence,
    );
    ack(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.unmount();
  });
  it('does not consume a revert edit when an unrelated snapshot precedes ACK', async () => {
    vi.useFakeTimers();
    let ack!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          ack = r;
        }),
    );
    const ui = fixture(save);
    const original = ui.column.physical.name;
    ui.render();
    ui.change('first');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.change(original);
    ui.snapshot.sequence++;
    ui.snapshot.project.version++;
    ui.render();
    ack(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.render();
    ui.render();
    expect(ui.draft()?.values.physicalName).toBe(original);
    expect(ui.draft()?.before.physicalName).toBe('first');
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      (save.mock.calls[1] as unknown as [Array<{ patch: { physical: { name: string } } }>])[0][0]!
        .patch.physical.name,
    ).toBe(original);
    ack(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.unmount();
  });
});

it('projects a name before 750ms while the server quiet window batches only the latest input', async () => {
  vi.useFakeTimers();
  const ui = fixture();
  ui.render();
  ui.change('early');
  ui.render();
  const projected = () =>
    projectNativeLocalDraftNames(
      ui.snapshot.native.status === 'available' ? ui.snapshot.native.document : neverDoc(),
      readNativeLocalDraftNames(decorationUserId, ui.snapshot.project.id),
      3,
    ).document;
  expect(projected().columns![0]!.physical.name).toBe('early');
  expect(ui.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  ui.change('latest');
  ui.render();
  expect(projected().columns![0]!.physical.name).toBe('latest');
  await vi.advanceTimersByTimeAsync(749);
  expect(ui.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(ui.save).toHaveBeenCalledTimes(1);
  expect((ui.save.mock.calls[0] as unknown as [unknown])[0]).toMatchObject([
    { patch: { physical: { name: 'latest' } } },
  ]);
});
function neverDoc(): never {
  throw Error('Expected Native fixture');
}
it('rebases an unsent name on the confirmed snapshot instead of its own projected props', async () => {
  vi.useFakeTimers();
  const ui = fixture();
  ui.render();
  ui.change('local_unsent');
  ui.render();
  const doc = structuredClone(ui.snapshot.sourceDocument);
  if (doc.schemaVersion !== 2) throw Error();
  doc.columns![0]!.physical.name = 'remote_ack';
  ui.props.column = { ...ui.column, physical: { ...ui.column.physical, name: 'local_unsent' } };
  ui.props.snapshot = {
    ...ui.snapshot,
    sequence: 11,
    project: { ...ui.snapshot.project, version: 8 },
    sourceDocument: doc,
    native: { status: 'available', document: doc, issues: [], migrationIssues: [] },
  };
  ui.render();
  ui.render();
  expect(ui.draft()?.before.physicalName).toBe('remote_ack');
  expect(ui.draft()?.values.physicalName).toBe('local_unsent');
  await vi.advanceTimersByTimeAsync(750);
  expect(ui.save).toHaveBeenCalledTimes(1);
});

it('keeps later input visible while an earlier ACK waits and sends only its latest value next', async () => {
  vi.useFakeTimers();
  const acknowledgements: ((accepted: boolean) => void)[] = [];
  const save = vi.fn(() => new Promise<boolean>((resolve) => acknowledgements.push(resolve)));
  const ui = fixture(save);
  ui.render();
  ui.change('first_request');
  ui.render();
  await vi.advanceTimersByTimeAsync(750);
  expect(save).toHaveBeenCalledTimes(1);
  const originalRequest = JSON.stringify(save.mock.calls[0]);
  ui.change('intermediate');
  ui.render();
  await vi.advanceTimersByTimeAsync(400);
  ui.change('latest_local');
  ui.render();
  await vi.advanceTimersByTimeAsync(750);
  const doc = ui.snapshot.native.status === 'available' ? ui.snapshot.native.document : neverDoc();
  expect(
    projectNativeLocalDraftNames(
      doc,
      readNativeLocalDraftNames(decorationUserId, ui.snapshot.project.id),
      3,
    ).document.columns![0]!.physical.name,
  ).toBe('latest_local');
  expect(save).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(save.mock.calls[0])).toBe(originalRequest);
  acknowledgements[0]!(true);
  await vi.advanceTimersByTimeAsync(0);
  ui.render();
  ui.render();
  await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledTimes(2);
  expect((save.mock.calls[1] as unknown as [unknown])[0]).toMatchObject([
    { patch: { physical: { name: 'latest_local' } } },
  ]);
  acknowledgements[1]!(true);
  await vi.advanceTimersByTimeAsync(0);
});

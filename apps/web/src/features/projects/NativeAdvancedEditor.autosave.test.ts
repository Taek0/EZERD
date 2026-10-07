import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NativeAdvancedEditor,
  NativeAdvancedExpressionForm,
  NativeAdvancedIndexForm,
} from './NativeAdvancedEditor.js';
import { NativeEditorForm } from './native-editor-form.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import type { NativeWebCommand } from './native-save.js';

// Run the real advanced form, shared form, autosave timer and durable draft code.
// This committed-hook driver is not a browser/DOM interaction test.
const hooks = vi.hoisted(() => ({
  dirty: false,
  active: null as null | {
    slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined }[];
    cursor: number;
    effects: (() => void)[];
  },
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('../../shared/i18n/index.js', () => ({
  useI18n: () => ({ t: (value: string) => value }),
  registerTranslations() {},
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const effect = (callback: () => void | (() => void), deps?: readonly unknown[]) => {
    const active = hooks.active!;
    const slot = (active.slots[active.cursor++] ??= {});
    if (!deps || !slot.deps || deps.some((value, i) => !Object.is(value, slot.deps![i]))) {
      active.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = callback() || undefined;
      });
      if (deps) slot.deps = deps;
    }
  };
  return {
    ...react,
    useState(initial: unknown) {
      const slot = (hooks.active!.slots[hooks.active!.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (update: unknown) => {
          const next = typeof update === 'function' ? update(slot.value) : update;
          if (!Object.is(next, slot.value)) hooks.dirty = true;
          slot.value = next;
        },
      ];
    },
    useRef(initial: unknown) {
      return (hooks.active!.slots[hooks.active!.cursor++] ??= { value: { current: initial } })
        .value;
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const slot = (hooks.active!.slots[hooks.active!.cursor++] ??= {});
      if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps![i]))) {
        slot.value = factory();
        slot.deps = deps;
      }
      return slot.value;
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
});
function host() {
  return {
    slots: [] as NonNullable<typeof hooks.active>['slots'],
    cursor: 0,
    effects: [] as (() => void)[],
  };
}
function render<T>(state: ReturnType<typeof host>, callback: () => T): T {
  hooks.active = state;
  state.cursor = 0;
  try {
    const output = callback();
    state.effects.splice(0).forEach((effect) => effect());
    return output;
  } finally {
    hooks.active = null;
  }
}
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function driver(kind: 'index' | 'check', f = advancedFixture()) {
  const advanced = host(),
    form = host();
  const pending: { commands: NativeWebCommand[]; resolve: (accepted: boolean) => void }[] = [];
  const onSave = vi.fn(
    (commands: NativeWebCommand[]) =>
      new Promise<boolean>((resolve) => {
        pending.push({ commands, resolve });
      }),
  );
  let values!: Record<string, string>;
  let change!: (field: string, value: string) => void;
  let props!: Parameters<typeof NativeEditorForm>[0];
  const api = {
    f,
    pending,
    onSave,
    render() {
      for (let pass = 0; pass < 30; pass++) {
        hooks.dirty = false;
        const context = { ...f.context, snapshot: f.snapshot, onSave };
        const tree = render(advanced, () =>
          kind === 'index'
            ? NativeAdvancedIndexForm({ context, document: f.document, table: f.table })
            : NativeAdvancedExpressionForm({
                context,
                document: f.document,
                table: f.table,
                target: { kind: 'check', id: 'unused-selection-id', create: true },
              }),
        );
        props = nodes(tree).find((node) => node.type === NativeEditorForm)!.props as typeof props;
        render(form, () =>
          NativeEditorForm({
            ...props,
            children(current, update) {
              values = current;
              change = update;
              return null;
            },
          }),
        );
        if (!hooks.dirty) return;
      }
      throw Error('hook driver did not settle');
    },
    values: () => values,
    props: () => props,
    change(field: string, value: string) {
      change(field, value);
      api.render();
    },
    name(name: string) {
      api.change(
        kind === 'index' ? 'indexDraftJSON' : 'name',
        kind === 'index' ? JSON.stringify({ ...JSON.parse(values.indexDraftJSON!), name }) : name,
      );
    },
    async tick() {
      await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
      api.render();
    },
    async ack(position = 0, accepted = true) {
      pending[position]!.resolve(accepted);
      await vi.advanceTimersByTimeAsync(0);
      api.render();
    },
    publish(position = 0) {
      const document = structuredClone(f.document);
      for (const command of pending[position]!.commands) {
        if (command.type === 'add_index')
          document.indexes = [...(document.indexes ?? []), command.value];
        else if (command.type === 'add_check')
          document.checks = [...(document.checks ?? []), command.value];
        else if (command.type === 'patch_index')
          document.indexes = document.indexes!.map((index) =>
            index.id === command.id ? { ...index, ...command.patch } : index,
          );
        else if (command.type === 'patch_check')
          document.checks = document.checks!.map((check) =>
            check.id === command.id ? { ...check, ...command.patch } : check,
          );
        else throw Error(`Unexpected command ${command.type}`);
      }
      api.document(document);
    },
    document(document: typeof f.document) {
      f.document = document;
      f.snapshot = {
        ...f.snapshot,
        sequence: f.snapshot.sequence + 1,
        project: { ...f.snapshot.project, version: f.snapshot.project.version + 1 },
        sourceDocument: document,
        native: { status: 'available', document, migrationIssues: [], issues: [] },
      };
      api.render();
    },
    draft: () => loadNativeEditorDraft(f.context.userId, f.snapshot.project.id, props.draftKey),
  };
  api.render();
  return api;
}
beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(['index', 'check'] as const)('advanced %s autosave continuation', (kind) => {
  it.each(['ack-first', 'document-first'] as const)(
    'adds once then patches in-flight and later input (%s)',
    async (order) => {
      const d = driver(kind);
      await d.tick();
      expect(d.onSave).not.toHaveBeenCalled();
      d.name('first');
      await d.tick();
      expect(d.pending).toHaveLength(1);
      expect(d.pending[0]!.commands[0]!.type).toBe(`add_${kind}`);
      const id = d.values().id;
      d.name('typed_before_ack');
      await d.tick();
      expect(d.pending).toHaveLength(1);
      if (order === 'ack-first') {
        await d.ack();
        await d.tick();
        expect(d.pending).toHaveLength(1);
        expect(d.props().context.busy).toBe(false);
        d.publish();
      } else {
        d.publish();
        await d.tick();
        expect(d.pending).toHaveLength(1);
        await d.ack();
      }
      expect(d.values().id).toBe(id);
      if (kind === 'check') expect(d.values().mode).toBe('replace');
      await d.tick();
      expect(d.pending).toHaveLength(2);
      expect(d.pending[1]!.commands).toMatchObject([
        { type: `patch_${kind}`, id, patch: { name: 'typed_before_ack' } },
      ]);
      d.publish(1);
      await d.ack(1);
      d.name('typed_after_ack');
      await d.tick();
      expect(d.pending).toHaveLength(3);
      expect(d.pending[2]!.commands).toMatchObject([
        { type: `patch_${kind}`, id, patch: { name: 'typed_after_ack' } },
      ]);
      expect(kind === 'index' ? d.f.document.indexes : d.f.document.checks).toHaveLength(1);
    },
  );
  it('restores the archived creation id without saving on mount or recovery', async () => {
    const d = driver(kind);
    const before = d.props().initial;
    const values =
      kind === 'index'
        ? {
            ...before,
            indexDraftJSON: JSON.stringify({
              ...JSON.parse(before.indexDraftJSON!),
              name: 'recovered',
            }),
          }
        : { ...before, name: 'recovered' };
    storeNativeEditorDraft({
      userId: d.f.context.userId,
      projectId: d.f.snapshot.project.id,
      key: d.props().draftKey,
      revision: crypto.randomUUID(),
      before,
      values,
      expected: {
        version: d.f.snapshot.project.version,
        sequence: d.f.snapshot.sequence,
        databaseRevision: d.f.snapshot.project.databaseRevision,
      },
    });
    const restored = driver(kind, d.f);
    await restored.tick();
    expect(restored.values()).toEqual(values);
    expect(restored.onSave).not.toHaveBeenCalled();
    restored.name('explicit_edit');
    await restored.tick();
    expect(restored.pending[0]!.commands).toMatchObject([
      { type: `add_${kind}`, value: { id: before.id, name: 'explicit_edit' } },
    ]);
  });
  it('accepts more input after ACK while waiting for the document and then emits only patch', async () => {
    const d = driver(kind);
    d.name('first');
    await d.tick();
    const id = d.values().id;
    await d.ack();
    d.name('after_ack_before_document');
    await d.tick();
    expect(d.pending).toHaveLength(1);
    expect(d.props().context.busy).toBe(false);
    expect(d.draft()!.values.id).toBe(id);
    d.publish();
    await d.tick();
    expect(d.pending).toHaveLength(2);
    expect(d.pending[1]!.commands).toMatchObject([
      { type: `patch_${kind}`, id, patch: { name: 'after_ack_before_document' } },
    ]);
  });
  it('preserves incomplete input typed before ACK and never recreates a deleted accepted target', async () => {
    const d = driver(kind);
    d.name('first');
    await d.tick();
    const incomplete = JSON.stringify({ kind: 'literal', literalType: 'number', value: '20e' });
    if (kind === 'index') {
      const index = JSON.parse(d.values().indexDraftJSON!);
      index.parts[0].expression = JSON.parse(incomplete);
      d.change('indexDraftJSON', JSON.stringify(index));
    } else d.change('expressionDraftJSON', incomplete);
    const retained = kind === 'index' ? d.values().indexDraftJSON : d.values().expressionDraftJSON;
    d.publish();
    await d.ack();
    await d.tick();
    expect(d.pending).toHaveLength(1);
    expect(
      kind === 'index' ? d.draft()!.values.indexDraftJSON : d.draft()!.values.expressionDraftJSON,
    ).toBe(retained);
    // Repair first so deletion, rather than the incomplete token, blocks add.
    if (kind === 'index') {
      const index = JSON.parse(d.values().indexDraftJSON!);
      index.parts[0].expression = { kind: 'column', columnId: 'a' };
      d.change('indexDraftJSON', JSON.stringify(index));
    } else {
      d.change(
        'expressionDraftJSON',
        JSON.stringify({ kind: 'literal', literalType: 'boolean', value: 'true' }),
      );
    }
    d.document({ ...d.f.document, indexes: [], checks: [] });
    d.name('must_not_recreate');
    await d.tick();
    expect(d.pending).toHaveLength(1);
  });
  it('recovers post-ACK pending input as a patch only after an explicit edit', async () => {
    const d = driver(kind);
    d.name('first');
    await d.tick();
    d.name('pending_recovery');
    d.publish();
    await d.ack();
    const archived = d.draft()!;
    expect(archived).not.toBeNull();
    vi.clearAllTimers();
    const restored = driver(kind, d.f);
    await restored.tick();
    expect(restored.values().id).toBe(archived.values.id);
    expect(kind === 'index' ? restored.values().indexDraftJSON : restored.values().name).toBe(
      kind === 'index' ? archived.values.indexDraftJSON : archived.values.name,
    );
    expect(restored.onSave).not.toHaveBeenCalled();
    restored.name('edited_after_recovery');
    await restored.tick();
    expect(restored.pending[0]!.commands).toMatchObject([
      { type: `patch_${kind}`, id: archived.values.id, patch: { name: 'edited_after_recovery' } },
    ]);
  });
  it('keeps rejected creation input and retries only after another edit', async () => {
    const d = driver(kind);
    d.name('rejected');
    await d.tick();
    const id = d.values().id;
    await d.ack(0, false);
    await d.tick();
    expect(d.pending).toHaveLength(1);
    expect(d.draft()!.values.id).toBe(id);
    d.name('retry_edit');
    await d.tick();
    expect(d.pending[1]!.commands).toMatchObject([
      { type: `add_${kind}`, value: { id, name: 'retry_edit' } },
    ]);
  });
});

it('keeps advanced form keys stable across ACK revisions but isolates explicit recovery', () => {
  const f = advancedFixture(),
    wrapper = host(),
    content = host();
  const key = (recoveryRevision?: string) => {
    const element = render(wrapper, () =>
      NativeAdvancedEditor({
        context: { ...f.context, snapshot: f.snapshot },
        document: f.document,
        table: f.table,
        ...(recoveryRevision ? { recoveryRevision } : {}),
      }),
    ) as ReactElement;
    const component = element.type as unknown as { type: (props: unknown) => unknown };
    return nodes(render(content, () => component.type(element.props))).find(
      (node) => node.type === NativeAdvancedIndexForm,
    )!.key;
  };
  const first = key();
  f.snapshot = {
    ...f.snapshot,
    sequence: f.snapshot.sequence + 1,
    project: { ...f.snapshot.project, version: f.snapshot.project.version + 1 },
  };
  expect(key()).toBe(first);
  expect(key('explicit-recovery')).not.toBe(first);
});

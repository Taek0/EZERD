import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeEditorForm, type NativeEditorContext } from './native-editor-form.js';
import { NativeDomainEditor, NativeDomainForm } from './NativeDomainEditor.js';
import {
  NativeDomainRelationEditor,
  NativeDomainRelationForm,
} from './NativeDomainRelationEditor.js';
import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import type { NativeWebCommand } from './native-save.js';
// Exercise the actual submit registration, field callback and native storage in Node;
// this driver models committed effects without claiming DOM or browser interaction coverage.
const hooks = vi.hoisted(() => ({
  active: null as null | {
    slots: {
      value?: unknown;
      deps?: readonly unknown[] | undefined;
      cleanup?: (() => void) | undefined;
    }[];
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
    if (
      !deps ||
      !slot.deps ||
      deps.length !== slot.deps.length ||
      deps.some((value, i) => !Object.is(value, slot.deps![i]))
    ) {
      active.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = callback() || undefined;
      });
      slot.deps = deps;
    }
  };
  return {
    ...react,
    useState(initial: unknown) {
      const active = hooks.active!;
      const slot = (active.slots[active.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (value: unknown) => {
          slot.value = typeof value === 'function' ? value(slot.value) : value;
        },
      ];
    },
    useRef(initial: unknown) {
      const active = hooks.active!;
      return (active.slots[active.cursor++] ??= { value: { current: initial } }).value;
    },
    useLayoutEffect: effect,
    useEffect: effect,
  };
});
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

function state() {
  return {
    slots: [] as NonNullable<typeof hooks.active>['slots'],
    cursor: 0,
    effects: [] as (() => void)[],
  };
}
function render<T>(driver: ReturnType<typeof state>, run: () => T) {
  hooks.active = driver;
  driver.cursor = 0;
  try {
    const tree = run();
    driver.effects.splice(0).forEach((effect) => effect());
    return tree;
  } finally {
    hooks.active = null;
  }
}
function fixture(kind: 'domain' | 'relation') {
  const snapshot = decorationSnapshot();
  if (snapshot.native?.status !== 'available') throw Error('Missing native document');
  const document = snapshot.native.document;
  const saves: NativeWebCommand[][] = [];
  const acknowledgements: ((accepted: boolean) => void)[] = [];
  const context: NativeEditorContext = {
    userId: decorationUserId,
    snapshot,
    busy: false,
    onSave: vi.fn((commands) => {
      saves.push(commands);
      return new Promise<boolean>((resolve) => acknowledgements.push(resolve));
    }),
  };
  const outer = state(),
    inner = state();
  let values!: Record<string, string>, change!: (key: string, value: string) => void;
  let formProps!: Parameters<typeof NativeEditorForm>[0];
  function draw() {
    const form = render(outer, () =>
      kind === 'domain'
        ? NativeDomainForm({ document, context, action: 'create', id: '' })
        : NativeDomainRelationForm({
            document,
            context,
            action: 'create',
            id: '',
            choices: document.domains.map((d) => ({ value: d.id, label: d.name })),
          }),
    );
    formProps = form.props;
    return render(inner, () =>
      NativeEditorForm({
        ...formProps,
        children: (v, c) => {
          values = v;
          change = c;
          return null;
        },
      }),
    );
  }
  function applyCreate() {
    const command = saves[0]![0]!;
    if (command.type === 'add_domain') document.domains.push(command.value);
    else if (command.type === 'add_domain_relation') document.domainRelations.push(command.value);
    else throw Error('Expected creation');
    snapshot.sequence++;
    snapshot.project.version++;
  }
  return {
    context,
    snapshot,
    document,
    saves,
    acknowledgements,
    draw,
    applyCreate,
    change: (key: string, value: string) => change(key, value),
    values: () => values,
    props: () => formProps,
    draft: () => loadNativeEditorDraft(context.userId, snapshot.project.id, formProps.draftKey),
    unmount: () => inner.slots.forEach((slot) => slot.cleanup?.()),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(['domain', 'relation'] as const)('%s autosave integration', (kind) => {
  it('keeps the form identity across ACK and database context updates', () => {
    const ui = fixture(kind),
      driver = state();
    const draw = () =>
      render(driver, () =>
        kind === 'domain'
          ? NativeDomainEditor({
              document: ui.document,
              snapshot: ui.snapshot,
              userId: decorationUserId,
              editable: true,
              busy: false,
              onSave: ui.context.onSave,
              selectedDomainId: 'a',
            })
          : NativeDomainRelationEditor({
              document: ui.document,
              context: ui.context,
              editable: true,
              selectedId: 'r',
            }),
      );
    const target = kind === 'domain' ? NativeDomainForm : NativeDomainRelationForm;
    const key = nodes(draw()).find((node) => node.type === target)!.key;
    ui.snapshot.sequence++;
    ui.snapshot.project.version++;
    ui.snapshot.project.databaseRevision++;
    expect(nodes(draw()).find((node) => node.type === target)!.key).toBe(key);
  });
  it('keeps newer input and switches from add to patch without replacing the draft', async () => {
    const ui = fixture(kind);
    ui.draw();
    const key = ui.props().draftKey;
    ui.change('name', 'first');
    ui.draw();
    await vi.advanceTimersByTimeAsync(300);
    expect(ui.saves).toHaveLength(1);
    ui.change('name', 'second');
    ui.draw();
    ui.acknowledgements[0]!(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.draw();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.saves).toHaveLength(1);
    expect(ui.draft()?.values.name).toBe('second');
    ui.applyCreate();
    ui.draw();
    ui.draw();
    await vi.advanceTimersByTimeAsync(300);
    expect(ui.props().draftKey).toBe(key);
    expect(ui.values().name).toBe('second');
    expect(ui.saves).toHaveLength(2);
    expect(ui.saves[1]![0]).toMatchObject({
      type: kind === 'domain' ? 'patch_domain' : 'patch_domain_relation',
      patch: { name: 'second' },
    });
    ui.acknowledgements[1]!(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.draw();
    ui.unmount();
  });
  it('preserves a rejected creation and retries with the same object ID after a new edit', async () => {
    const ui = fixture(kind);
    ui.draw();
    ui.change('name', 'first');
    ui.draw();
    await vi.advanceTimersByTimeAsync(300);
    ui.acknowledgements[0]!(false);
    await vi.advanceTimersByTimeAsync(0);
    ui.draw();
    const id = ui.values().id;
    expect(ui.draft()?.values.name).toBe('first');
    ui.change('name', 'retry');
    ui.draw();
    await vi.advanceTimersByTimeAsync(300);
    expect(ui.saves[1]![0]).toMatchObject({
      type: kind === 'domain' ? 'add_domain' : 'add_domain_relation',
      value: { id, name: 'retry' },
    });
    ui.acknowledgements[1]!(false);
    await vi.advanceTimersByTimeAsync(0);
    ui.unmount();
  });
  it('does not repeat creation when unmounted during the first ACK', async () => {
    const ui = fixture(kind);
    ui.draw();
    ui.change('name', 'first');
    ui.draw();
    await vi.advanceTimersByTimeAsync(300);
    ui.change('name', 'newer');
    ui.draw();
    ui.unmount();
    ui.acknowledgements[0]!(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.saves).toHaveLength(1);
    expect(ui.draft()?.values.name).toBe('newer');
  });
  it('restores a creation draft for an already saved object without creating it again', async () => {
    const original = fixture(kind);
    original.draw();
    const initial = original.props().initial;
    const id = initial.id!;
    if (kind === 'domain') original.document.domains.push({ id, name: 'saved', description: '' });
    else
      original.document.domainRelations.push({
        id,
        name: 'saved',
        description: '',
        sourceDomainId: 'a',
        targetDomainId: 'b',
        direction: 'forward',
      });
    storeNativeEditorDraft({
      userId: decorationUserId,
      projectId: original.snapshot.project.id,
      key: original.props().draftKey,
      revision: '00000000-0000-4000-8000-000000000099',
      expected: {
        version: original.snapshot.project.version,
        sequence: original.snapshot.sequence,
        databaseRevision: original.snapshot.project.databaseRevision,
      },
      before: { ...initial },
      values: { ...initial, name: 'recovered' },
    });
    const resumed = fixture(kind);
    resumed.document.domains = original.document.domains;
    resumed.document.domainRelations = original.document.domainRelations;
    resumed.draw();
    await vi.advanceTimersByTimeAsync(1000);
    expect(resumed.saves).toHaveLength(0);
    expect(resumed.values().name).toBe('recovered');
    expect(resumed.values().id).toBe(id);
    resumed.change('description', 'continued');
    resumed.draw();
    await vi.advanceTimersByTimeAsync(300);
    expect(resumed.saves[0]![0]).toMatchObject({
      type: kind === 'domain' ? 'patch_domain' : 'patch_domain_relation',
      id,
      patch: { name: 'recovered', description: 'continued' },
    });
    resumed.acknowledgements[0]!(true);
    await vi.advanceTimersByTimeAsync(0);
    resumed.unmount();
  });
});

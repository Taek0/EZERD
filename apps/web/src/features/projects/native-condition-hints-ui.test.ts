vi.mock('./NativeLogicalMode.js', () => ({ useNativeLogicalMode: () => ({ enabled: true }) }));
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  type DatabaseKind,
  type NativeColumnType,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { setLocale } from '../../shared/i18n/index.js';
import { nativeEditorConditionText } from './native-editor-diagnostic.js';
import { NativeOrderedColumns } from './native-editor-structure.js';
import { nativeKeyColumnPolicies, nativeLiteralPolicy } from './native-editor-option-policy.js';
import { NativeFormatEditor, nativeFormatInitial } from './native-editor-format.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { NativeEditorField, NativeEditorForm } from './native-editor-form.js';
import { nativeEditorExportBlocked } from './native-export-state.js';

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
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  function effectHook(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const active = hooks.active!,
      slot = (active.slots[active.cursor++] ??= {});
    if (!deps || !slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index]))) {
      active.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
      slot.deps = deps;
    }
  }
  return {
    ...react,
    useState(initial: unknown) {
      if (!hooks.active) return react.useState(initial);
      const slot = (hooks.active.slots[hooks.active.cursor++] ??= {
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
      if (!hooks.active) return react.useRef(initial);
      return (hooks.active.slots[hooks.active.cursor++] ??= { value: { current: initial } }).value;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      return hooks.active ? effectHook(effect, deps) : react.useEffect(effect, deps);
    },
    useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      return hooks.active ? effectHook(effect, deps) : react.useLayoutEffect(effect, deps);
    },
    useSyncExternalStore(...args: Parameters<typeof react.useSyncExternalStore>) {
      return hooks.active ? args[1]() : react.useSyncExternalStore(...args);
    },
  };
});
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function root() {
  const state: NonNullable<typeof hooks.active> = { slots: [], cursor: 0, effects: [] };
  return {
    render<T>(render: () => T): T {
      hooks.active = state;
      state.cursor = 0;
      try {
        const tree = render();
        state.effects.splice(0).forEach((effect) => effect());
        return tree;
      } finally {
        hooks.active = null;
      }
    },
    unmount() {
      state.slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

function fixture(kind: DatabaseKind = 'postgresql') {
  const database = defaultDatabaseContext(kind);
  const table = createNativeTable(database, 't', null, 'physical');
  table.physical.name = 'records';
  const column = createNativeColumn(database, table, 'c');
  column.physical.name = 'item_id';
  column.physical.type = {
    kind: 'builtin',
    database: kind,
    typeId:
      kind === 'postgresql'
        ? 'postgresql:integer'
        : kind === 'mysql'
          ? 'mysql:int'
          : 'sqlite:integer',
    parameters: {},
  } as NativeColumnType;
  const document = { ...createEmptyNativeDocument(database), tables: [table], columns: [column] };
  return { document, table, column };
}

afterEach(() => {
  setLocale('ko');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const keyConditions = [
  ['enum.definition-required', '프로젝트 ENUM', 'project ENUM'],
  ['table.mode-validation-required', 'STRICT·WITHOUT ROWID', 'STRICT and WITHOUT ROWID'],
  ['key.innodb-byte-limit', '3072바이트', '3072 bytes'],
  ['key.composite-byte-limit', '길이 합계', 'total encoded length'],
  ['key.btree-entry-size-limit', '긴 값의 크기', 'size of long values'],
  ['key.sqlite-null-rowid-semantics', '행 식별자', 'row identifier'],
] as const;

const boundedConditions = [
  ['default.literal-format-invalid', '기본값 형식', 'default value format'],
  ['default.literal-not-supported', '검증된 기본값 문법', 'verified default value syntax'],
  ['default.length-exceeded', '길이와 바이트 수', 'length and byte count'],
  ['default.pg-search-subset-unsupported', '128자', '128 characters'],
  ['default.pg-multirange-subset-unsupported', '빈 값 {}', 'empty value {}'],
  ['default.array-literal-not-supported', '선언 차원', 'Declared dimensions'],
  ['default.pg-snapshot-invalid', 'xmin:xmax:xip', 'xmin:xmax:xip'],
  ['default.pg-snapshot-counter-invalid', 'xmin ≤ xmax', 'xmin ≤ xmax'],
  ['default.pg-snapshot-xip-invalid', 'xmax 미만', 'below xmax'],
  ['default.pg-snapshot-xip-order-unsupported', '자동 정렬하지', 'not sorted automatically'],
  ['default.pg-snapshot-subset-limit', '최대 128개', 'at most 128'],
] as const;

describe('native key and bounded literal condition hints', () => {
  it.each(['ko', 'en'] as const)(
    'explains every known condition in %s without internal codes',
    (locale) => {
      setLocale(locale);
      for (const [code, ko, en] of [...keyConditions, ...boundedConditions]) {
        const text = nativeEditorConditionText(code);
        expect(text).toContain(locale === 'ko' ? ko : en);
        expect(text).not.toContain(code);
        expect(text).not.toContain('입력 항목을 확인하세요.');
      }
    },
  );

  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    '%s renders actual ready candidates as plain hints, keeping the selection enabled',
    (kind) => {
      setLocale('ko');
      const f = fixture(kind),
        original = structuredClone(f.document);
      const policies = nativeKeyColumnPolicies(f.document, f.table, 'primary', ['c']);
      expect(policies[0]).toMatchObject({ engineAllowed: true, productUsable: true });
      expect(policies[0]!.eligibility.conditions.length).toBeGreaterThan(0);
      const html = renderToStaticMarkup(
        createElement(NativeOrderedColumns, {
          document: f.document,
          tableId: 't',
          value: 'c',
          keyKind: 'primary',
          change: vi.fn(),
        }),
      );
      for (const code of policies[0]!.eligibility.conditions) {
        expect(html).toContain(nativeEditorConditionText(code));
        expect(html).not.toContain(code);
      }
      const selected = html.match(/<option\b[^>]*value="c"[^>]*>/)?.[0];
      expect(selected).toContain('selected=""');
      expect(selected).not.toContain('disabled');
      expect(html).not.toContain('제품 검증 미완료');
      expect(f.document).toEqual(original);
      expect(nativeKeyColumnPolicies(f.document, f.table, 'primary', ['c'])).toEqual(policies);
    },
  );

  it.each(['enum', 'declared'] as const)(
    'renders %s conditions from actual policy and preserves its existing selection',
    (variant) => {
      setLocale('ko');
      const f = fixture(variant === 'enum' ? 'postgresql' : 'sqlite');
      if (variant === 'enum') {
        f.column.physical.type = { kind: 'projectEnum', database: 'postgresql', enumId: 'e' };
        f.document.enums = [{ id: 'e', name: 'state', values: ['open'], schema: 'public' }];
      } else {
        f.column.physical.type = {
          kind: 'declared',
          database: 'sqlite',
          name: 'Custom text',
          numericArguments: [],
        };
      }
      const original = structuredClone(f.document);
      const code =
        variant === 'enum' ? 'enum.definition-required' : 'table.mode-validation-required';
      expect(
        nativeKeyColumnPolicies(f.document, f.table, 'primary', ['c'])[0]!.eligibility.conditions,
      ).toContain(code);
      const html = renderToStaticMarkup(
        createElement(NativeOrderedColumns, {
          document: f.document,
          tableId: 't',
          value: 'c',
          keyKind: 'primary',
          change: vi.fn(),
        }),
      );
      expect(html).toContain(nativeEditorConditionText(code));
      expect(html).not.toContain(code);
      const selected = html.match(/<option\b[^>]*value="c"[^>]*>/)?.[0];
      expect(selected).toContain('selected=""');
      expect(selected).not.toContain('disabled');
      expect(f.document).toEqual(original);
    },
  );

  it.each([
    { type: 'xml', value: '<root>', code: 'default.literal-format-invalid' },
    { type: 'jsonpath', value: '$.items[*]', code: 'default.literal-not-supported' },
    { type: 'tsquery', value: 'alpha & beta', code: 'default.pg-search-subset-unsupported' },
    { type: 'int4multirange', value: '{[1,3)}', code: 'default.pg-multirange-subset-unsupported' },
    { type: 'integer', array: true, value: '{1,2}', code: 'default.array-literal-not-supported' },
    {
      type: 'pg_snapshot',
      value: '10:20:11,10',
      code: 'default.pg-snapshot-xip-order-unsupported',
    },
  ])(
    'renders the actual $type bounded limitation while retaining the blocked raw draft',
    async ({ type, array, value, code }) => {
      vi.useFakeTimers();
      setLocale('ko');
      const f = fixture();
      f.column.physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: `postgresql:${type}`,
        parameters: {},
        ...(array ? { array: { dimensions: 1 } } : {}),
      } as NativeColumnType;
      expect(
        nativeLiteralPolicy(f.document, f.table, f.column, {
          kind: 'literal',
          literalType: 'typedText',
          value,
        }),
      ).toMatchObject({ engineAllowed: false, productUsable: false, code });
      const data = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
      });
      const context = {
        userId: crypto.randomUUID(),
        busy: false,
        onSave: vi.fn(async () => true),
        snapshot: {
          protocolVersion: 2,
          sequence: 11,
          project: {
            id: crypto.randomUUID(),
            workspaceId: crypto.randomUUID(),
            name: 'Native',
            status: 'active',
            version: 7,
            databaseKind: 'postgresql',
            databaseProfileId: f.document.database.profileId,
            databaseRevision: 3,
            createdAt: '2026-10-03T00:00:00Z',
            updatedAt: '2026-10-03T00:00:00Z',
          },
          sourceDocument: f.document,
          native: { status: 'available', document: f.document, issues: [], migrationIssues: [] },
        } as ProjectDocumentState,
      };
      const before = nativeFormatInitial(f.table, f.column),
        original = structuredClone(f.document);
      const draft = {
        userId: context.userId,
        projectId: context.snapshot.project.id,
        key: 'format:column:c',
        revision: crypto.randomUUID(),
        expected: { version: 7, sequence: 11, databaseRevision: 3 },
        before,
        values: { ...before, defaultChoice: 'literal:typedText', defaultValue: value },
      };
      storeNativeEditorDraft(draft);
      const html = renderToStaticMarkup(createElement(NativeFormatEditor, { ...f, context }));
      expect(html).toContain(nativeEditorConditionText(code));
      expect(html).not.toContain(code);
      expect(html).not.toContain('type="submit"');
      expect(loadNativeEditorDraft(draft.userId, draft.projectId, draft.key)).toEqual(draft);
      expect(f.document).toEqual(original);
      expect(context.onSave).not.toHaveBeenCalled();
      const editor = root(),
        form = root();
      const render = () => {
        const element = editor.render(() => NativeFormatEditor({ ...f, context }));
        return form.render(() => NativeEditorForm(element.props));
      };
      render();
      await vi.advanceTimersByTimeAsync(1000);
      expect(context.onSave).not.toHaveBeenCalled();
      // Arm autosave through a real field callback while retaining the invalid literal.
      const field = nodes(render()).find(
        (node) => node.type === NativeEditorField && node.props.label === '값',
      )!;
      expect(field).toBeDefined();
      (field.props.onChange as (value: string) => void)(value);
      render();
      await vi.advanceTimersByTimeAsync(1000);
      render();
      expect(context.onSave).not.toHaveBeenCalled();
      const retained = loadNativeEditorDraft(draft.userId, draft.projectId, draft.key)!;
      expect(retained.revision).not.toBe(draft.revision);
      expect(retained.values.defaultValue).toBe(value);
      expect(retained.values.defaultChoice).toBe('literal:typedText');
      expect(retained.before).toEqual(before);
      expect(nativeEditorExportBlocked(draft.userId, draft.projectId)).toBe(true);
      expect(f.document).toEqual(original);
      form.unmount();
      editor.unmount();
      await vi.advanceTimersByTimeAsync(1000);
      expect(context.onSave).not.toHaveBeenCalled();
    },
  );
});

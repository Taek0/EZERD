import { AnimatedDetails, Button } from '../../components/ui/index.js';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeDraftRecoveryPanel,
  type NativeDraftRecoveryPanelProps,
} from './NativeDraftRecoveryPanel.js';
import { NativeDraftArchive, nativeDraftArchive } from './native-draft-archive.js';
import { retainNativeMemoryDraft, listNativeMemoryDrafts } from './native-durable-drafts.js';
const hooks = vi.hoisted(() => ({ active: null as null | { slots: unknown[]; cursor: number } }));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (s: string) => s }),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const state = hooks.active!,
      i = state.cursor++;
    if (!(i in state.slots)) state.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      state.slots[i],
      (value: unknown) => {
        state.slots[i] = value;
      },
    ];
  },
  useRef(initial: unknown) {
    const state = hooks.active!,
      i = state.cursor++;
    return (state.slots[i] ??= { current: initial });
  },
  useEffect() {},
}));
function renderer() {
  const state = { slots: [] as unknown[], cursor: 0 };
  return (props: NativeDraftRecoveryPanelProps) => {
    hooks.active = state;
    state.cursor = 0;
    try {
      return NativeDraftRecoveryPanel(props);
    } finally {
      hooks.active = null;
    }
  };
}
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
const actor = '00000000-0000-4000-8000-000000000001',
  project = '00000000-0000-4000-8000-000000000002';
function fixture() {
  const data = new Map<string, string>(),
    storage = {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
  const draft = {
    userId: actor,
    projectId: project,
    key: 'column:deleted',
    revision: actor,
    expected: { version: 1, sequence: 2, databaseRevision: 3 },
    before: { token: '' },
    values: { token: '\n未完 "source" -' },
  };
  const props: NativeDraftRecoveryPanelProps = {
    userId: actor,
    projectId: project,
    currentExpected: { version: 2, sequence: 3, databaseRevision: 3 },
    storage,
    isActorCurrent: () => true,
    onRecovered: vi.fn(),
    onDownload: vi.fn(),
    isObjectAvailable: () => false,
  };
  return { draft, storage, props };
}
function click(tree: unknown, label: string, index = 0) {
  const button = nodes(tree).filter(
    (node) => node.type === Button && node.props.children === label,
  )[index]!;
  (button.props.onClick as () => void)();
}
const text = (tree: unknown, value: string) =>
  nodes(tree).some((node) => node.props.children === value);
afterEach(() => vi.restoreAllMocks());
describe('explicit native draft recovery panel', () => {
  it('shows closed/deleted draft source and stale basis; only a click creates a copy, keeping original expected', () => {
    const { draft, storage, props } = fixture(),
      archive = new NativeDraftArchive(storage, 'other-tab'),
      render = renderer();
    const original = archive.store('editor', draft.key, draft),
      record = archive.records(actor, project)[0]!;
    const tree = render(props);
    expect(props.onRecovered).not.toHaveBeenCalled();
    expect(text(tree, '삭제되었거나 닫힌 편집 대상')).toBe(true);
    expect(text(tree, '다른 저장 기준')).toBe(true);
    expect(text(tree, record.raw)).toBe(true);
    expect(nodes(tree).find((node) => node.type === AnimatedDetails)?.props.open).toBeUndefined();
    expect(text(tree, '설계 편집')).toBe(true);
    expect(text(tree, '입력 원문 보기')).toBe(true);
    click(tree, '원문 다운로드');
    expect(props.onDownload).toHaveBeenCalledWith('native-draft-source.json', record.raw);
    click(tree, '복구 사본 만들기');
    expect(props.onRecovered).toHaveBeenCalledOnce();
    const recovered = nativeDraftArchive(storage).read(actor, project, 'editor', draft.key)!;
    expect(recovered.draft.expected).toEqual(draft.expected);
    expect(recovered.draft.values).toEqual(draft.values);
    expect(recovered.revision).not.toBe(draft.revision);
    expect(
      archive.entries(actor, project).some((entry) => entry.entryId === original.entryId),
    ).toBe(true);
  });
  it('discard affects only the chosen orphan snapshot', () => {
    const { draft, storage, props } = fixture(),
      archive = new NativeDraftArchive(storage, 'other-tab'),
      render = renderer();
    const first = archive.store('editor', draft.key, draft);
    const second = archive.store('editor', 'column:alive', { ...draft, key: 'column:alive' });
    click(render(props), '이 원문 폐기');
    expect(archive.entries(actor, project).map((entry) => entry.entryId)).toEqual([second.entryId]);
    expect(archive.entries(actor, project).some((entry) => entry.entryId === first.entryId)).toBe(
      false,
    );
    expect(props.onRecovered).not.toHaveBeenCalled();
  });
  it('corrupt legacy source remains downloadable, is not recoverable, and dismissal does not delete shared bytes', () => {
    const { draft, storage, props } = fixture(),
      key = 'ezerd.native.editor:' + JSON.stringify([actor, project, draft.key]),
      render = renderer();
    storage.setItem(key, 'corrupt original bytes');
    const tree = render(props);
    expect(
      nodes(tree).find((node) => node.props.children === '복구 사본 만들기')?.props.disabled,
    ).toBe(true);
    click(tree, '원문 다운로드');
    expect(props.onDownload).toHaveBeenCalledWith(
      'native-draft-source.json',
      'corrupt original bytes',
    );
    click(tree, '이 원문 폐기');
    expect(storage.getItem(key)).toBe('corrupt original bytes');
    expect(nativeDraftArchive(storage).records(actor, project)).toEqual([]);
  });
  it('live actor loss blocks all captured actions and hides previous account sources', () => {
    const { draft, storage, props } = fixture(),
      render = renderer();
    nativeDraftArchive(storage).store('editor', draft.key, draft);
    let current = true;
    props.isActorCurrent = () => current;
    const tree = render(props);
    current = false;
    click(tree, '원문 다운로드');
    click(tree, '복구 사본 만들기');
    click(tree, '이 원문 폐기');
    expect(props.onDownload).not.toHaveBeenCalled();
    expect(props.onRecovered).not.toHaveBeenCalled();
    expect(nativeDraftArchive(storage).entries(actor, project)).toHaveLength(1);
    expect(nodes(render(props)).some((node) => node.type === 'pre')).toBe(false);
  });
  it('an old project handler cannot act after props change', () => {
    const { draft, storage, props } = fixture(),
      render = renderer();
    nativeDraftArchive(storage).store('editor', draft.key, draft);
    const old = render(props);
    render({ ...props, projectId: actor });
    click(old, '이 원문 폐기');
    click(old, '복구 사본 만들기');
    expect(nativeDraftArchive(storage).entries(actor, project)).toHaveLength(1);
    expect(props.onRecovered).not.toHaveBeenCalled();
  });
  it('offers failed memory from a closed form even with storage disabled; newer memory survives an old discard', () => {
    const { draft, storage, props } = fixture(),
      render = renderer(),
      key = 'ezerd.native.editor:' + JSON.stringify([actor, project, draft.key]);
    retainNativeMemoryDraft(key, draft, true, storage);
    storage.getItem = () => {
      throw Error('Disabled');
    };
    const tree = render(props);
    click(tree, '원문 다운로드');
    expect(props.onDownload).toHaveBeenCalledWith(
      'native-draft-memory.json',
      JSON.stringify(draft, null, 2),
    );
    const newer = { ...draft, revision: project, values: { token: 'newer' } };
    retainNativeMemoryDraft(key, newer, true, storage);
    click(tree, '이 원문 폐기');
    expect(listNativeMemoryDrafts(actor, project, storage)[0]?.value).toEqual(newer);
    expect(props.onRecovered).not.toHaveBeenCalled();
  });
});

it('identifies a preserved input by its name while keeping raw identifiers in the disclosure', () => {
  const { draft, storage, props } = fixture();
  nativeDraftArchive(storage).store('editor', draft.key, {
    ...draft,
    values: { ...draft.values, name: 'Orders' },
  });
  const tree = renderer()(props);
  expect(text(tree, 'Orders')).toBe(true);
  const disclosure = nodes(tree).find((node) => node.type === AnimatedDetails)!;
  expect(text(disclosure, draft.key)).toBe(true);
  expect(disclosure.props.open).toBeUndefined();
});

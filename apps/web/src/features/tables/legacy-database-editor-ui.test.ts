import { isValidElement, type ReactElement, type ComponentProps } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  addDomain,
  addTable,
  addColumn,
  type DatabaseKind,
} from '@ezerd/model';
import {
  TableNodeContent,
  TableInspector,
  ColumnEditor,
  ColumnCreationForm,
  ColumnDefaultControl,
  EnumDialog,
} from './TableEditor.js';
import { Canvas } from '../canvas/Canvas.js';
import { SearchType } from '../../components/ui/SearchType.js';
import { Button, ContextMenu, Input, Select, Textarea } from '../../components/ui/index.js';
import { LegacyDatabaseEditorNotice } from './LegacyDatabaseEditorNotice.js';
import { EnumManager } from './EnumManager.js';
const driver = vi.hoisted(() => ({ slots: [] as { value?: unknown }[], cursor: 0 }));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  translate: (value: string) => value,
  useI18n: () => ({ t: (value: string) => value, locale: 'ko' }),
}));
vi.mock('../../components/ui/ConfirmProvider.js', () => ({ useConfirm: () => async () => true }));
vi.mock('react-dom', async (original) => ({
  ...(await original<typeof import('react-dom')>()),
  createPortal: (tree: unknown) => tree,
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useState(initial: unknown) {
      const slot = (driver.slots[driver.cursor++] ??= {
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
      return (driver.slots[driver.cursor++] ??= { value: { current: initial } }).value;
    },
    useMemo(factory: () => unknown) {
      driver.cursor++;
      return factory();
    },
    useEffect() {},
    useLayoutEffect() {},
  };
});
function nodes(tree: unknown): ReactElement<Record<string, any>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function render<P>(component: (props: P) => unknown, props: P) {
  driver.cursor = 0;
  return nodes(component(props));
}
function fixture() {
  const metadata = { common: {}, logical: {}, physical: {} };
  let document = addDomain(
    createEmptyDocument(),
    { id: 'd', name: 'Domain', description: '' },
    { x: 0, y: 0 },
  );
  document = addTable(
    document,
    {
      id: 't',
      domainId: 'd',
      scope: 'both',
      logical: { name: 'Records', definition: '' },
      physical: { name: 'records', schema: 'public', comment: '' },
      customProperties: metadata,
    },
    { x: 0, y: 0 },
  );
  document = addColumn(document, {
    id: 'c',
    tableId: 't',
    scope: 'both',
    logical: { name: 'ID', definition: '', semanticType: '', required: false },
    physical: {
      name: 'id',
      type: { name: 'text', isArray: false },
      nullable: true,
      defaultExpression: 'opaque_original()',
      comment: '',
    },
    customProperties: metadata,
  });
  document.enums = [{ id: 'e', name: 'LegacyEnum', schema: 'custom_schema', values: ['before'] }];
  return document;
}
beforeEach(() => {
  driver.slots = [];
  driver.cursor = 0;
  vi.stubGlobal('document', { body: {} });
});
afterEach(() => vi.unstubAllGlobals());
describe('actual legacy picker and upgrade callback consumption', () => {
  it.each(['mysql', 'sqlite'] as const)(
    'guards %s inline, detail and creation handlers and keeps original input unchanged',
    (databaseKind) => {
      const document = fixture(),
        before = structuredClone(document),
        onChange = vi.fn(),
        onRequestNativeUpgrade = vi.fn();
      const inline = render(TableNodeContent, {
        document,
        tableId: 't',
        viewMode: 'physical',
        onChange,
        databaseKind,
        onRequestNativeUpgrade,
      });
      const picker = inline.find(
        (node) => Array.isArray(node.props.options) && node.props.value === 'text',
      )!;
      expect(picker.props.options.some((item: { value: string }) => item.value === 'uuid')).toBe(
        false,
      );
      picker.props.onValueChange('uuid');
      expect(onChange).not.toHaveBeenCalled();
      const menu = inline.find((node) => node.type === ContextMenu)!;
      menu.props.items.find((item: { id: string }) => item.id === 'native-upgrade').onAction();
      expect(onRequestNativeUpgrade).toHaveBeenCalledTimes(1);
      driver.slots = [];
      const columnProps: ComponentProps<typeof ColumnEditor> = {
        document,
        column: document.columns![0]!,
        index: 0,
        count: 1,
        databaseKind,
        onRequestNativeUpgrade,
        onChange,
        onPrimaryKeyChange() {},
        onMove() {},
        onDelete() {},
        onClose() {},
      };
      const detail = render(ColumnEditor, columnProps),
        detailPicker = detail.find((node) => node.type === SearchType)!;
      detailPicker.props.onValueChange('enum:e');
      expect(onChange).not.toHaveBeenCalled();
      const array = detail.find((node) => node.props.label === '배열')!;
      expect(array.props.disabled).toBe(true);
      array.props.onChange(true);
      expect(onChange).not.toHaveBeenCalled();
      const currentArray = {
        ...columnProps,
        column: {
          ...columnProps.column,
          physical: {
            ...columnProps.column.physical,
            type: { name: ' CustomType ', isArray: true },
          },
        },
      };
      const repaired = render(ColumnEditor, currentArray),
        currentPicker = repaired.find((node) => node.type === SearchType)!;
      expect(
        currentPicker.props.options.some(
          (item: { value: string }) => item.value === ' CustomType ',
        ),
      ).toBe(true);
      currentPicker.props.onValueChange(' CustomType ');
      expect(onChange).not.toHaveBeenCalled();
      repaired.find((node) => node.props.label === '배열')!.props.onChange(false);
      expect(onChange).toHaveBeenLastCalledWith({
        physical: expect.objectContaining({ type: { name: ' CustomType ', isArray: false } }),
      });
      onChange.mockClear();
      driver.slots = [];
      const creationProps = {
        document,
        tableId: 't',
        onChange,
        databaseKind,
        onRequestNativeUpgrade,
      };
      let creation = render(ColumnCreationForm, creationProps);
      creation.find((node) => node.type === SearchType)!.props.onValueChange('jsonb');
      creation = render(ColumnCreationForm, creationProps);
      expect(creation.find((node) => node.type === SearchType)!.props.value).toBe('text');
      creation
        .find((node) => node.type === Button && node.props.children === '+ 컬럼 추가')!
        .props.onClick();
      expect(onChange.mock.calls[0]![0].columns.at(-1).physical.type.name).toBe('text');
      expect(document).toEqual(before);
    },
  );
  it.each(['mysql', 'sqlite'] as const)(
    'passes %s DB/CTA through Canvas and inspector into all child editors',
    (databaseKind) => {
      const document = fixture(),
        onRequestNativeUpgrade = vi.fn(),
        onChange = vi.fn();
      const tree = render(Canvas, {
        document,
        onChange,
        readOnly: false,
        databaseKind,
        onRequestNativeUpgrade,
      });
      const card = tree.find((node) => node.type === TableNodeContent)!;
      expect(card.props.databaseKind).toBe(databaseKind);
      expect(card.props.onRequestNativeUpgrade).toBe(onRequestNativeUpgrade);
      driver.slots = [];
      const inspected = render(TableInspector, {
        document,
        tableId: 't',
        onChange,
        readOnly: false,
        databaseKind,
        onRequestNativeUpgrade,
      });
      for (const child of inspected.filter((node) =>
        [ColumnEditor, ColumnCreationForm, LegacyDatabaseEditorNotice].includes(node.type as any),
      )) {
        expect(child.props.databaseKind).toBe(databaseKind);
        expect(child.props.onRequestNativeUpgrade).toBe(onRequestNativeUpgrade);
      }
      expect(inspected.some((node) => node.type === ColumnCreationForm)).toBe(true);
    },
  );
  it('preserves raw default display and repair while refusing new PG default/serial selection', () => {
    const physical = fixture().columns![0]!.physical,
      onChange = vi.fn(),
      onRequestNativeUpgrade = vi.fn();
    const tree = render(ColumnDefaultControl, {
      physical,
      enums: [],
      onChange,
      databaseKind: 'mysql',
      onRequestNativeUpgrade,
    });
    const option = tree.find(
      (node) => node.type === 'option' && node.props.value === 'opaque_original()',
    )!;
    expect(option.props.disabled).toBe(true);
    const select = tree.find((node) => node.type === Select)!;
    select.props.onValueChange('gen_random_uuid()');
    expect(onChange).toHaveBeenLastCalledWith(physical);
    select.props.onValueChange('');
    expect(onChange).toHaveBeenLastCalledWith({ ...physical, defaultExpression: null });
    const notice = tree.find((node) => node.type === LegacyDatabaseEditorNotice)!;
    expect(notice.props.onRequestNativeUpgrade).toBe(onRequestNativeUpgrade);
    expect(physical.defaultExpression).toBe('opaque_original()');
  });
  it('keeps existing ENUM edit/delete controls and hides only non-PG creation, including actual repair', () => {
    const document = fixture(),
      before = structuredClone(document),
      onChange = vi.fn(),
      props = { document, onChange, readOnly: false, allowCreate: false };
    let tree = render(EnumManager, props);
    expect(tree.some((node) => node.type === 'fieldset')).toBe(false);
    tree.find((node) => node.type === Button && node.props.children === '편집')!.props.onClick();
    tree = render(EnumManager, props);
    expect(tree.some((node) => node.type === 'fieldset')).toBe(true);
    tree.find((node) => node.type === Textarea)!.props.onChange({ target: { value: 'after' } });
    tree = render(EnumManager, props);
    tree
      .find((node) => node.type === Button && node.props.children === 'ENUM 변경 적용')!
      .props.onClick();
    expect(onChange.mock.calls[0]![0].enums).toEqual([
      { ...document.enums![0]!, values: ['after'] },
    ]);
    expect(document).toEqual(before);
  });
  it('closes the non-PG ENUM dialog before forwarding the native upgrade request', async () => {
    const document = fixture(),
      steps: string[] = [];
    const tree = render(EnumDialog, {
      document,
      onChange() {},
      readOnly: false,
      databaseKind: 'sqlite',
      onClose: () => steps.push('close'),
      onRequestNativeUpgrade: () => steps.push('upgrade'),
    });
    expect(tree.find((node) => node.type === EnumManager)!.props.allowCreate).toBe(false);
    tree.find((node) => node.type === LegacyDatabaseEditorNotice)!.props.onRequestNativeUpgrade();
    expect(steps).toEqual(['close']);
    await Promise.resolve();
    expect(steps).toEqual(['close', 'upgrade']);
  });
  it('disables readonly/missing-callback upgrade and preserves PG/omitted UI and creation', () => {
    const onRequestNativeUpgrade = vi.fn();
    for (const props of [
      { databaseKind: 'mysql' as DatabaseKind },
      { databaseKind: 'sqlite' as DatabaseKind, onRequestNativeUpgrade, readOnly: true },
    ]) {
      const tree = render(LegacyDatabaseEditorNotice, props),
        button = tree.find((node) => node.type === Button)!;
      expect(button.props.disabled).toBe(true);
      button.props.onClick();
    }
    expect(onRequestNativeUpgrade).not.toHaveBeenCalled();
    expect(
      render(LegacyDatabaseEditorNotice, { databaseKind: 'postgresql', onRequestNativeUpgrade }),
    ).toEqual([]);
    expect(render(LegacyDatabaseEditorNotice, {})).toEqual([]);
    driver.slots = [];
    expect(
      render(EnumManager, { document: fixture(), onChange() {}, readOnly: false }).some(
        (node) => node.type === 'fieldset',
      ),
    ).toBe(true);
  });
});

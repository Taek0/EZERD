import { canonicalPostgresTypeName, postgresTypeNames } from '@ezerd/model';
import { columnTypeOptions, columnTypeValue } from './column-type-options.js';
import {
  tableColor,
  tableHeaderStyle,
  tableDomainValue,
  tableDomainFromValue,
  UNASSIGNED_DOMAIN_VALUE,
} from './table-appearance.js';
import { tableCanvasOwner } from '../canvas/canvas-view.js';
import { DomainColorPicker } from '../domains/DomainColorPicker.js';
import { translate, useI18n } from '../../shared/i18n/index.js';
import './translations.js';
import {
  applyColumnDefault,
  autoIncrementDefault,
  columnDefaultOptions,
  isAutoIncrement,
  patchColumnPhysical,
} from './column-defaults.js';
import { EnumManager } from './EnumManager.js';
import { columnTypeDisplay } from './column-type-display.js';
import { primaryKeyChangeReason, setColumnPrimaryKey } from './column-primary-key.js';
import {
  Fragment,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from 'react';
import {
  type DesignDocument,
  TABLES_VIEW_ID,
  type ModelScope,
  type Table,
  type Column,
  type CustomProperties,
  type TableRelation,
  type TableKey,
  type ReferentialAction,
  addTable,
  updateTable,
  updateNodeLayout,
  removeTable,
  addColumn,
  updateColumn,
  removeColumn,
  upsertKey,
  removeKey,
  upsertTableRelation,
  removeTableRelation,
  isVisibleInView,
} from '@ezerd/model';
import { createPortal } from 'react-dom';
import { upsertEnum, removeEnum } from '@ezerd/model';
import { newId } from '../../shared/api/client.js';
import './table-editor.css';
import { tableCardMetrics, tableCardSize } from './table-geometry.js';
import { SearchType } from '../../components/ui/SearchType.js';
import { useConfirm } from '../../components/ui/ConfirmProvider.js';
import { createForeignKeyFromPrimaryKey, upsertRelationLayout } from '@ezerd/model';
import {
  AnimatedDetails,
  Button,
  Checkbox,
  ContextMenu,
  IconButton,
  Input,
  Select,
  Textarea,
} from '../../components/ui/index.js';
import {
  PanelList,
  PanelListDetail,
  PanelNote,
  PanelRow,
  PanelSection,
} from '../../shared/editor/panel.js';
export const physicalTypes = postgresTypeNames;
export function typeParameterEnabled(
  type: Column['physical']['type'],
  parameter: 'length' | 'precision' | 'scale',
) {
  if (type.enumId) return false;
  const name = canonicalPostgresTypeName(type.name);
  if (parameter === 'length') return ['varchar', 'char', 'bit', 'bit varying'].includes(name);
  if (parameter === 'scale') return name === 'numeric' && type.precision !== undefined;
  return ['numeric', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval'].includes(name);
}

export function canSaveKey(key: TableKey, columns: Column[], keys: TableKey[]) {
  return (
    key.columnIds.length > 0 &&
    new Set(key.columnIds).size === key.columnIds.length &&
    key.columnIds.every((id) =>
      columns.some((c) => c.id === id && c.tableId === key.tableId && c.scope !== 'logical'),
    ) &&
    !keys.some(
      (k) =>
        k.id !== key.id &&
        k.tableId === key.tableId &&
        k.scope !== 'logical' &&
        ((key.kind === 'primary' && k.kind === 'primary') ||
          (k.kind === key.kind &&
            k.columnIds.length === key.columnIds.length &&
            k.columnIds.every((id, i) => id === key.columnIds[i]))),
    )
  );
}
export const emptyMetadata = (): CustomProperties => ({ common: {}, logical: {}, physical: {} });
const emptyMeta = emptyMetadata;
const tableName = (t: Table) => t.physical.name || translate('이름 없는 테이블');
const columnName = (c: Column) => c.physical.name || translate('이름 없는 컬럼');
export function parseMetadata(text: string): Record<string, string> {
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    Object.entries(value).some(
      ([key, v]) => !key.trim() || key.length > 120 || typeof v !== 'string' || v.length > 10000,
    ) ||
    Object.keys(value).length > 100
  )
    throw new Error(translate('최대 100개, 키 120자 / 문자열 값 10,000자까지 입력하세요.'));
  return value as Record<string, string>;
}
export function moveColumn(doc: DesignDocument, id: string, direction: number): DesignDocument {
  const cols = [...(doc.columns ?? [])],
    at = cols.findIndex((c) => c.id === id);
  if (at < 0) return doc;
  const indices = cols.flatMap((c, i) => (c.tableId === cols[at]!.tableId ? [i] : [])),
    to = indices[indices.indexOf(at) + direction];
  if (to === undefined) return doc;
  [cols[at], cols[to]] = [cols[to]!, cols[at]!];
  return { ...doc, columns: cols };
}
export function reorderColumn(
  doc: DesignDocument,
  sourceId: string,
  targetId: string,
): DesignDocument {
  const columns = [...(doc.columns ?? [])],
    source = columns.find((c) => c.id === sourceId),
    target = columns.find((c) => c.id === targetId);
  if (!source || !target || source.id === target.id || source.tableId !== target.tableId)
    return doc;
  const ordered = columns.filter((c) => c.tableId === source.tableId),
    from = ordered.findIndex((c) => c.id === sourceId),
    to = ordered.findIndex((c) => c.id === targetId);
  ordered.splice(to, 0, ordered.splice(from, 1)[0]!);
  let at = 0;
  return {
    ...doc,
    columns: columns.map((c) => (c.tableId === source.tableId ? ordered[at++]! : c)),
  };
}
export function setMappingPair<
  T extends {
    sourceColumnIds: string[];
    targetColumnIds: string[];
  },
>(mapping: T, index: number, side: 'source' | 'target', value: string): T {
  const key = side === 'source' ? 'sourceColumnIds' : 'targetColumnIds';
  const ids = [...mapping[key]];
  ids[index] = value;
  return { ...mapping, [key]: ids };
}
function TextField({
  label,
  value,
  onChange,
  max = 10000,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
}) {
  useI18n();
  return (
    <label>
      {label}
      <Input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function DescriptionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      const borderHeight = textarea.offsetHeight - textarea.clientHeight;
      textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
    };
    resize();
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        resize();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);
  return (
    <label>
      {label}
      <Textarea
        ref={ref}
        className="table-description-input"
        rows={2}
        maxLength={10000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function Check({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  useI18n();
  return (
    <label className="table-check">
      <Checkbox disabled={disabled} checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
function InlineCell({
  value,
  label,
  onCommit,
  disabled = false,
  title = false,
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  title?: boolean;
}) {
  useI18n();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value);
  const cancel = useRef(false);
  const begin = () => {
    if (disabled) return;
    cancel.current = false;
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    if (!cancel.current && draft !== value) onCommit(draft);
    setEditing(false);
  };
  const Field = title ? 'input' : Input;
  return (
    <span
      className={title ? 'table-inline table-title-inline' : 'table-inline'}
      data-inline-cell
      tabIndex={disabled || editing ? -1 : 0}
      title={
        label +
        ': ' +
        (value || translate('미입력')) +
        (disabled ? '' : translate(' · 더블클릭하여 편집'))
      }
      onFocus={(e) => {
        if (e.target === e.currentTarget) begin();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        begin();
      }}
    >
      {editing ? (
        <Field
          className={title ? 'table-title-input' : undefined}
          maxLength={title ? 120 : undefined}
          autoFocus
          aria-label={label}
          value={draft}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel.current = true;
              setEditing(false);
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        value || '—'
      )}
    </span>
  );
}
function InlineType({ display, ...props }: Parameters<typeof SearchType>[0] & { display: string }) {
  useI18n();
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoringFocus = useRef(false);
  return editing ? (
    <SearchType
      {...props}
      autoFocus
      showSearchIcon={false}
      onEditEnd={(reason) => {
        setEditing(false);
        if (reason !== 'blur') {
          restoringFocus.current = true;
          requestAnimationFrame(() => {
            trigger.current?.focus();
            restoringFocus.current = false;
          });
        }
      }}
    />
  ) : (
    <Button
      ref={trigger}
      className="table-type-trigger"
      aria-label={translate('{x0} 편집', { x0: props.label })}
      aria-haspopup="listbox"
      title={display}
      onFocus={() => {
        if (!restoringFocus.current) setEditing(true);
      }}
      onClick={() => setEditing(true)}
    >
      {display}
    </Button>
  );
}
const freshColumn = (tableId: string, scope: ModelScope = 'physical'): Column => ({
  id: newId(),
  tableId,
  scope,
  logical: { name: translate('새 컬럼'), definition: '', semanticType: '', required: false },
  physical: {
    name: '',
    type: { name: 'text', isArray: false },
    nullable: false,
    defaultExpression: null,
    comment: '',
  },
  customProperties: emptyMeta(),
});
export function updateTableCanvasDisplay(
  doc: DesignDocument,
  tableId: string,
  viewId: string | undefined,
  patch: NonNullable<Table['canvasDisplay']>,
): DesignDocument {
  const table = doc.tables?.find((item) => item.id === tableId);
  if (!table) return doc;
  const next = updateTable(doc, tableId, {
    canvasDisplay: { ...table.canvasDisplay, ...patch },
  });
  const node = doc.layout.nodes.find((item) => item.objectId === tableId && item.viewId === viewId);
  if (!node) return next;
  const before = tableCardMetrics(doc, tableId).width;
  const after = tableCardMetrics(next, tableId).width;
  const extraWidth = Math.max(0, node.width - before);
  return updateNodeLayout(next, node.id, { width: Math.min(10000, after + extraWidth) });
}

export function TableNodeContent({
  document: doc,
  tableId,
  viewId,
  onChange,
  readOnly = false,
  onStartForeignKey,
  onCreatePin,
}: {
  document: DesignDocument;
  tableId: string;
  viewMode: ModelScope;
  viewId?: string;
  onChange?: (d: DesignDocument) => void;
  readOnly?: boolean;
  onStartForeignKey?: (id: string) => void;
  onCreatePin?: (position: { clientX: number; clientY: number }) => void;
}) {
  useI18n();
  const confirm = useConfirm();
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const metrics = useMemo(() => tableCardMetrics(doc, tableId), [doc, tableId]);
  const table = doc.tables?.find((t) => t.id === tableId);
  if (!table) return null;
  const ownerName =
    doc.domains.find((domain) => domain.id === table.domainId)?.name ?? translate('미지정');
  const ownerTitle = translate('소유 도메인 · {domain}', { domain: ownerName });
  const showNullable = table.canvasDisplay?.showNullable !== false,
    showComment = table.canvasDisplay?.showComment !== false;
  const display = (patch: NonNullable<Table['canvasDisplay']>) =>
    onChange?.(updateTableCanvasDisplay(doc, tableId, viewId, patch));
  const columns = (doc.columns ?? []).filter(
    (c) => c.tableId === tableId && isVisibleInView(c.scope, 'physical', table.scope),
  );
  const editable = !!onChange && !readOnly;
  const cell = (value: string, label: string, commit: (v: string) => DesignDocument) => (
    <InlineCell
      value={value}
      label={label}
      disabled={!editable}
      onCommit={(v) => onChange?.(commit(v))}
    />
  );
  return (
    <div
      className="table-node-content"
      style={{ '--table-grid': metrics.grid } as CSSProperties}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (editable) setMenu({ x: e.clientX, y: e.clientY, id: '' });
      }}
    >
      <header
        className={viewId === TABLES_VIEW_ID ? 'table-global-header' : undefined}
        style={tableHeaderStyle(doc, table)}
        title={`${viewId && viewId !== TABLES_VIEW_ID && viewId !== table.domainId ? translate('외부 참조 · ') : ''}${ownerTitle}`}
      >
        <strong>
          <InlineCell
            title
            value={table.physical.name}
            label={translate('테이블명')}
            disabled={!editable}
            onCommit={(name) =>
              onChange?.(updateTable(doc, tableId, { physical: { ...table.physical, name } }))
            }
          />
        </strong>
        {viewId === TABLES_VIEW_ID && (
          <small className="table-owner-badge" title={ownerName}>
            {ownerName}
          </small>
        )}
      </header>
      <div className="table-columns">
        <div className="table-column-row table-column-head">
          <span>{translate('키')}</span>
          <span>{translate('컬럼')}</span>
          <span>{translate('타입')}</span>
          {showNullable && <span>NULL</span>}
          {showComment && <span>comment</span>}
        </div>
        {columns.map((c, columnIndex) => {
          const keys = (doc.keys ?? []).filter(
            (k) => k.columnIds.includes(c.id) && k.scope !== 'logical',
          );
          const fk = (doc.tableRelations ?? []).some(
            (r) => r.physical?.sourceColumnIds.includes(c.id) && r.scope !== 'logical',
          );
          const patch = (v: Partial<Column['physical']>) =>
            updateColumn(doc, c.id, { physical: patchColumnPhysical(c.physical, v) });
          return (
            <div
              className={`table-column-row${keys.some((k) => k.kind === 'primary') ? ' table-column-pk' : ''}${fk ? ' table-column-fk' : ''}`}
              style={{ minHeight: metrics.rows[columnIndex] }}
              key={c.id}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!editable) return;
                setMenu({ x: e.clientX, y: e.clientY, id: c.id });
              }}
            >
              <span className="table-key-marker">
                {[
                  keys.some((k) => k.kind === 'primary') ? 'PK' : '',
                  fk ? 'FK' : '',
                  keys.some((k) => k.kind === 'unique') ? 'UQ' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              </span>
              {cell(c.physical.name, translate('컬럼명'), (name) => patch({ name }))}
              <span
                className="table-type-label table-direct-control"
                data-export-text={columnTypeDisplay(c.physical.type, doc.enums)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {editable ? (
                  <InlineType
                    display={columnTypeDisplay(c.physical.type, doc.enums)}
                    label={translate('{x0} 타입', { x0: columnName(c) })}
                    value={columnTypeValue(c.physical.type)}
                    options={columnTypeOptions(c.physical.type, doc.enums)}
                    onValueChange={(value) => {
                      if (value === columnTypeValue(c.physical.type)) return;
                      onChange?.(
                        patch({
                          type: {
                            name: value.startsWith('enum:')
                              ? (doc.enums?.find((type) => type.id === value.slice(5))?.name ??
                                'text')
                              : value,
                            ...(value.startsWith('enum:') ? { enumId: value.slice(5) } : {}),
                            isArray: ['serial', 'bigserial', 'smallserial'].includes(value)
                              ? false
                              : c.physical.type.isArray,
                          },
                        }),
                      );
                    }}
                  />
                ) : (
                  columnTypeDisplay(c.physical.type, doc.enums)
                )}
              </span>
              {showNullable && (
                <span
                  data-inline-edit="true"
                  className="table-direct-control"
                  title={
                    keys.some((k) => k.kind === 'primary')
                      ? translate('PK 컬럼은 NULL을 허용하지 않습니다.')
                      : translate('NULL 허용')
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    aria-label={translate('{x0} NULL 허용', { x0: columnName(c) })}
                    checked={c.physical.nullable}
                    disabled={!editable || keys.some((k) => k.kind === 'primary')}
                    onChange={(e) => onChange?.(patch({ nullable: e.target.checked }))}
                  />
                </span>
              )}
              {showComment &&
                cell(c.physical.comment, translate('컬럼 comment'), (comment) =>
                  patch({ comment }),
                )}
            </div>
          );
        })}
        {!columns.length && <p>{translate('컬럼을 추가해 설계를 시작하세요.')}</p>}
      </div>
      <div className="table-node-footer" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton
          aria-label={translate('컬럼 추가')}
          disabled={!editable}
          onClick={() => onChange?.(addColumn(doc, freshColumn(tableId)))}
        >
          +
        </IconButton>
      </div>
      <ContextMenu
        position={menu}
        onClose={() => setMenu(null)}
        label={translate('컬럼')}
        items={[
          {
            id: 'primary-key',
            label:
              primaryKeyChangeReason(doc, menu?.id ?? '') ??
              (doc.keys?.some(
                (k) =>
                  k.kind === 'primary' &&
                  k.scope !== 'logical' &&
                  k.columnIds.includes(menu?.id ?? ''),
              )
                ? translate('기본 키(PK)에서 해제')
                : translate('기본 키(PK)로 지정')),
            disabled: !menu?.id || !!primaryKeyChangeReason(doc, menu.id),
            onAction: () => {
              if (menu?.id)
                onChange?.(
                  setColumnPrimaryKey(
                    doc,
                    menu.id,
                    !doc.keys?.some(
                      (k) =>
                        k.kind === 'primary' &&
                        k.scope !== 'logical' &&
                        k.columnIds.includes(menu.id),
                    ),
                  ),
                );
            },
          },
          {
            id: 'delete-column',
            label: translate('컬럼 삭제'),
            disabled: !menu?.id,
            onAction: async () => {
              const id = menu?.id;
              if (
                id &&
                (await confirm({
                  title: translate('컬럼 삭제'),
                  description: translate('컬럼과 연결된 키 및 관계를 삭제할까요?'),
                  confirmLabel: translate('삭제'),
                  destructive: true,
                }))
              )
                onChange?.(removeColumn(doc, id));
            },
          },
          {
            id: 'toggle-nullable',
            label: showNullable ? translate('NULL 숨기기') : translate('NULL 표시'),
            onAction: () => display({ showNullable: !showNullable }),
          },
          {
            id: 'toggle-comment',
            label: showComment ? translate('comment 숨기기') : translate('comment 표시'),
            onAction: () => display({ showComment: !showComment }),
          },
          {
            id: 'pin',
            label: translate('여기에 핀 남기기'),
            disabled: !onCreatePin,
            onAction: () => {
              if (menu) onCreatePin?.({ clientX: menu.x, clientY: menu.y });
            },
          },
          {
            id: 'add-column',
            label: translate('컬럼 추가'),
            onAction: () => onChange?.(addColumn(doc, freshColumn(tableId))),
          },
          {
            id: 'fk',
            label: translate('PK에서 관계 연결'),
            disabled:
              !onStartForeignKey ||
              !doc.keys?.some(
                (k) =>
                  k.tableId === tableId &&
                  k.kind === 'primary' &&
                  k.scope !== 'logical' &&
                  k.columnIds.includes(menu?.id ?? ''),
              ),
            onAction: () => menu && onStartForeignKey?.(menu.id),
          },
        ]}
      />
    </div>
  );
}
export function TableWorkspaceTools({
  document: doc,
  viewId,
  onChange,
  readOnly,
  position,
  onSelect,
}: {
  document: DesignDocument;
  viewId: string;
  viewMode: ModelScope;
  onViewModeChange: (v: ModelScope) => void;
  onChange: (d: DesignDocument) => void;
  readOnly: boolean;
  position: { x: number; y: number };
  onSelect: (id: string) => void;
  hideViewMode?: boolean;
}) {
  useI18n();
  const [name, setName] = useState('');
  return (
    <div className="table-workspace-tools">
      <TextField label={translate('새 테이블명')} value={name} max={120} onChange={setName} />
      <Button
        variant="primary"
        className="primary"
        disabled={readOnly || tableCanvasOwner(doc, viewId) === undefined}
        onClick={() => {
          const domainId = tableCanvasOwner(doc, viewId);
          if (readOnly || domainId === undefined) return;
          const id = newId();
          onChange(
            addTable(
              doc,
              {
                id,
                domainId,
                scope: 'physical',
                logical: { name: translate('새 테이블'), definition: '' },
                physical: { name, schema: 'public', comment: '' },
                customProperties: emptyMetadata(),
              },
              position,
            ),
          );
          setName('');
          onSelect(id);
        }}
      >
        {translate('+ 테이블')}
      </Button>
      <PanelNote>
        {viewId === TABLES_VIEW_ID
          ? translate('도메인 없이 테이블을 만들고, 필요하면 속성에서 도메인을 지정하세요.')
          : translate(
              '이름을 비워 두고 만든 뒤 속성에서 채워도 됩니다. 목록 탭에서 다른 도메인의 테이블을 이 화면으로 참조할 수 있습니다.',
            )}
      </PanelNote>
    </div>
  );
}
export function TableInspector({
  document: doc,
  tableId,
  viewId,
  onChange,
  readOnly,
  onStartForeignKey,
}: {
  document: DesignDocument;
  tableId: string;
  viewId?: string;
  onChange: (d: DesignDocument) => void;
  readOnly: boolean;
  onStartForeignKey?: (id: string) => void;
}) {
  useI18n();
  const confirm = useConfirm();
  const [columnId, setColumnId] = useState<string | null>(null);
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null),
    [dropColumn, setDropColumn] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<TableKey | null>(null),
    [fkColumnId, setFkColumnId] = useState('');
  useEffect(() => {
    setColumnId(null);
    setKeyDraft(null);
    setFkColumnId('');
  }, [tableId]);
  const table = doc.tables?.find((t) => t.id === tableId);
  if (!table) return null;
  const cols = (doc.columns ?? []).filter((c) => c.tableId === tableId && c.scope !== 'logical');
  const relations = (doc.tableRelations ?? []).filter(
    (r) =>
      r.physical &&
      r.scope !== 'logical' &&
      (r.sourceTableId === tableId || r.targetTableId === tableId),
  );
  const keys = (doc.keys ?? []).filter((k) => k.tableId === tableId && k.scope !== 'logical');
  const change = (next: DesignDocument) => {
    if (!readOnly) onChange(next);
  };
  const patch = (p: Partial<Table>) => change(updateTable(doc, tableId, p));
  const marker = (c: Column) =>
    [
      keys.some((k) => k.kind === 'primary' && k.columnIds.includes(c.id)) ? 'PK' : '',
      (doc.tableRelations ?? []).some((r) => r.physical?.sourceColumnIds.includes(c.id))
        ? 'FK'
        : '',
      keys.some((k) => k.kind === 'unique' && k.columnIds.includes(c.id)) ? 'UQ' : '',
    ]
      .filter(Boolean)
      .join(' ');
  return (
    <section className="table-inspector">
      <p className="table-owner">
        {translate(
          viewId === TABLES_VIEW_ID
            ? '소유 도메인 · {domain}'
            : '소유 도메인 · {domain} · 참조 화면에서도 원본을 편집합니다.',
          {
            domain: doc.domains.find((d) => d.id === table.domainId)?.name ?? translate('미지정'),
          },
        )}
      </p>
      <fieldset disabled={readOnly}>
        <PanelSection title={translate('기본 정보')} defaultOpen>
          <label>
            {translate('도메인')}
            <Select
              aria-label={translate('도메인')}
              value={tableDomainValue(table.domainId)}
              disabled={readOnly}
              onValueChange={(value) => patch({ domainId: tableDomainFromValue(value) })}
            >
              <option value={UNASSIGNED_DOMAIN_VALUE}>{translate('미지정')}</option>
              {doc.domains.map((domain) => (
                <option key={domain.id} value={tableDomainValue(domain.id)}>
                  {domain.name}
                </option>
              ))}
            </Select>
          </label>
          <DomainColorPicker
            label={translate('테이블 색상')}
            value={tableColor(doc, table)}
            disabled={readOnly}
            onChange={(color) => patch({ color })}
            onReset={() => patch({ color: undefined })}
          />
          <TextField
            label={translate('테이블명')}
            value={table.physical.name}
            max={120}
            onChange={(name) => patch({ physical: { ...table.physical, name } })}
          />
          <DescriptionField
            label={translate('설명')}
            value={table.physical.comment}
            onChange={(comment) => patch({ physical: { ...table.physical, comment } })}
          />
        </PanelSection>
        <PanelSection title={translate('컬럼')} count={cols.length} defaultOpen>
          <PanelList
            empty={translate('아직 컬럼이 없습니다. 아래 컬럼 추가에서 첫 컬럼을 만들어 주세요.')}
          >
            {cols.map((c, at) => (
              <Fragment key={c.id}>
                <PanelRow
                  className={
                    dropColumn === c.id
                      ? 'table-column-drop'
                      : draggingColumn === c.id
                        ? 'table-column-dragging'
                        : ''
                  }
                  drag={{
                    draggable: !readOnly,
                    onDragStart: (e) => {
                      setDraggingColumn(c.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', c.id);
                    },
                    onDragOver: (e) => {
                      if (!readOnly && draggingColumn && draggingColumn !== c.id) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropColumn(c.id);
                      }
                    },
                    onDragLeave: () => setDropColumn(null),
                    onDrop: (e) => {
                      e.preventDefault();
                      if (!readOnly && draggingColumn)
                        change(reorderColumn(doc, draggingColumn, c.id));
                      setDraggingColumn(null);
                      setDropColumn(null);
                    },
                    onDragEnd: () => {
                      setDraggingColumn(null);
                      setDropColumn(null);
                    },
                  }}
                  action={
                    <span className="table-column-drag-hint" aria-hidden="true">
                      ⠿
                    </span>
                  }
                  active={c.id === columnId}
                  expanded={c.id === columnId}
                  controls={c.id === columnId ? `column-detail-${c.id}` : undefined}
                  title={at + 1 + '. ' + columnName(c)}
                  meta={columnTypeDisplay(c.physical.type, doc.enums)}
                  badge={marker(c) || undefined}
                  onSelect={() => setColumnId((value) => (value === c.id ? null : c.id))}
                />
                <PanelListDetail open={c.id === columnId} id={`column-detail-${c.id}`}>
                  <ColumnEditor
                    document={doc}
                    column={c}
                    index={at}
                    count={cols.length}
                    onChange={(p) => change(updateColumn(doc, c.id, p))}
                    onPrimaryKeyChange={(checked) =>
                      change(setColumnPrimaryKey(doc, c.id, checked))
                    }
                    onMove={(dir) => change(moveColumn(doc, c.id, dir))}
                    onDelete={() => {
                      change(removeColumn(doc, c.id));
                      setColumnId(null);
                    }}
                    onClose={() => setColumnId(null)}
                  />
                </PanelListDetail>
              </Fragment>
            ))}
          </PanelList>
          <PanelSection title={translate('컬럼 추가')} className="table-column-create-section">
            <ColumnCreationForm document={doc} tableId={tableId} onChange={change} />
          </PanelSection>
        </PanelSection>
        <PanelSection title={translate('키 · PK / UNIQUE')} count={keys.length}>
          {keys.map((k) => (
            <KeyEditor
              key={k.id}
              item={k}
              columns={cols}
              onChange={(next) => change(upsertKey(doc, next))}
              onDelete={() => change(removeKey(doc, k.id))}
            />
          ))}
          {keyDraft && (
            <>
              <KeyEditor
                item={keyDraft}
                columns={cols}
                onChange={setKeyDraft}
                onDelete={() => setKeyDraft(null)}
              />
              <Button
                variant="primary"
                disabled={!canSaveKey(keyDraft, cols, keys)}
                onClick={() => {
                  if (!canSaveKey(keyDraft, cols, keys)) return;
                  change(upsertKey(doc, keyDraft));
                  setKeyDraft(null);
                }}
              >
                {translate('키 생성')}
              </Button>
              <PanelNote>
                {translate('컬럼을 선택한 뒤 키를 생성하세요. 같은 키는 중복 생성할 수 없습니다.')}
              </PanelNote>
            </>
          )}
          <Button
            disabled={!!keyDraft || !cols.length}
            onClick={() =>
              setKeyDraft({
                id: newId(),
                tableId,
                scope: 'physical',
                kind: 'unique',
                name: '',
                columnIds: [],
              })
            }
          >
            {translate('+ 키 추가')}
          </Button>
        </PanelSection>
        <PanelSection title={translate('테이블 관계')} count={relations.length}>
          {relations.map((r) => (
            <RelationEditor
              key={r.id}
              document={doc}
              item={r}
              onChange={(next) => change(upsertTableRelation(doc, next))}
              onDelete={() => change(removeTableRelation(doc, r.id))}
            />
          ))}
          <label>
            {translate('PK 출발 컬럼')}
            <Select
              aria-label={translate('PK 출발 컬럼')}
              value={fkColumnId}
              disabled={!onStartForeignKey}
              onValueChange={(value) => setFkColumnId(value)}
            >
              <option value="">{translate('출발 컬럼 선택')}</option>
              {cols
                .filter((c) => keys.some((k) => k.kind === 'primary' && k.columnIds.includes(c.id)))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {columnName(c)}
                  </option>
                ))}
            </Select>
          </label>
          <Button
            disabled={!onStartForeignKey || !cols.some((c) => c.id === fkColumnId)}
            onClick={() => {
              if (!cols.some((c) => c.id === fkColumnId)) return;
              onStartForeignKey?.(fkColumnId);
              setFkColumnId('');
            }}
          >
            {translate('+ 테이블 관계 추가')}
          </Button>
          <PanelNote>
            {translate(
              'PK 컬럼을 선택한 뒤 FK를 받을 테이블을 클릭하세요. 대응 컬럼은 자동으로 추가됩니다.',
            )}
          </PanelNote>
        </PanelSection>
        <div className="panel-danger">
          <Button
            variant="danger"
            className="danger"
            onClick={async () => {
              if (
                await confirm({
                  title: translate('테이블 삭제'),
                  description: translate(
                    '테이블과 소유 컬럼, 키, 관계 및 모든 외부 참조를 삭제할까요?',
                  ),
                  confirmLabel: translate('삭제'),
                  destructive: true,
                })
              )
                change(removeTable(doc, tableId));
            }}
          >
            {translate('테이블 삭제')}
          </Button>
        </div>
      </fieldset>
    </section>
  );
}
export function ColumnDefaultControl({
  physical,
  enums,
  onChange,
}: {
  physical: Column['physical'];
  enums: DesignDocument['enums'];
  onChange: (physical: Column['physical']) => void;
}) {
  useI18n();
  const options = columnDefaultOptions(physical, enums);
  const value = isAutoIncrement(physical.type)
    ? autoIncrementDefault
    : (physical.defaultExpression ?? '');
  const existing = value && !options.some((option) => option.value === value);
  return (
    <label className="table-column-default">
      {translate('기본값')}
      <Select
        aria-label={translate('컬럼 기본값')}
        value={value}
        onValueChange={(next) => onChange(applyColumnDefault(physical, next, enums))}
      >
        {existing && (
          <option value={value} disabled>
            {translate('기존 값 · {value}', { value })}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <small>{translate('타입 변경 시 기본값이 초기화됩니다.')}</small>
    </label>
  );
}
function ColumnEditor({
  document: doc,
  column: c,
  index,
  count,
  onChange,
  onPrimaryKeyChange,
  onMove,
  onDelete,
  onClose,
}: {
  document: DesignDocument;
  column: Column;
  index: number;
  count: number;
  onChange: (p: Partial<Column>) => void;
  onPrimaryKeyChange: (checked: boolean) => void;
  onMove: (d: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useI18n();
  const physical = (p: Partial<Column['physical']>) =>
    onChange({ physical: patchColumnPhysical(c.physical, p) });
  return (
    <div className="panel-detail table-column-editor">
      <div className="panel-detail-head">
        <strong>{translate('컬럼 {index} / {count}', { index: index + 1, count })}</strong>
        <IconButton
          aria-label={translate('{x0} 위로', { x0: columnName(c) })}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </IconButton>
        <IconButton
          aria-label={translate('{x0} 아래로', { x0: columnName(c) })}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </IconButton>
        <IconButton aria-label={translate('컬럼 편집 닫기')} onClick={onClose}>
          ×
        </IconButton>
      </div>
      <TextField
        label={translate('컬럼명')}
        value={c.physical.name}
        max={120}
        onChange={(name) => physical({ name })}
      />
      <div className="table-column-type-controls">
        <label>
          {translate('타입')}
          <SearchType
            label={translate('타입')}
            value={columnTypeValue(c.physical.type)}
            onValueChange={(value) => {
              if (value === columnTypeValue(c.physical.type)) return;
              const enumType = doc.enums?.find((item) => `enum:${item.id}` === value);
              physical({
                type: {
                  name: enumType?.name ?? value,
                  isArray: ['serial', 'bigserial', 'smallserial'].includes(value)
                    ? false
                    : c.physical.type.isArray,
                  ...(enumType ? { enumId: enumType.id } : {}),
                },
              });
            }}
            options={columnTypeOptions(c.physical.type, doc.enums)}
          />
        </label>
      </div>
      <div className="table-type-params">
        {(['length', 'precision', 'scale'] as const).map((key) => (
          <label key={key}>
            {
              {
                length: translate('길이'),
                precision: translate('정밀도'),
                scale: translate('소수'),
              }[key]
            }
            <Input
              type="number"
              disabled={!typeParameterEnabled(c.physical.type, key)}
              step={1}
              min={
                key === 'scale'
                  ? -1000
                  : key === 'precision' &&
                      canonicalPostgresTypeName(c.physical.type.name) !== 'numeric'
                    ? 0
                    : 1
              }
              max={
                key === 'length'
                  ? 10485760
                  : key === 'precision' &&
                      canonicalPostgresTypeName(c.physical.type.name) !== 'numeric'
                    ? 6
                    : 1000
              }
              value={c.physical.type[key] ?? ''}
              onChange={(e) => {
                const value = e.target.value === '' ? undefined : Number(e.target.value);
                if (
                  value === undefined ||
                  (Number.isInteger(value) &&
                    value >=
                      (key === 'scale'
                        ? -1000
                        : key === 'precision' &&
                            canonicalPostgresTypeName(c.physical.type.name) !== 'numeric'
                          ? 0
                          : 1) &&
                    value <=
                      (key === 'length'
                        ? 10485760
                        : key === 'precision' &&
                            canonicalPostgresTypeName(c.physical.type.name) !== 'numeric'
                          ? 6
                          : 1000))
                )
                  physical({
                    type: {
                      ...c.physical.type,
                      [key]: value,
                      ...(key === 'precision' && value === undefined ? { scale: undefined } : {}),
                    },
                  });
              }}
            />
          </label>
        ))}
      </div>
      <div className="table-column-flags">
        <label className="table-check" title={primaryKeyChangeReason(doc, c.id)}>
          <Checkbox
            aria-label={translate('기본 키 (PK)')}
            checked={
              !!doc.keys?.some(
                (k) => k.kind === 'primary' && k.scope !== 'logical' && k.columnIds.includes(c.id),
              )
            }
            disabled={!!primaryKeyChangeReason(doc, c.id)}
            onChange={(e) => onPrimaryKeyChange(e.target.checked)}
          />
          {translate('기본 키 (PK)')}
        </label>
        <Check
          label={translate('배열')}
          value={c.physical.type.isArray}
          disabled={isAutoIncrement(c.physical.type)}
          onChange={(isArray) => physical({ type: { ...c.physical.type, isArray } })}
        />
        <Check
          label={translate('NULL 허용')}
          disabled={
            !!doc.keys?.some(
              (k) => k.kind === 'primary' && k.scope !== 'logical' && k.columnIds.includes(c.id),
            )
          }
          value={c.physical.nullable}
          onChange={(nullable) => {
            if (
              !nullable ||
              !doc.keys?.some(
                (k) => k.kind === 'primary' && k.scope !== 'logical' && k.columnIds.includes(c.id),
              )
            )
              physical({ nullable });
          }}
        />
      </div>
      <ColumnDefaultControl
        physical={c.physical}
        enums={doc.enums}
        onChange={(next) => onChange({ physical: next })}
      />
      {primaryKeyChangeReason(doc, c.id) && (
        <PanelNote>{primaryKeyChangeReason(doc, c.id)}</PanelNote>
      )}
      <TextField
        label={translate('설명')}
        value={c.physical.comment}
        onChange={(comment) => physical({ comment })}
      />
      <div className="panel-danger">
        <Button variant="danger" onClick={onDelete}>
          {translate('컬럼 삭제')}
        </Button>
      </div>
    </div>
  );
}

function KeyEditor({
  item: k,
  columns,
  onChange,
  onDelete,
}: {
  item: TableKey;
  columns: Column[];
  onChange: (k: TableKey) => void;
  onDelete: () => void;
}) {
  useI18n();
  return (
    <PanelSection
      defaultOpen
      title={
        <>
          {k.kind === 'primary' ? translate('기본 키') : translate('고유 키')} ·{' '}
          {k.name || translate('이름 없음')}
        </>
      }
    >
      <label>
        {translate('키 종류')}
        <Select
          aria-label={translate('키 종류')}
          value={k.kind}
          onValueChange={(value) => onChange({ ...k, kind: value as TableKey['kind'] })}
        >
          <option value="primary">PRIMARY KEY</option>
          <option value="unique">UNIQUE</option>
        </Select>
      </label>
      <TextField
        label={translate('키 이름')}
        value={k.name}
        max={120}
        onChange={(name) => onChange({ ...k, name })}
      />
      <p>
        {translate('체크한 순서대로 하나의 복합 {kind}를 구성합니다.', {
          kind: k.kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE',
        })}
      </p>
      <div className="table-key-options">
        {columns.map((c) => (
          <Check
            key={c.id}
            label={`${k.columnIds.includes(c.id) ? `${k.columnIds.indexOf(c.id) + 1}. ` : ''}${c.physical.name || columnName(c)}`}
            value={k.columnIds.includes(c.id)}
            onChange={(checked) =>
              onChange({
                ...k,
                columnIds: checked
                  ? [...k.columnIds, c.id]
                  : k.columnIds.filter((id) => id !== c.id),
              })
            }
          />
        ))}
      </div>
      <Button variant="danger" className="danger" onClick={onDelete}>
        {translate('키 삭제')}
      </Button>
    </PanelSection>
  );
}
export function RelationEditor({
  document: doc,
  item: r,
  onChange,
  onDelete,
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
  document: DesignDocument;
  item: TableRelation;
  onChange: (r: TableRelation) => void;
  onDelete: () => void;
}) {
  useI18n();
  const physical = r.physical,
    source = (doc.columns ?? []).filter((c) => c.tableId === r.sourceTableId),
    target = (doc.columns ?? []).filter((c) => c.tableId === r.targetTableId);
  return (
    <PanelSection
      defaultOpen={defaultOpen}
      title={
        <>
          {doc.tables?.find((t) => t.id === r.targetTableId)?.physical.name} (PK) →{' '}
          {doc.tables?.find((t) => t.id === r.sourceTableId)?.physical.name} (FK) · {r.logical.name}
        </>
      }
    >
      <div className="table-relation-summary">
        {physical ? (
          physical.targetColumnIds.map((id, index) => (
            <span key={`${id}:${index}`}>
              {target.find((c) => c.id === id)?.physical.name || translate('PK 컬럼')} →{' '}
              {source.find((c) => c.id === physical.sourceColumnIds[index])?.physical.name ||
                translate('FK 컬럼')}
            </span>
          ))
        ) : (
          <span>{translate('물리 FK 없음')}</span>
        )}
      </div>
      <TextField
        label={translate('관계명')}
        value={r.logical.name}
        max={120}
        onChange={(name) => onChange({ ...r, logical: { ...r.logical, name } })}
      />
      <DescriptionField
        label={translate('관계 설명')}
        value={r.logical.description ?? ''}
        onChange={(description) => onChange({ ...r, logical: { ...r.logical, description } })}
      />
      {!r.logical.sourceCardinality && !r.logical.targetCardinality && (
        <label>
          {translate('카디널리티')}
          <Select
            aria-label={translate('카디널리티')}
            value={r.logical.cardinality}
            onValueChange={(value) =>
              onChange({
                ...r,
                logical: {
                  ...r.logical,
                  cardinality: value as TableRelation['logical']['cardinality'],
                },
              })
            }
          >
            <option value="one-to-one">1 : 1</option>
            <option value="one-to-many">1 : N</option>
            <option value="many-to-many">N : M</option>
          </Select>
        </label>
      )}
      {(['targetCardinality', 'sourceCardinality'] as const).map((side) => {
        const endpoint = r.logical[side] ?? {
          min: side === 'sourceCardinality' ? 0 : r.logical.required ? 1 : 0,
          max:
            side === 'sourceCardinality'
              ? r.logical.cardinality === 'one-to-one'
                ? 1
                : 'many'
              : r.logical.cardinality === 'many-to-many'
                ? 'many'
                : 1,
        };
        return (
          <label key={side}>
            {side === 'targetCardinality'
              ? translate('출발 끝점 (PK)')
              : translate('대상 끝점 (FK)')}
            <Select
              aria-label={
                side === 'targetCardinality'
                  ? translate('출발 끝점 (PK)')
                  : translate('대상 끝점 (FK)')
              }
              value={`${endpoint.min}:${endpoint.max}`}
              onValueChange={(value) => {
                const [min, max] = value.split(':');
                onChange({
                  ...r,
                  logical: {
                    ...r.logical,
                    [side]: { min: Number(min) as 0 | 1, max: max === 'many' ? 'many' : 1 },
                  },
                });
              }}
            >
              <option value="0:1">0..1</option>
              <option value="1:1">1</option>
              <option value="0:many">0..N</option>
              <option value="1:many">1..N</option>
            </Select>
          </label>
        );
      })}
      {!r.logical.targetCardinality && (
        <Check
          label={translate('관계 필수')}
          value={r.logical.required}
          onChange={(required) => onChange({ ...r, logical: { ...r.logical, required } })}
        />
      )}
      {physical && (
        <div className="table-referential-actions">
          <p>{translate('참조 키 변경·삭제 시 FK 처리')}</p>
          {(['onDelete', 'onUpdate'] as const).map((key) => (
            <label key={key}>
              {key === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'}
              <Select
                aria-label={key === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'}
                value={physical[key]}
                onValueChange={(value) =>
                  onChange({ ...r, physical: { ...physical, [key]: value as ReferentialAction } })
                }
              >
                {['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].map((action) => (
                  <option key={action}>{action}</option>
                ))}
              </Select>
            </label>
          ))}
        </div>
      )}
      <AnimatedDetails className="table-relation-advanced">
        <summary>{translate('고급 설정 · 테이블, FK 매핑')}</summary>
        {(['targetTableId', 'sourceTableId'] as const).map((key) => (
          <label key={key}>
            {key === 'sourceTableId'
              ? translate('대상 테이블 (FK)')
              : translate('출발 테이블 (PK)')}
            <Select
              aria-label={
                key === 'sourceTableId'
                  ? translate('대상 테이블 (FK)')
                  : translate('출발 테이블 (PK)')
              }
              value={r[key]}
              onValueChange={(value) =>
                onChange({
                  ...r,
                  [key]: value,
                  physical: physical
                    ? { ...physical, sourceColumnIds: [], targetColumnIds: [] }
                    : null,
                })
              }
            >
              {doc.tables?.map((t) => (
                <option key={t.id} value={t.id}>
                  {doc.domains.find((d) => d.id === t.domainId)?.name ?? translate('미지정')} /{' '}
                  {tableName(t)}
                </option>
              ))}
            </Select>
          </label>
        ))}
        {physical ? (
          <Button onClick={() => onChange({ ...r, physical: null })}>
            {translate('FK 정의 제거')}
          </Button>
        ) : (
          <p>{translate('새 FK는 출발 PK 컬럼을 선택한 뒤 도착 테이블을 클릭하여 생성합니다.')}</p>
        )}
        {physical && (
          <>
            <TextField
              label={translate('FK 이름')}
              value={physical.name}
              max={120}
              onChange={(name) => onChange({ ...r, physical: { ...physical, name } })}
            />
            <p>{translate('출발 PK / UNIQUE 컬럼 → 대상 FK 컬럼 순서로 대응합니다.')}</p>
            {physical.sourceColumnIds.map((id, i) => (
              <div className="table-mapping" key={i}>
                <span>{i + 1}</span>
                {(['target', 'source'] as const).map((side) => (
                  <label key={side}>
                    {side === 'source' ? 'FK' : 'PK / UNIQUE'} {translate('컬럼')}
                    <Select
                      aria-label={translate('{x0} 컬럼 {x1}', {
                        x0: side === 'source' ? 'FK' : 'PK / UNIQUE',
                        x1: i + 1,
                      })}
                      value={side === 'source' ? id : (physical.targetColumnIds[i] ?? '')}
                      onValueChange={(value) => {
                        if (value)
                          onChange({ ...r, physical: setMappingPair(physical, i, side, value) });
                      }}
                    >
                      <option value="">{translate('선택')}</option>
                      {(side === 'source' ? source : target).map((c) => (
                        <option key={c.id} value={c.id}>
                          {columnName(c)}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
                <IconButton
                  aria-label={translate('매핑 {x0} 삭제', { x0: i + 1 })}
                  onClick={() =>
                    onChange({
                      ...r,
                      physical: {
                        ...physical,
                        sourceColumnIds: physical.sourceColumnIds.filter((_, at) => at !== i),
                        targetColumnIds: physical.targetColumnIds.filter((_, at) => at !== i),
                      },
                    })
                  }
                >
                  ×
                </IconButton>
              </div>
            ))}
            <Button
              disabled={!source.length || !target.length}
              onClick={() =>
                onChange({
                  ...r,
                  physical: {
                    ...physical,
                    sourceColumnIds: [...physical.sourceColumnIds, source[0]?.id ?? ''],
                    targetColumnIds: [...physical.targetColumnIds, target[0]?.id ?? ''],
                  },
                })
              }
            >
              {translate('+ 컬럼 매핑')}
            </Button>
          </>
        )}
      </AnimatedDetails>
      <Button variant="danger" className="danger" onClick={onDelete}>
        {translate('관계 삭제')}
      </Button>
    </PanelSection>
  );
}

export { relationGeometry, TableRelationsSvg } from '../relations/TableRelations.js';

export { ForeignKeyDialog } from '../relations/ForeignKeyDialog.js';

function ColumnCreationForm({
  document: doc,
  tableId,
  onChange,
}: {
  document: DesignDocument;
  tableId: string;
  onChange: (d: DesignDocument) => void;
}) {
  useI18n();
  const [name, setName] = useState(''),
    [type, setType] = useState('text'),
    [comment, setComment] = useState(''),
    [pk, setPk] = useState(false),
    [notNull, setNotNull] = useState(true),
    [defaultExpression, setDefaultExpression] = useState<string | null>(null);
  const enumType = doc.enums?.find((item) => `enum:${item.id}` === type);
  const draftPhysical: Column['physical'] = {
    name,
    comment,
    nullable: !notNull && !pk,
    type: {
      name: enumType?.name ?? type,
      isArray: false,
      ...(enumType ? { enumId: enumType.id } : {}),
    },
    defaultExpression,
  };
  return (
    <div className="table-column-create">
      <div className="table-create-grid">
        <label>
          PK
          <Checkbox
            checked={pk}
            disabled={
              !!(doc.columns ?? [])
                .filter((c) => c.tableId === tableId && c.scope !== 'logical')
                .find((c) => primaryKeyChangeReason(doc, c.id))
            }
            onChange={(e) => {
              setPk(e.target.checked);
              if (e.target.checked && defaultExpression === 'NULL') setDefaultExpression(null);
            }}
          />
        </label>
        <TextField
          label={translate('속성', undefined, 'column')}
          value={name}
          max={120}
          onChange={setName}
        />
        <label>
          {translate('타입')}
          <SearchType
            label={translate('타입')}
            value={type}
            onValueChange={(value) => {
              setType(value);
              setDefaultExpression(null);
            }}
            options={columnTypeOptions(undefined, doc.enums)}
          />
        </label>
        <label>
          NOT NULL
          <Checkbox
            checked={notNull || pk}
            disabled={pk}
            onChange={(e) => {
              setNotNull(e.target.checked);
              if (e.target.checked && defaultExpression === 'NULL') setDefaultExpression(null);
            }}
          />
        </label>
        <TextField label={translate('새 컬럼 comment')} value={comment} onChange={setComment} />
      </div>
      <ColumnDefaultControl
        physical={draftPhysical}
        enums={doc.enums}
        onChange={(next) => {
          setDefaultExpression(next.defaultExpression);
          setType(next.type.enumId ? `enum:${next.type.enumId}` : next.type.name);
          setNotNull(!next.nullable);
        }}
      />
      <Button
        onClick={() => {
          const column = freshColumn(tableId);
          column.physical = draftPhysical;
          let next = addColumn(doc, column);
          if (pk) next = setColumnPrimaryKey(next, column.id, true);
          onChange(next);
          setName('');
          setComment('');
          setPk(false);
        }}
      >
        {translate('+ 컬럼 추가')}
      </Button>
    </div>
  );
}

export function EnumDialog({
  document: doc,
  onChange,
  readOnly,
  onClose,
}: {
  document: DesignDocument;
  onChange: (d: DesignDocument) => void;
  readOnly: boolean;
  onClose: () => void;
}) {
  useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="table-fk-dialog enum-dialog"
      aria-labelledby="enum-dialog-title"
      onCancel={onClose}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="enum-dialog-head">
        <h2 id="enum-dialog-title">{translate('프로젝트 ENUM')}</h2>
        <IconButton aria-label={translate('ENUM 관리 닫기')} onClick={onClose}>
          ×
        </IconButton>
      </div>
      <EnumManager document={doc} onChange={onChange} readOnly={readOnly} />
      <div className="table-actions">
        <Button onClick={onClose}>{translate('닫기')}</Button>
      </div>
    </dialog>,
    document.body,
  );
}

import {
  cloneElement,
  useState,
  type CSSProperties,
  type ReactElement,
  type HTMLAttributes,
  type MouseEvent,
  type KeyboardEvent,
} from 'react';
import type { NativeInlineTarget } from './NativeCanvasInlineEditor.js';
import { nativeTableCanvasMetrics, nativeTableCanvasTitle } from './native-canvas-style.js';
import {
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  isVisibleInView,
  type NativeDesignDocument,
  type NativeTable,
} from '@ezerd/model';
import { Checkbox, ContextMenu, type ContextMenuItem } from '../../components/ui/index.js';
import { useI18n } from '../../shared/i18n/index.js';
import { NativeCanvasInlineCell } from './NativeCanvasInlineCell.js';
import type { NativeEditorContext } from './native-editor-form.js';
import { nativeEditorPolicy } from './native-editor-policy.js';

export type NativeCanvasStructureRequest = (
  action: 'patch' | 'delete' | 'foreignKey' | 'column' | 'key' | 'enum',
  target: string,
  tableId?: string,
) => void;
export type NativeCanvasActionRequest = (
  action: string,
  target: string,
  values?: Record<string, string>,
) => void;

export function NativeCanvasTableRows({
  document,
  table,
  mode,
  onSelect,
  onEdit,
  selectedColumnId,
  onToggleNullable,
  onConnectFromColumn,
  editorContext,
  onRequestStructure,
  onRequestAction,
  onSelectRelation,
}: {
  document: NativeDesignDocument;
  table: NativeTable;
  mode: 'physical' | 'logical';
  onSelect: (tableId: string, columnId?: string) => void;
  onEdit?: ((target: NativeInlineTarget, focusTarget?: HTMLElement) => void) | undefined;
  editorContext?: NativeEditorContext | undefined;
  onRequestStructure?: NativeCanvasStructureRequest | undefined;
  onRequestAction?: NativeCanvasActionRequest | undefined;
  onSelectRelation?: ((id: string | null) => void) | undefined;
  selectedColumnId?: string | undefined;
  onToggleNullable?:
    | ((tableId: string, columnId: string, value: boolean, mode: 'physical' | 'logical') => void)
    | undefined;
  onConnectFromColumn?: ((columnId: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const showNullable = table.canvasDisplay?.showNullable !== false;
  const showComment = table.canvasDisplay?.showComment !== false;
  const metrics = nativeTableCanvasMetrics(document, table, mode);
  const edit = (columnId: string, field: NativeInlineTarget['field']) =>
    onEdit?.({ tableId: table.id, columnId, mode, field });
  return (
    <NativeCanvasColumnMenu
      document={document}
      table={table}
      mode={mode}
      onSelect={onSelect}
      {...(editorContext ? { editorContext } : {})}
      {...(onRequestStructure ? { onRequestStructure } : {})}
      {...(onRequestAction ? { onRequestAction } : {})}
      {...(onConnectFromColumn ? { onConnectFromColumn } : {})}
      {...(onSelectRelation ? { onSelectRelation } : {})}
    >
      <div
        className="native-table-columns"
        role="table"
        aria-label={mode === 'physical' ? table.physical.name : table.logical.name}
        style={{ '--native-table-grid': metrics.grid } as CSSProperties}
      >
        <div className="native-table-column-head native-table-column-row" role="row">
          <span role="columnheader">{t('키')}</span>
          <span role="columnheader">{t('컬럼')}</span>
          <span role="columnheader">{t('타입')}</span>
          {showNullable && (
            <span role="columnheader">{mode === 'physical' ? 'NULL' : t('필수')}</span>
          )}
          {showComment && (
            <span role="columnheader">{mode === 'physical' ? 'comment' : t('정의')}</span>
          )}
        </div>
        {metrics.rows.map((row) => {
          const primary = row.keys.split(' ').includes('PK');
          const connected = row.keys.split(' ').includes('FK');
          const canConnect = mode === 'physical' && primary && !!onConnectFromColumn;
          return (
            <div
              key={row.column.id}
              className="native-table-column-row"
              role="row"
              data-column-id={row.column.id}
              data-pk={primary}
              data-fk={connected}
              data-selected={row.column.id === selectedColumnId}
              style={{ minHeight: row.height }}
            >
              <span className="native-key-marker" role="cell">
                {canConnect ? (
                  <button
                    type="button"
                    aria-label={row.name + ' ' + t('PK에서 관계 연결')}
                    title={t('PK에서 관계 연결')}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onConnectFromColumn?.(row.column.id);
                    }}
                  >
                    {row.keys}
                  </button>
                ) : (
                  row.keys
                )}
              </span>
              <span role="cell">
                {editorContext ? (
                  <NativeCanvasInlineCell
                    document={document}
                    target={{ tableId: table.id, columnId: row.column.id, mode, field: 'name' }}
                    context={editorContext}
                    className="native-table-inline"
                    display={row.name}
                    label={t('컬럼명')}
                    onSelect={(target) => onSelect(table.id, target.columnId)}
                    {...(onEdit ? { onAdvancedFormat: onEdit } : {})}
                  />
                ) : (
                  <button
                    className="native-table-inline"
                    type="button"
                    title={row.name + (onEdit ? ' · ' + t('더블클릭 또는 F2로 편집') : '')}
                    onClick={(event) => {
                      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                      event.stopPropagation();
                      onSelect(table.id, row.column.id);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      edit(row.column.id, 'name');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'F2' && onEdit) {
                        event.preventDefault();
                        event.stopPropagation();
                        edit(row.column.id, 'name');
                      }
                    }}
                  >
                    {row.name || '—'}
                  </button>
                )}
              </span>
              <span
                className="native-type-cell"
                role="cell"
                title={
                  mode === 'physical'
                    ? row.type +
                      ' · ' +
                      nativeDefaultDisplay(row.column.physical.defaultValue, document) +
                      ' · ' +
                      nativeGenerationDisplay(row.column.physical.generation, document)
                    : row.column.logical.definition
                }
              >
                {editorContext ? (
                  <NativeCanvasInlineCell
                    document={document}
                    target={{
                      tableId: table.id,
                      columnId: row.column.id,
                      mode,
                      field: mode === 'physical' ? 'format' : 'semanticType',
                    }}
                    context={editorContext}
                    className="native-table-inline"
                    display={row.type}
                    label={row.name + ' ' + t('타입')}
                    onSelect={(target) => onSelect(table.id, target.columnId)}
                    {...(onEdit ? { onAdvancedFormat: onEdit } : {})}
                  />
                ) : onEdit ? (
                  <button
                    className="native-table-inline"
                    type="button"
                    aria-label={row.name + ' ' + t('타입')}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      edit(row.column.id, mode === 'physical' ? 'format' : 'semanticType');
                    }}
                  >
                    {row.type || '—'}
                  </button>
                ) : (
                  row.type || '—'
                )}
              </span>
              {showNullable && (
                <span
                  className="native-null-cell"
                  role="cell"
                  title={
                    mode === 'physical'
                      ? primary
                        ? t('PK 컬럼은 NULL을 허용하지 않습니다.')
                        : t('NULL 허용')
                      : t('필수')
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={row.name + ' ' + (mode === 'physical' ? 'NULL' : t('필수'))}
                    title={t(row.nullable)}
                    checked={
                      mode === 'physical'
                        ? row.column.physical.nullable
                        : row.column.logical.required
                    }
                    disabled={
                      !!editorContext?.busy || !onToggleNullable || (mode === 'physical' && primary)
                    }
                    onChange={(event) => {
                      if (
                        !editorContext?.busy &&
                        onToggleNullable &&
                        !(mode === 'physical' && primary)
                      )
                        onToggleNullable(table.id, row.column.id, event.target.checked, mode);
                    }}
                  />
                </span>
              )}
              {showComment && (
                <span className="native-comment-cell" role="cell" title={row.comment}>
                  {editorContext ? (
                    <NativeCanvasInlineCell
                      document={document}
                      target={{
                        tableId: table.id,
                        columnId: row.column.id,
                        mode,
                        field: 'comment',
                      }}
                      context={editorContext}
                      className="native-table-inline"
                      display={row.comment}
                      label={row.name + ' ' + t('설명')}
                      onSelect={(target) => onSelect(table.id, target.columnId)}
                      {...(onEdit ? { onAdvancedFormat: onEdit } : {})}
                    />
                  ) : onEdit ? (
                    <button
                      className="native-table-inline"
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        edit(row.column.id, 'comment');
                      }}
                      aria-label={row.name + ' ' + t('설명')}
                    >
                      {row.comment || '—'}
                    </button>
                  ) : (
                    row.comment || '—'
                  )}
                </span>
              )}
            </div>
          );
        })}
        {!metrics.rows.length && (
          <p className="native-table-empty">{t('컬럼을 추가해 설계를 시작하세요.')}</p>
        )}
      </div>
    </NativeCanvasColumnMenu>
  );
}

interface NativeCanvasColumnMenuProps {
  document: NativeDesignDocument;
  table: NativeTable;
  mode: 'physical' | 'logical';
  onSelect: (tableId: string, columnId?: string) => void;
  editorContext?: NativeEditorContext;
  onRequestStructure?: NativeCanvasStructureRequest;
  onRequestAction?: NativeCanvasActionRequest;
  onConnectFromColumn?: (columnId: string) => void;
  onSelectRelation?: (id: string | null) => void;
}

/** The parent owns confirmation, scope and durable saves; this menu only requests those paths. */
export function nativeCanvasColumnMenuItems(
  props: NativeCanvasColumnMenuProps,
  columnId: string,
  t: (text: string) => string,
): ContextMenuItem[] {
  const {
    document,
    table,
    mode,
    editorContext,
    onRequestStructure,
    onRequestAction,
    onConnectFromColumn,
    onSelectRelation,
  } = props;
  const column = document.columns?.find(
    (item) =>
      item.id === columnId &&
      item.tableId === table.id &&
      isVisibleInView(item.scope, mode, table.scope),
  );
  if (!column) return [];
  const writable = !editorContext?.busy;
  const primary = document.keys?.find(
    (key) =>
      key.tableId === table.id &&
      key.kind === 'primary' &&
      isVisibleInView(key.scope, mode, table.scope),
  );
  const policy = nativeEditorPolicy(document, table, column);
  const primaryUsable = mode === 'physical' && policy.feature('primaryKey').usable;
  const request = (
    action: 'patch' | 'delete' | 'column',
    collection?: 'columns' | 'keys',
    id = columnId,
  ) => {
    if (writable && onRequestStructure)
      onRequestStructure(action, collection ? JSON.stringify([collection, id]) : '', table.id);
  };
  const items: ContextMenuItem[] = [
    {
      id: 'edit-column',
      label: t('컬럼 속성'),
      disabled: !writable || !onRequestStructure,
      onAction: () => request('patch', 'columns'),
    },
    {
      id: 'primary-key',
      label: t('PK 설정'),
      disabled: !writable || !primaryUsable || (!onRequestStructure && !onRequestAction),
      onAction: () => {
        if (!writable || !primaryUsable) return;
        if (primary) request('patch', 'keys', primary.id);
        else if (onRequestAction)
          onRequestAction('key', '', {
            tableId: table.id,
            keyKind: 'primary',
            columnIds: column.id,
          });
        else onRequestStructure?.('key', '', table.id);
      },
    },
    {
      id: 'delete-column',
      label: t('컬럼 삭제'),
      destructive: true,
      disabled: !writable || !onRequestStructure,
      onAction: () => request('delete', 'columns'),
    },
    {
      id: 'add-column',
      label: t('컬럼 추가'),
      disabled: !writable || !onRequestStructure,
      onAction: () => request('column'),
    },
    {
      id: 'fk',
      label: t('PK에서 관계 연결'),
      disabled:
        !writable ||
        mode !== 'physical' ||
        !onConnectFromColumn ||
        !primary?.columnIds.includes(column.id) ||
        !policy.feature('foreignKey').usable,
      onAction: () => {
        if (
          writable &&
          mode === 'physical' &&
          primary?.columnIds.includes(column.id) &&
          policy.feature('foreignKey').usable
        )
          onConnectFromColumn?.(column.id);
      },
    },
  ];
  for (const relation of document.tableRelations ?? []) {
    if (!isVisibleInView(relation.scope, mode)) continue;
    const incoming =
      relation.targetTableId === table.id && relation.physical?.targetColumnIds.includes(column.id);
    const outgoing =
      relation.sourceTableId === table.id && relation.physical?.sourceColumnIds.includes(column.id);
    if (!incoming && !outgoing) continue;
    const other = document.tables?.find(
      (item) => item.id === (incoming ? relation.sourceTableId : relation.targetTableId),
    );
    const label =
      (mode === 'physical' ? relation.physical?.name : relation.logical.name) ||
      relation.logical.name ||
      relation.id;
    items.push({
      id: `relation:${relation.id}`,
      label: `${t(incoming ? '들어오는 관계' : '나가는 관계')} · ${label}${other ? ' · ' + nativeTableCanvasTitle(other, mode) : ''}`,
      disabled: !onSelectRelation && (!writable || !onRequestStructure),
      onAction: () => {
        if (onSelectRelation) onSelectRelation(relation.id);
        else if (writable)
          onRequestStructure?.('patch', JSON.stringify(['tableRelations', relation.id]), table.id);
      },
    });
  }
  return items;
}

function NativeCanvasColumnMenu({
  children,
  ...props
}: NativeCanvasColumnMenuProps & {
  children: ReactElement<HTMLAttributes<HTMLDivElement>>;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number; columnId: string } | null>(null);
  const open = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if (
      !(event.target instanceof Element) ||
      event.target.closest('input,textarea,select,[contenteditable="true"]')
    )
      return;
    const row = event.target.closest<HTMLElement>('[data-column-id]');
    const id = row?.getAttribute('data-column-id');
    if (!row || !id || !nativeCanvasColumnMenuItems(props, id, t).length) return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelect(props.table.id, id);
    const rect = row.getBoundingClientRect();
    setMenu({
      x: 'clientX' in event ? event.clientX : rect.left + 10,
      y: 'clientY' in event ? event.clientY : rect.top + 28,
      columnId: id,
    });
  };
  return (
    <>
      {cloneElement(children, {
        onContextMenu: open,
        onKeyDownCapture: (event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
        },
      })}
      <ContextMenu
        label={t('컬럼')}
        position={menu}
        onClose={() => setMenu(null)}
        items={menu ? nativeCanvasColumnMenuItems(props, menu.columnId, t) : []}
      />
    </>
  );
}

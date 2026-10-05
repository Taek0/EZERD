import type { CSSProperties } from 'react';
import type { NativeInlineTarget } from './NativeCanvasInlineEditor.js';
import { nativeTableCanvasMetrics } from './native-canvas-style.js';
import {
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  type NativeDesignDocument,
  type NativeTable,
} from '@ezerd/model';
import { Checkbox } from '../../components/ui/index.js';
import { useI18n } from '../../shared/i18n/index.js';

export function NativeCanvasTableRows({
  document,
  table,
  mode,
  onSelect,
  onEdit,
  selectedColumnId,
  onToggleNullable,
  onConnectFromColumn,
}: {
  document: NativeDesignDocument;
  table: NativeTable;
  mode: 'physical' | 'logical';
  onSelect: (tableId: string, columnId?: string) => void;
  onEdit?: ((target: NativeInlineTarget) => void) | undefined;
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
              {onEdit ? (
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
                    mode === 'physical' ? row.column.physical.nullable : row.column.logical.required
                  }
                  disabled={!onToggleNullable || (mode === 'physical' && primary)}
                  onChange={(event) => {
                    if (onToggleNullable && !(mode === 'physical' && primary))
                      onToggleNullable(table.id, row.column.id, event.target.checked, mode);
                  }}
                />
              </span>
            )}
            {showComment && (
              <span className="native-comment-cell" role="cell" title={row.comment}>
                {onEdit ? (
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
  );
}

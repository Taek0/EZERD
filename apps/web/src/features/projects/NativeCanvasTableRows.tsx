import type { NativeInlineTarget } from './NativeCanvasInlineEditor.js';
import { nativeTableCanvasRows } from './native-canvas-style.js';
import {
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  type NativeDesignDocument,
  type NativeTable,
} from '@ezerd/model';
import { useI18n } from '../../shared/i18n/index.js';
export function NativeCanvasTableRows({
  document,
  table,
  mode,
  onSelect,
  onEdit,
}: {
  document: NativeDesignDocument;
  table: NativeTable;
  mode: 'physical' | 'logical';
  onSelect: (tableId: string, columnId?: string) => void;
  onEdit?: ((target: NativeInlineTarget) => void) | undefined;
}) {
  const { t } = useI18n();
  const showNullable = table.canvasDisplay?.showNullable !== false;
  const showComment = table.canvasDisplay?.showComment !== false;
  return (
    <>
      <colgroup>
        <col style={{ width: 48 }} />
        <col />
        <col />
        {showNullable && <col style={{ width: 70 }} />}
        {showComment && <col />}
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{t('키')}</th>
          <th scope="col">{t('컬럼')}</th>
          <th scope="col">{t('타입')}</th>
          {showNullable && <th scope="col">{mode === 'physical' ? 'NULL' : t('필수')}</th>}
          {showComment && <th scope="col">{mode === 'physical' ? 'comment' : t('정의')}</th>}
        </tr>
      </thead>
      <tbody>
        {nativeTableCanvasRows(document, table, mode).map((row) => (
          <tr
            key={row.column.id}
            data-column-id={row.column.id}
            data-pk={row.keys.split(' ').includes('PK')}
            data-fk={row.keys.split(' ').includes('FK')}
            style={{ height: row.height }}
          >
            <td className="native-key-marker">{row.keys}</td>
            <th scope="row">
              <button
                type="button"
                title={row.name}
                onClick={() => onSelect(table.id, row.column.id)}
                onDoubleClick={() =>
                  onEdit?.({ tableId: table.id, columnId: row.column.id, mode, field: 'name' })
                }
                onKeyDown={(event) => {
                  if (event.key === 'F2' && onEdit) {
                    event.preventDefault();
                    event.stopPropagation();
                    onEdit({ tableId: table.id, columnId: row.column.id, mode, field: 'name' });
                  }
                }}
              >
                {row.name}
              </button>
            </th>
            <td
              className="native-type-cell"
              title={
                mode === 'physical'
                  ? `${row.type} · ${nativeDefaultDisplay(row.column.physical.defaultValue, document)} · ${nativeGenerationDisplay(row.column.physical.generation, document)}`
                  : row.column.logical.definition
              }
            >
              {onEdit ? (
                <button
                  type="button"
                  aria-label={`${row.name} ${t('타입')}`}
                  onClick={() =>
                    onEdit({
                      tableId: table.id,
                      columnId: row.column.id,
                      mode,
                      field: mode === 'physical' ? 'format' : 'semanticType',
                    })
                  }
                >
                  {row.type || '—'}
                </button>
              ) : (
                <span>{row.type}</span>
              )}
            </td>
            {showNullable && (
              <td className="native-null-cell">
                {onEdit ? (
                  <button
                    type="button"
                    aria-label={`${row.name} ${mode === 'physical' ? 'NULL' : t('필수')}`}
                    onClick={() =>
                      onEdit({
                        tableId: table.id,
                        columnId: row.column.id,
                        mode,
                        field: mode === 'physical' ? 'format' : 'required',
                      })
                    }
                  >
                    {t(row.nullable) || '—'}
                  </button>
                ) : (
                  t(row.nullable)
                )}
              </td>
            )}
            {showComment && (
              <td className="native-comment-cell" title={row.comment}>
                {onEdit ? (
                  <button
                    type="button"
                    onClick={() =>
                      onEdit({ tableId: table.id, columnId: row.column.id, mode, field: 'comment' })
                    }
                    aria-label={`${row.name} ${t('설명')}`}
                  >
                    {row.comment || '—'}
                  </button>
                ) : (
                  <span>{row.comment || '—'}</span>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </>
  );
}

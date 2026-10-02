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
}: {
  document: NativeDesignDocument;
  table: NativeTable;
  mode: 'physical' | 'logical';
  onSelect: (tableId: string, columnId?: string) => void;
}) {
  const { t } = useI18n();
  return (
    <tbody>
      {nativeTableCanvasRows(document, table, mode).map((row) => (
        <tr key={row.column.id} data-column-id={row.column.id} style={{ height: row.height }}>
          <td>{row.keys}</td>
          <th>
            <button type="button" onClick={() => onSelect(table.id, row.column.id)}>
              {row.name}
            </button>
            {row.comment && (
              <span
                style={{
                  display: 'block',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 150,
                }}
                title={row.comment}
              >
                {row.comment}
              </span>
            )}
          </th>
          <td
            title={
              mode === 'physical'
                ? `${nativeDefaultDisplay(row.column.physical.defaultValue, document)} · ${nativeGenerationDisplay(row.column.physical.generation, document)}`
                : row.column.logical.definition
            }
          >
            {row.type}
            {row.nullable && (
              <span style={{ display: 'block', fontSize: 10 }}>{t(row.nullable)}</span>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

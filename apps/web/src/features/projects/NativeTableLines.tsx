import { nativeRelationEnds, nativeRelationEndPath } from './native-relation-presentation.js';
import { useId } from 'react';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { useI18n } from '../../shared/i18n/index.js';
import { nativeRelationLabelWidth } from './native-canvas-style.js';
import { nativeTableCanvasTitle } from './native-canvas-style.js';
import type { NativeDesignDocument } from '@ezerd/model';

/** Presentational cardinalities follow the existing canvas' logical endpoint metadata. */
export function NativeTableLines({
  relations,
  mode,
  selectedId,
  onSelect,
  document,
}: {
  relations: ReturnType<typeof nativeCanvasScene>['relations'];
  mode: 'physical' | 'logical';
  selectedId?: string | null | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
  document?: NativeDesignDocument;
}) {
  const id = useId().replaceAll(':', '');
  const { t } = useI18n();
  const marker = (min: number, max: number | 'many') => `${id}-crow-${min}-${max}`;
  return (
    <svg className={`native-erd-lines native-table-lines ${mode}`} aria-label={t('테이블 관계')}>
      <defs>
        {([0, 1] as const).flatMap((min) =>
          ([1, 'many'] as const).map((max) => (
            <marker
              key={`${min}-${max}`}
              id={marker(min, max)}
              viewBox="0 0 32 24"
              refX="30"
              refY="12"
              markerWidth="32"
              markerHeight="24"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <g fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d={nativeRelationEndPath(max)} />
                {min === 0 ? (
                  <circle cx="10" cy="12" r="5" fill="var(--panel, #fafbfc)" />
                ) : (
                  <path d="M 13 4 L 13 20" />
                )}
              </g>
            </marker>
          )),
        )}
      </defs>
      {relations.map(({ relation, geometry, label }) => {
        const [source, target] = nativeRelationEnds(relation);
        const width = nativeRelationLabelWidth(label);
        const endpoint = (tableId: string, ids: string[]) => {
          const table = document?.tables?.find((table) => table.id === tableId);
          const name = table ? nativeTableCanvasTitle(table, mode) : tableId;
          const columns = ids.map((id) => {
            const column = document?.columns?.find(
              (column) => column.id === id && column.tableId === tableId,
            );
            return column
              ? mode === 'physical'
                ? column.physical.name || column.logical.name
                : column.logical.name || column.physical.name
              : id;
          });
          return `${name}${columns.length ? ` (${columns.join(', ')})` : ''}`;
        };
        const description = [
          relation.logical.name || label,
          `${endpoint(relation.targetTableId, relation.physical?.targetColumnIds ?? [])} → ${endpoint(relation.sourceTableId, relation.physical?.sourceColumnIds ?? [])}`,
          relation.logical.description,
        ]
          .filter(Boolean)
          .join('\n');
        return (
          <g
            key={relation.id}
            data-relation-id={relation.id}
            className={`native-table-relation${selectedId === relation.id ? ' selected' : ''}`}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${t('테이블 관계')} ${label}`}
            aria-pressed={onSelect ? selectedId === relation.id : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(relation.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onSelect?.(relation.id);
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                onSelect?.(null);
              }
            }}
          >
            <title>{description}</title>
            {onSelect && <path className="native-relation-hit" d={geometry.path} />}
            <path
              className="native-relation-stroke"
              d={geometry.path}
              markerStart={`url(#${marker(source.min, source.max as 1 | 'many')})`}
              markerEnd={`url(#${marker(target.min, target.max as 1 | 'many')})`}
              strokeDasharray={mode === 'logical' ? '6 4' : undefined}
            />
            <rect
              className="native-relation-label"
              x={geometry.labelX - width / 2}
              y={geometry.labelY - 13}
              width={width}
              height={28}
              rx={9}
            />
            <text x={geometry.labelX} y={geometry.labelY + 5} textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

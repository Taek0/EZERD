import { nativeRelationEnds, nativeRelationEndPath } from './native-relation-presentation.js';
import { memo, useId, useMemo } from 'react';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { useI18n } from '../../shared/i18n/index.js';
import { nativeRelationLabelWidth } from './native-canvas-style.js';
import { nativeTableCanvasTitle } from './native-canvas-style.js';
import type { NativeDesignDocument } from '@ezerd/model';

/** Presentational cardinalities follow the existing canvas' logical endpoint metadata. */
export const NativeTableLines = memo(function NativeTableLines({
  relations,
  mode,
  selectedId,
  onSelect,
  onHover,
  document,
}: {
  relations: ReturnType<typeof nativeCanvasScene>['relations'];
  mode: 'physical' | 'logical';
  selectedId?: string | null | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
  onHover?: ((id: string | null) => void) | undefined;
  document?: NativeDesignDocument;
}) {
  const id = useId().replaceAll(':', '');
  const { t } = useI18n();
  // Index content once per array revision; selection and hover do not change names.
  const tables = document?.tables;
  const columns = document?.columns;
  const names = useMemo(() => {
    const tableNames = new Map(
      tables?.map((table) => [table.id, nativeTableCanvasTitle(table, mode)]),
    );
    const columnNames = new Map<string, Map<string, string>>();
    for (const column of columns ?? []) {
      let names = columnNames.get(column.tableId);
      if (!names) columnNames.set(column.tableId, (names = new Map()));
      names.set(
        column.id,
        mode === 'physical'
          ? column.physical.name || column.logical.name
          : column.logical.name || column.physical.name,
      );
    }
    return { tableNames, columnNames };
  }, [tables, columns, mode]);
  const prepared = useMemo(() => {
    const endpoint = (tableId: string, ids: string[]) => {
      const name = names.tableNames.get(tableId) ?? tableId;
      const columns = ids.map((id) => names.columnNames.get(tableId)?.get(id) ?? id);
      return `${name}${columns.length ? ` (${columns.join(', ')})` : ''}`;
    };
    return relations.map((item) => ({
      ...item,
      ends: nativeRelationEnds(item.relation),
      width: nativeRelationLabelWidth(item.label),
      description: [
        item.relation.logical.name || item.label,
        `${endpoint(item.relation.targetTableId, item.relation.physical?.targetColumnIds ?? [])} → ${endpoint(item.relation.sourceTableId, item.relation.physical?.sourceColumnIds ?? [])}`,
        item.relation.logical.description,
      ]
        .filter(Boolean)
        .join('\n'),
    }));
  }, [relations, names]);
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
      {prepared.map(({ relation, geometry, label, ends: [source, target], width, description }) => {
        return (
          <g
            key={relation.id}
            data-relation-id={relation.id}
            className={`native-table-relation${selectedId === relation.id ? ' selected' : ''}`}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${t('테이블 관계')} ${label}`}
            aria-pressed={onSelect ? selectedId === relation.id : undefined}
            onPointerEnter={() => onHover?.(relation.id)}
            onPointerLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(relation.id)}
            onBlur={() => onHover?.(null)}
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
});

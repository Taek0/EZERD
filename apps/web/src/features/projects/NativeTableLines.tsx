import { nativeRelationEnds, nativeRelationEndPath } from './native-relation-presentation.js';
import { useId } from 'react';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { useI18n } from '../../shared/i18n/index.js';

/** Presentational cardinalities follow the existing canvas' logical endpoint metadata. */
export function NativeTableLines({
  relations,
  mode,
  selectedId,
  onSelect,
}: {
  relations: ReturnType<typeof nativeCanvasScene>['relations'];
  mode: 'physical' | 'logical';
  selectedId?: string | null | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
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
        const width = Math.max(90, label.length * 8 + 24);
        return (
          <g
            key={relation.id}
            data-relation-id={relation.id}
            className={`native-table-relation${selectedId === relation.id ? ' selected' : ''}`}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${t('테이블 관계')} ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(relation.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.(relation.id);
              }
              if (event.key === 'Escape') onSelect?.(null);
            }}
          >
            <title>{`${label}: ${relation.sourceTableId} → ${relation.targetTableId}`}</title>
            {onSelect && <path className="native-relation-hit" d={geometry.path} />}
            <path
              className="native-relation-stroke"
              d={geometry.path}
              markerStart={`url(#${marker(source.min, source.max as 1 | 'many')})`}
              markerEnd={`url(#${marker(target.min, target.max as 1 | 'many')})`}
              strokeDasharray={mode === 'logical' ? '6 4' : undefined}
            />
            <rect
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

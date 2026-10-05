import { useId } from 'react';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { useI18n } from '../../shared/i18n/index.js';

/** Presentational cardinalities follow the existing canvas' logical endpoint metadata. */
export function NativeTableLines({
  relations,
  mode,
}: {
  relations: ReturnType<typeof nativeCanvasScene>['relations'];
  mode: 'physical' | 'logical';
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
                <path
                  d={
                    max === 'many'
                      ? 'M 18 12 L 30 3 M 18 12 L 30 21 M 18 12 L 30 12'
                      : 'M 27 4 L 27 20'
                  }
                />
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
        const source = relation.logical.sourceCardinality ?? {
          min: 0,
          max: relation.logical.cardinality === 'one-to-one' ? 1 : 'many',
        };
        const target = relation.logical.targetCardinality ?? {
          min: relation.logical.required ? 1 : 0,
          max: relation.logical.cardinality === 'many-to-many' ? 'many' : 1,
        };
        const width = Math.max(90, label.length * 8 + 24);
        return (
          <g key={relation.id} data-relation-id={relation.id} className="native-table-relation">
            <title>{`${label}: ${relation.sourceTableId} → ${relation.targetTableId}`}</title>
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

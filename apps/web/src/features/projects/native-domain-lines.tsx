import { layoutDomainRelations } from '../domains/domain-relations.js';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import { useI18n } from '../../shared/i18n/index.js';
import { useId } from 'react';
export function nativeDomainGeometry(document: NativeDesignDocument, nodes: NodeLayout[]) {
  const cards = nodes.filter((node) =>
    document.domains.some((domain) => domain.id === node.objectId),
  );
  const geometry = layoutDomainRelations(document.domainRelations, cards);
  return document.domainRelations.flatMap((relation) => {
    const route = geometry.get(relation.id);
    return route ? [{ relation, geometry: route }] : [];
  });
}
export function NativeDomainLines({
  document,
  nodes,
  selectedId,
  onSelect,
}: {
  document: NativeDesignDocument;
  nodes: NodeLayout[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const markerId = `native-domain-arrow-${useId().replaceAll(':', '')}`;
  return (
    <svg className="native-erd-lines native-domain-lines" aria-label={t('도메인 연결')}>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          markerWidth="7"
          markerHeight="7"
          refX="9"
          refY="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {nativeDomainGeometry(document, nodes).map(({ relation, geometry }) => (
        <g
          key={relation.id}
          data-domain-relation-id={relation.id}
          data-selected={selectedId === relation.id}
          className={`native-domain-relation${selectedId === relation.id ? ' selected' : ''}`}
          tabIndex={0}
          role="button"
          aria-label={relation.name || t('도메인 연결')}
          aria-pressed={selectedId === relation.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(relation.id);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onSelect(relation.id);
            }
          }}
        >
          <path
            className="native-domain-relation-stroke"
            d={geometry.path}
            markerEnd={`url(#${markerId})`}
            {...(relation.direction === 'both' ? { markerStart: `url(#${markerId})` } : {})}
          />
          {geometry.labelAnchor && (
            <path
              className="native-domain-label-leader"
              d={`M ${geometry.labelAnchor.x} ${geometry.labelAnchor.y} L ${geometry.label.x} ${geometry.label.y + 4}`}
            />
          )}
          <text x={geometry.label.x} y={geometry.label.y} textAnchor="middle">
            {relation.name}
          </text>
          <title>{relation.description}</title>
        </g>
      ))}
    </svg>
  );
}

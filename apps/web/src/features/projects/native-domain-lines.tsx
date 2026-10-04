import { layoutDomainRelations } from '../domains/domain-relations.js';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import { useI18n } from '../../shared/i18n/index.js';
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
  return (
    <svg className="native-erd-lines" aria-label={t('도메인 연결')}>
      <defs>
        <marker
          id="native-domain-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 Z" />
        </marker>
      </defs>
      {nativeDomainGeometry(document, nodes).map(({ relation, geometry }) => (
        <g
          key={relation.id}
          data-domain-relation-id={relation.id}
          data-selected={selectedId === relation.id}
          tabIndex={0}
          role="button"
          aria-label={relation.name || t('도메인 연결')}
          style={{ pointerEvents: 'all', cursor: 'pointer' }}
          onClick={() => onSelect(relation.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(relation.id);
            }
          }}
        >
          <path
            d={geometry.path}
            markerEnd="url(#native-domain-arrow)"
            {...(relation.direction === 'both' ? { markerStart: 'url(#native-domain-arrow)' } : {})}
            style={{ strokeWidth: selectedId === relation.id ? 3 : 1.5 }}
          />
          <text x={geometry.label.x} y={geometry.label.y} textAnchor="middle">
            {relation.name}
          </text>
          <title>{relation.description}</title>
        </g>
      ))}
    </svg>
  );
}

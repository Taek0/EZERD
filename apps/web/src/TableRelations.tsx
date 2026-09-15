import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type DesignDocument,
  type ModelScope,
  isVisibleInView,
  upsertRelationLayout,
  removeTableRelation,
} from '@ezerd/model';
import { tableCardSize } from './table-geometry.js';
import { ContextMenu } from './components/ui/index.js';
import { relationGeometry } from './relation-routing.js';
export { relationGeometry } from './relation-routing.js';
import './table-relations.css';
export function applyRouteBend(
  document: DesignDocument,
  relationId: string,
  viewId: string,
  bend: { x: number; y: number },
) {
  const route = document.layout.relations?.find(
    (item) => item.relationId === relationId && item.viewId === viewId,
  );
  if (route)
    return {
      ...document,
      layout: {
        ...document.layout,
        relations: document.layout.relations?.map((item) =>
          item === route ? { ...item, bend } : item,
        ),
      },
    };
  return upsertRelationLayout(document, { relationId, viewId, offset: 0, bend });
}
export function TableRelationsSvg({
  document: doc,
  viewId,
  viewMode,
  onSelect,
  onChange,
  onPreviewChange,
  readOnly = false,
  layoutReadOnly = false,
  controlsOnly = false,
  hideControls = false,
  visibleNodeIds,
  selectedId,
}: {
  document: DesignDocument;
  viewId: string;
  viewMode: ModelScope;
  onSelect: (id: string) => void;
  onChange?: (d: DesignDocument) => void;
  onPreviewChange?: (d: DesignDocument) => void;
  readOnly?: boolean;
  layoutReadOnly?: boolean;
  controlsOnly?: boolean;
  hideControls?: boolean;
  visibleNodeIds?: string[];
  selectedId?: string | null;
}) {
  const live = useRef(doc);
  live.current = doc;
  const drag = useRef<{
    id: string;
    pointerId: number;
    start: { x: number; y: number };
    origin: { x: number; y: number };
    latestBend?: { x: number; y: number };
  } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const commitDrag = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.latestBend)
      onChange?.(applyRouteBend(live.current, active.id, viewId, active.latestBend));
  };
  return (
    <>
      {(doc.tableRelations ?? []).map((relation) => {
        const source = doc.tables?.find((table) => table.id === relation.sourceTableId);
        const target = doc.tables?.find((table) => table.id === relation.targetTableId);
        const a = doc.layout.nodes.find(
          (node) => node.objectId === relation.sourceTableId && node.viewId === viewId,
        );
        const b = doc.layout.nodes.find(
          (node) => node.objectId === relation.targetTableId && node.viewId === viewId,
        );
        if (
          !source ||
          !target ||
          !a ||
          !b ||
          !isVisibleInView(relation.scope, viewMode) ||
          !isVisibleInView(source.scope, viewMode) ||
          !isVisibleInView(target.scope, viewMode)
        )
          return null;
        if (visibleNodeIds && (!visibleNodeIds.includes(a.id) || !visibleNodeIds.includes(b.id)))
          return null;
        if (viewMode === 'physical' && !relation.physical) return null;
        const combined = doc.views?.find((view) => view.id === viewId);
        if (
          combined &&
          (!combined.domainIds.includes(source.domainId) ||
            !combined.domainIds.includes(target.domainId))
        )
          return null;
        const physical =
          viewMode !== 'logical' && !!relation.physical && relation.scope !== 'logical';
        const attribute = (relation.physical?.targetColumnIds ?? [])
          .map((id) => doc.columns?.find((c) => c.id === id)?.physical.name || '?')
          .join(', ');
        const fullLabel = `${target.physical.name || target.logical.name}.${attribute || relation.logical.name || '관계'}:${source.physical.name || source.logical.name}`;
        const label = fullLabel;
        const labelWidth = Math.max(
          90,
          [...label].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 14 : 8), 24),
        );
        const pair = (doc.tableRelations ?? []).filter(
          (r) =>
            [r.sourceTableId, r.targetTableId].sort().join(':') ===
            [relation.sourceTableId, relation.targetTableId].sort().join(':'),
        );
        const sourceBounds = { ...a, ...tableCardSize(doc, source.id, a.width, a.height) };
        const targetBounds =
          source.id === target.id
            ? sourceBounds
            : { ...b, ...tableCardSize(doc, target.id, b.width, b.height) };
        const route = doc.layout.relations?.find(
          (item) => item.relationId === relation.id && item.viewId === viewId,
        );
        const offset = route?.offset ?? 0;
        const geometry = relationGeometry(
          sourceBounds,
          targetBounds,
          labelWidth,
          pair.findIndex((r) => r.id === relation.id),
          offset,
          route?.bend,
          doc.layout.nodes
            .filter(
              (n) =>
                n.viewId === viewId &&
                n.objectId !== source.id &&
                n.objectId !== target.id &&
                doc.tables?.some((t) => t.id === n.objectId) &&
                (!visibleNodeIds || visibleNodeIds.includes(n.id)),
            )
            .map((n) => ({ ...n, ...tableCardSize(doc, n.objectId, n.width, n.height) })),
        );
        const origin = route?.bend ?? geometry.handle;
        const adjust = (bend: { x: number; y: number }, preview = false) => {
          const next = applyRouteBend(live.current, relation.id, viewId, bend);
          if (preview && drag.current?.id === relation.id) drag.current.latestBend = bend;
          (preview ? (onPreviewChange ?? onChange) : onChange)?.(next);
        };
        const worldPoint = (element: SVGGElement, clientX: number, clientY: number) => {
          const matrix = element.getScreenCTM();
          return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null;
        };
        const markerId = `table-crow-${relation.id}`;
        const endpoints = [
          relation.logical.sourceCardinality ?? {
            min: 0,
            max: relation.logical.cardinality === 'one-to-one' ? 1 : 'many',
          },
          relation.logical.targetCardinality ?? {
            min: relation.logical.required ? 1 : 0,
            max: relation.logical.cardinality === 'many-to-many' ? 'many' : 1,
          },
        ];
        const stroke = physical ? 'var(--accent)' : 'var(--muted)';
        return (
          <g
            key={relation.id}
            data-relation-id={relation.id}
            className={
              controlsOnly
                ? 'table-route-control-group'
                : `table-relation-line${selectedId === relation.id ? ' selected' : ''}`
            }
            role={controlsOnly ? undefined : 'button'}
            tabIndex={controlsOnly ? undefined : 0}
            aria-label={controlsOnly ? undefined : `테이블 관계 ${fullLabel}`}
            onContextMenu={(event) => {
              if (readOnly || !onChange) return;
              event.preventDefault();
              event.stopPropagation();
              setMenu({ x: event.clientX, y: event.clientY, id: relation.id });
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(relation.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(relation.id);
              }
            }}
          >
            {!controlsOnly && (
              <>
                <title>{`${fullLabel}${relation.logical.description ? ` — ${relation.logical.description}` : ''}`}</title>
                <defs>
                  {endpoints.map((endpoint, i) => (
                    <marker
                      key={i}
                      id={`${markerId}-${i}`}
                      viewBox="0 0 32 24"
                      refX="30"
                      refY="12"
                      markerWidth="32"
                      markerHeight="24"
                      orient="auto-start-reverse"
                      markerUnits="userSpaceOnUse"
                    >
                      <g fill="none" stroke={stroke} strokeWidth="1.7">
                        {endpoint.max === 'many' ? (
                          <path d="M 18 12 L 30 3 M 18 12 L 30 21 M 18 12 L 30 12" />
                        ) : (
                          <path d="M 27 4 L 27 20" />
                        )}
                        {endpoint.min === 0 ? (
                          <circle cx="10" cy="12" r="5" fill="#fafbfc" />
                        ) : (
                          <path d="M 13 4 L 13 20" />
                        )}
                      </g>
                    </marker>
                  ))}
                </defs>
                <path
                  className="table-relation-hit"
                  d={geometry.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                />
                <path
                  className="table-relation-stroke"
                  d={geometry.path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeDasharray={physical ? undefined : '6 4'}
                  markerStart={`url(#${markerId}-0)`}
                  markerEnd={`url(#${markerId}-1)`}
                />
                <rect
                  className="table-relation-label"
                  x={geometry.labelX - labelWidth / 2}
                  y={geometry.labelY - 13}
                  width={labelWidth}
                  height={28}
                  rx={9}
                  fill="#fafbfc"
                  stroke="#bdc8d8"
                  strokeWidth={1}
                />
                <text x={geometry.labelX} y={geometry.labelY + 5} textAnchor="middle">
                  {label}
                </text>
              </>
            )}
            {!hideControls && !readOnly && !layoutReadOnly && onChange && (
              <g
                className="table-route-adjust"
                data-export-hidden="true"
                role="button"
                tabIndex={0}
                aria-label={`관계 선 조절 ${fullLabel}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.button !== 0) return;
                  const point = worldPoint(e.currentTarget, e.clientX, e.clientY);
                  if (!point) return;
                  drag.current = { id: relation.id, pointerId: e.pointerId, start: point, origin };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const active = drag.current;
                  if (active?.id !== relation.id || active.pointerId !== e.pointerId) return;
                  e.stopPropagation();
                  const point = worldPoint(e.currentTarget, e.clientX, e.clientY);
                  if (point)
                    adjust(
                      {
                        x: active.origin.x + point.x - active.start.x,
                        y: active.origin.y + point.y - active.start.y,
                      },
                      true,
                    );
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  if (drag.current?.pointerId === e.pointerId) {
                    commitDrag();
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                }}
                onPointerCancel={commitDrag}
                onLostPointerCapture={commitDrag}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  const direction = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                  }[e.key];
                  if (direction) {
                    e.preventDefault();
                    e.stopPropagation();
                    const step = e.shiftKey ? 32 : 8;
                    adjust({
                      x: origin.x + direction[0]! * step,
                      y: origin.y + direction[1]! * step,
                    });
                  }
                }}
              >
                <title>드래그하여 관계 선 이동 · 방향키로 미세 조절</title>
                <rect
                  x={geometry.labelX + labelWidth / 2 + 6}
                  y={geometry.labelY - 13}
                  width={28}
                  height={28}
                  rx={6}
                />
                <text
                  x={geometry.labelX + labelWidth / 2 + 20}
                  y={geometry.labelY + 6}
                  textAnchor="middle"
                >
                  ⤧
                </text>
              </g>
            )}
          </g>
        );
      })}
      {menu &&
        typeof document !== 'undefined' &&
        createPortal(
          <ContextMenu
            position={menu}
            onClose={() => setMenu(null)}
            label="테이블 관계"
            items={[
              ...(!layoutReadOnly
                ? [
                    {
                      id: 'reset-route',
                      label: '관계 선 자동 정리',
                      onAction: () => {
                        if (menu && !readOnly)
                          onChange?.({
                            ...doc,
                            layout: {
                              ...doc.layout,
                              relations: (doc.layout.relations ?? []).filter(
                                (r) => r.relationId !== menu.id || r.viewId !== viewId,
                              ),
                            },
                          });
                      },
                    },
                  ]
                : []),
              {
                id: 'delete',
                label: '관계 삭제',
                destructive: true,
                onAction: () => {
                  if (menu && !readOnly) onChange?.(removeTableRelation(doc, menu.id));
                },
              },
            ]}
          />,
          document.body,
        )}
    </>
  );
}

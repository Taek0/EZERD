import { tableRelationLabel } from './table-relation-label.js';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  type DesignDocument,
  type ModelScope,
  type RelationLayout,
  isVisibleInView,
  upsertRelationLayout,
  removeTableRelation,
} from '@ezerd/model';
import { tableCardSize } from './table-geometry.js';
import { ContextMenu } from './components/ui/index.js';
import {
  relationGeometry,
  relationAnchorAtPoint,
  moveRelationSegment,
  type Point,
} from './relation-routing.js';
export { relationGeometry } from './relation-routing.js';
import './table-relations.css';
type RoutePatch = Partial<
  Pick<RelationLayout, 'bend' | 'sourceAnchor' | 'targetAnchor' | 'waypoints'>
>;
export function routePatchRollback(original: RoutePatch, changed: RoutePatch): RoutePatch {
  return Object.fromEntries(
    Object.keys(changed).map((key) => [key, original[key as keyof RoutePatch]]),
  );
}
export function applyRoutePatch(
  document: DesignDocument,
  relationId: string,
  viewId: string,
  patch: RoutePatch,
) {
  const relation = document.tableRelations?.find((item) => item.id === relationId);
  if (
    !relation ||
    ![relation.sourceTableId, relation.targetTableId].every((id) =>
      document.layout.nodes.some((node) => node.objectId === id && node.viewId === viewId),
    )
  )
    return document;
  const route = document.layout.relations?.find(
    (item) => item.relationId === relationId && item.viewId === viewId,
  );
  return upsertRelationLayout(document, { relationId, viewId, offset: 0, ...route, ...patch });
}
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
    element: SVGGElement;
    start: Point;
    points: Point[];
    kind: number | 'sourceAnchor' | 'targetAnchor';
    original: RoutePatch;
    latest?: RoutePatch;
  } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const callbacks = useRef({ onChange, onPreviewChange });
  callbacks.current = { onChange, onPreviewChange };
  const finishDrag = (commit: boolean) => {
    const active = drag.current;
    drag.current = null;
    if (!active) return;
    if (active.latest) {
      const next = applyRoutePatch(
        live.current,
        active.id,
        viewId,
        commit ? active.latest : routePatchRollback(active.original, active.latest),
      );
      (commit ? callbacks.current.onChange : callbacks.current.onPreviewChange)?.(next);
    }
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
  };
  useEffect(() => {
    if (readOnly || layoutReadOnly) finishDrag(false);
  }, [readOnly, layoutReadOnly]);
  useEffect(() => () => finishDrag(false), [viewId]);
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
        const fullLabel = tableRelationLabel(doc, relation);
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
        const obstacles = doc.layout.nodes
          .filter(
            (n) =>
              n.viewId === viewId &&
              n.objectId !== source.id &&
              n.objectId !== target.id &&
              doc.tables?.some((t) => t.id === n.objectId) &&
              (!visibleNodeIds || visibleNodeIds.includes(n.id)),
          )
          .map((n) => ({ ...n, ...tableCardSize(doc, n.objectId, n.width, n.height) }));
        const geometry = relationGeometry(
          sourceBounds,
          targetBounds,
          labelWidth,
          pair.findIndex((r) => r.id === relation.id),
          offset,
          route?.bend,
          obstacles,
          route,
        );
        const worldPoint = (element: SVGGraphicsElement, clientX: number, clientY: number) => {
          const matrix = element.getScreenCTM();
          return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null;
        };
        const segmentPatch = (points: Point[], index: number, delta: number): RoutePatch => {
          const next = moveRelationSegment(points, index, delta, [
            sourceBounds,
            targetBounds,
            ...obstacles,
          ]);
          return {
            sourceAnchor: relationAnchorAtPoint(sourceBounds, next[0]!),
            targetAnchor: relationAnchorAtPoint(targetBounds, next[next.length - 1]!),
            waypoints: next.slice(1, -1),
            bend: undefined,
          };
        };
        const endpointPatch = (
          kind: 'sourceAnchor' | 'targetAnchor',
          point: Point,
        ): RoutePatch => ({
          [kind]: relationAnchorAtPoint(
            kind === 'sourceAnchor' ? sourceBounds : targetBounds,
            point,
          ),
          bend: undefined,
          waypoints: undefined,
        });
        const beginDrag = (
          event: ReactPointerEvent<SVGElement>,
          kind: number | 'sourceAnchor' | 'targetAnchor',
        ) => {
          if (event.button !== 0 || readOnly || layoutReadOnly) return;
          event.preventDefault();
          event.stopPropagation();
          const element = event.currentTarget.closest('[data-route-controls]') as SVGGElement;
          const point = worldPoint(element, event.clientX, event.clientY);
          if (!point) return;
          drag.current = {
            id: relation.id,
            pointerId: event.pointerId,
            element,
            start: point,
            points: geometry.points,
            kind,
            original: {
              bend: route?.bend,
              sourceAnchor: route?.sourceAnchor,
              targetAnchor: route?.targetAnchor,
              waypoints: route?.waypoints,
            },
          };
          element.setPointerCapture(event.pointerId);
          onSelect(relation.id);
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
                <title>{`${relation.logical.name ? relation.logical.name + ' — ' : ''}${fullLabel}${relation.logical.description ? ` — ${relation.logical.description}` : ''}`}</title>
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
                data-route-controls="true"
                data-export-hidden="true"
                onPointerMove={(event) => {
                  const active = drag.current;
                  if (!active || active.id !== relation.id || active.pointerId !== event.pointerId)
                    return;
                  event.stopPropagation();
                  const point = worldPoint(event.currentTarget, event.clientX, event.clientY);
                  if (!point) return;
                  if (point.x === active.start.x && point.y === active.start.y && !active.latest)
                    return;
                  const patch =
                    typeof active.kind === 'number'
                      ? segmentPatch(
                          active.points,
                          active.kind,
                          active.points[active.kind]!.y === active.points[active.kind + 1]!.y
                            ? point.y - active.start.y
                            : point.x - active.start.x,
                        )
                      : endpointPatch(active.kind, point);
                  active.latest = patch;
                  onPreviewChange?.(applyRoutePatch(live.current, relation.id, viewId, patch));
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  if (drag.current?.pointerId === event.pointerId)
                    finishDrag(!readOnly && !layoutReadOnly);
                }}
                onPointerCancel={() => finishDrag(false)}
                onLostPointerCapture={() => finishDrag(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && drag.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    finishDrag(false);
                  }
                }}
              >
                {geometry.points.slice(0, -1).map((point, index) => {
                  const end = geometry.points[index + 1]!;
                  const horizontal = point.y === end.y;
                  return (
                    <path
                      key={`segment-${index}`}
                      className={`table-route-segment ${horizontal ? 'horizontal' : 'vertical'}`}
                      d={`M ${point.x} ${point.y} L ${end.x} ${end.y}`}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      role="button"
                      tabIndex={0}
                      aria-label={`관계 선 구간 ${index + 1} 조절 ${fullLabel}`}
                      onPointerDown={(event) => beginDrag(event, index)}
                      onKeyDown={(event) => {
                        const direction = horizontal
                          ? { ArrowUp: -1, ArrowDown: 1 }[event.key]
                          : { ArrowLeft: -1, ArrowRight: 1 }[event.key];
                        if (!direction) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onChange(
                          applyRoutePatch(
                            live.current,
                            relation.id,
                            viewId,
                            segmentPatch(
                              geometry.points,
                              index,
                              direction * (event.shiftKey ? 32 : 8),
                            ),
                          ),
                        );
                      }}
                    >
                      <title>직선 구간을 드래그하여 이동 · 방향키로 미세 조절</title>
                    </path>
                  );
                })}
                {(['sourceAnchor', 'targetAnchor'] as const).map((kind, index) => {
                  const point =
                    index === 0
                      ? geometry.points[0]!
                      : geometry.points[geometry.points.length - 1]!;
                  return (
                    <circle
                      key={kind}
                      cx={point.x}
                      cy={point.y}
                      r={10}
                      className={`table-route-endpoint${selectedId === relation.id ? ' selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`관계 ${index === 0 ? 'FK' : 'PK'} 연결 위치 조절 ${fullLabel}`}
                      onPointerDown={(event) => beginDrag(event, kind)}
                      onKeyDown={(event) => {
                        const direction = {
                          ArrowLeft: [-1, 0],
                          ArrowRight: [1, 0],
                          ArrowUp: [0, -1],
                          ArrowDown: [0, 1],
                        }[event.key];
                        if (!direction) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const step = event.shiftKey ? 32 : 8;
                        onChange(
                          applyRoutePatch(
                            live.current,
                            relation.id,
                            viewId,
                            endpointPatch(kind, {
                              x: point.x + direction[0]! * step,
                              y: point.y + direction[1]! * step,
                            }),
                          ),
                        );
                      }}
                    >
                      <title>연결 끝점을 카드 테두리로 드래그 · 방향키로 미세 조절</title>
                    </circle>
                  );
                })}
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

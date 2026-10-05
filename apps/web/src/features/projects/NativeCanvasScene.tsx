import { memo, type PointerEvent, type RefObject } from 'react';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { NativeDomainLines } from './native-domain-lines.js';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import { nativeCardColor } from './native-canvas-style.js';
import { useI18n } from '../../shared/i18n/index.js';

export interface NativeSceneActions {
  zoom: number;
  begin: (event: PointerEvent<HTMLElement>, node: NodeLayout) => void;
  preserve: (node: NodeLayout, x: number, y: number) => void;
  savePlacement: () => Promise<void>;
}
export interface NativeCanvasSceneProps {
  base: NativeDesignDocument;
  sharedSource: NativeDesignDocument;
  drawn: ReturnType<typeof nativeCanvasScene>;
  effectiveView: string;
  mode: 'physical' | 'logical';
  selectedNode: string | null;
  selectedTableId: string | undefined;
  selectedDomainId: string | undefined;
  selectedDomainRelation: string | null;
  draftObjectId: string | undefined;
  setSelectedNode: (id: string) => void;
  setSelectedDomainRelation: (id: string) => void;
  onSelect: (tableId: string, columnId?: string) => void;
  onSelectDomain: ((domainId: string) => void) | undefined;
  gesture: RefObject<{ node: NodeLayout; x: number; y: number; pointerId: number } | null>;
  actions: RefObject<NativeSceneActions>;
}
/** Camera state lives outside this subtree. Refs are read only by event handlers. */
export const NativeCanvasScene = memo(function NativeCanvasScene({
  base,
  sharedSource,
  drawn,
  effectiveView,
  mode,
  selectedNode,
  selectedTableId,
  selectedDomainId,
  selectedDomainRelation,
  draftObjectId,
  setSelectedNode,
  setSelectedDomainRelation,
  onSelect,
  onSelectDomain,
  gesture,
  actions,
}: NativeCanvasSceneProps) {
  const { t } = useI18n();
  return (
    <>
      <svg className="native-erd-lines" aria-label={t('외래 키')}>
        <defs>
          <marker
            id="native-fk-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 Z" />
          </marker>
        </defs>
        {drawn.relations.map(({ relation, geometry, label }) => (
          <g key={relation.id} data-relation-id={relation.id}>
            <path d={geometry.path} markerEnd="url(#native-fk-arrow)" />
            <text x={geometry.labelX} y={geometry.labelY} textAnchor="middle">
              {label}
            </text>
            <title>{`${label}: ${relation.sourceTableId} → ${relation.targetTableId}`}</title>
          </g>
        ))}
      </svg>
      {effectiveView === 'overview' && (
        <NativeDomainLines
          document={base}
          nodes={drawn.nodes}
          {...(selectedDomainRelation ? { selectedId: selectedDomainRelation } : {})}
          onSelect={setSelectedDomainRelation}
        />
      )}
      {drawn.nodes.map((node) => {
        const table = base.tables?.find((table) => table.id === node.objectId);
        const note = base.notes.find((note) => note.id === node.objectId);
        const domain = base.domains.find((domain) => domain.id === node.objectId);
        const unsavedDomain =
          !!domain && !sharedSource.layout.nodes.some((raw) => raw.id === node.id);
        const title = table
          ? (mode === 'physical' ? table.physical.name : table.logical.name) ||
            table.physical.name ||
            table.logical.name
          : (domain?.name ?? t('메모'));
        return (
          <article
            key={node.id}
            className={`native-erd-node ${table ? 'table' : note ? 'note' : 'domain'}`}
            data-node-id={node.id}
            data-object-id={node.objectId}
            aria-label={title}
            tabIndex={0}
            data-selected={
              selectedNode === node.id ||
              (!!table && table.id === selectedTableId) ||
              (!!domain && domain.id === selectedDomainId)
            }
            data-preview={unsavedDomain || undefined}
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
              borderColor: nativeCardColor(base, node.objectId),
            }}
            onFocus={() => setSelectedNode(node.id)}
            onClick={(event) => {
              setSelectedNode(node.id);
              if (table && !(event.target instanceof Element && event.target.closest('button')))
                onSelect(table.id);
              if (domain && !(event.target instanceof Element && event.target.closest('button')))
                onSelectDomain?.(domain.id);
            }}
            onPointerDown={(event) => {
              if (!unsavedDomain) actions.current.begin(event, node);
            }}
            onPointerMove={(event) => {
              const active = gesture.current;
              if (active?.pointerId !== event.pointerId) return;
              actions.current.preserve(
                active.node,
                active.node.x + (event.clientX - active.x) / actions.current.zoom,
                active.node.y + (event.clientY - active.y) / actions.current.zoom,
              );
            }}
            onPointerUp={(event) => {
              if (gesture.current?.pointerId !== event.pointerId) return;
              gesture.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              void actions.current.savePlacement();
            }}
            onPointerCancel={() => {
              gesture.current = null;
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const delta = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              }[event.key];
              if (delta) {
                event.preventDefault();
                const step = event.shiftKey ? 40 : 10;
                actions.current.preserve(
                  node,
                  node.x + delta[0]! * step,
                  node.y + delta[1]! * step,
                );
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (draftObjectId === node.objectId) void actions.current.savePlacement();
                else if (table) onSelect(table.id);
                else if (domain) onSelectDomain?.(domain.id);
              }
            }}
          >
            <header>
              {table ? (
                <button type="button" onClick={() => onSelect(table.id)}>
                  {title || t('이름 없는 테이블')}
                </button>
              ) : domain ? (
                <button type="button" onClick={() => onSelectDomain?.(domain.id)}>
                  {title}
                </button>
              ) : (
                <strong>{title}</strong>
              )}
            </header>
            {table && (
              <>
                {mode === 'physical' && table.physical.namespace.kind === 'postgresSchema' && (
                  <small>{table.physical.namespace.name || 'public'}</small>
                )}
                <table>
                  <NativeCanvasTableRows
                    document={base}
                    table={table}
                    mode={mode}
                    onSelect={onSelect}
                  />
                </table>
              </>
            )}
            {note && <p>{note.text}</p>}
            {domain && (
              <>
                <p>{domain.description}</p>
                <small>
                  {t('테이블')}:{' '}
                  {(base.tables ?? []).filter((table) => table.domainId === domain.id).length}
                </small>
                {unsavedDomain && <p>{t('저장된 배치가 없는 도메인입니다.')}</p>}
              </>
            )}
          </article>
        );
      })}
    </>
  );
});

import type { NativeInlineTarget } from './NativeCanvasInlineEditor.js';
import { memo, type PointerEvent, type RefObject } from 'react';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { NativeDomainLines } from './native-domain-lines.js';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import { NativeTableLines } from './NativeTableLines.js';
import { nativeCardColor, nativeTableHeaderColor } from './native-canvas-style.js';
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
  selectedRelationId?: string | null | undefined;
  onSelectRelation?: ((id: string | null) => void) | undefined;
  draftObjectId: string | undefined;
  setSelectedNode: (id: string) => void;
  setSelectedDomainRelation: (id: string) => void;
  onSelect: (tableId: string, columnId?: string) => void;
  onSelectDomain: ((domainId: string) => void) | undefined;
  gesture: RefObject<{ node: NodeLayout; x: number; y: number; pointerId: number } | null>;
  actions: RefObject<NativeSceneActions>;
  onEdit?: ((target: NativeInlineTarget) => void) | undefined;
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
  selectedRelationId,
  onSelectRelation,
  draftObjectId,
  setSelectedNode,
  setSelectedDomainRelation,
  onSelect,
  onSelectDomain,
  gesture,
  actions,
  onEdit,
}: NativeCanvasSceneProps) {
  const { t } = useI18n();
  return (
    <>
      <NativeTableLines
        relations={drawn.relations}
        mode={mode}
        selectedId={selectedRelationId}
        onSelect={onSelectRelation}
      />
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
              if (event.key === 'F2' && table && onEdit) {
                event.preventDefault();
                onEdit({ tableId: table.id, mode, field: 'name' });
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (draftObjectId === node.objectId) void actions.current.savePlacement();
                else if (table) onSelect(table.id);
                else if (domain) onSelectDomain?.(domain.id);
              }
            }}
          >
            <header
              className={table ? 'native-table-header' : undefined}
              style={
                table
                  ? { background: nativeTableHeaderColor(base, table), color: '#ffffff' }
                  : undefined
              }
            >
              {table ? (
                <button
                  type="button"
                  onClick={() => onSelect(table.id)}
                  onDoubleClick={() => onEdit?.({ tableId: table.id, mode, field: 'name' })}
                  onKeyDown={(event) => {
                    if (event.key === 'F2' && onEdit) {
                      event.preventDefault();
                      event.stopPropagation();
                      onEdit({ tableId: table.id, mode, field: 'name' });
                    }
                  }}
                  title={onEdit ? t('더블클릭 또는 F2로 편집') : undefined}
                >
                  {title || t('이름 없는 테이블')}
                </button>
              ) : domain ? (
                <button type="button" onClick={() => onSelectDomain?.(domain.id)}>
                  {title}
                </button>
              ) : (
                <strong>{title}</strong>
              )}
              {table && (
                <span
                  className="native-table-owner"
                  title={base.domains.find((d) => d.id === table.domainId)?.name ?? t('미지정')}
                >
                  {base.domains.find((d) => d.id === table.domainId)?.name ?? t('미지정')}
                  {mode === 'physical' && table.physical.namespace.kind === 'postgresSchema' && (
                    <span
                      className="native-table-schema"
                      title={table.physical.namespace.name || 'public'}
                    >
                      {table.physical.namespace.name || 'public'}
                    </span>
                  )}
                </span>
              )}
            </header>
            {table && (
              <>
                <table>
                  <NativeCanvasTableRows
                    document={base}
                    table={table}
                    mode={mode}
                    onSelect={onSelect}
                    onEdit={onEdit}
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

import type { NativeInlineTarget } from './NativeCanvasInlineEditor.js';
import { memo, useRef, type PointerEvent, type MouseEvent, type RefObject } from 'react';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { NativeDomainLines } from './native-domain-lines.js';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import { NativeTableLines } from './NativeTableLines.js';
import {
  nativeCardColor,
  nativeTableHeaderColor,
  nativeTableCanvasTitle,
  nativeTableCanvasNamespace,
} from './native-canvas-style.js';
import { useI18n } from '../../shared/i18n/index.js';
import { DomainDescription } from '../domains/DomainDescription.js';
import { Button, IconButton } from '../../components/ui/index.js';
import { NativeCanvasInlineCell } from './NativeCanvasInlineCell.js';
import type { NativeEditorContext } from './native-editor-form.js';
import type {
  NativeCanvasStructureRequest,
  NativeCanvasActionRequest,
} from './NativeCanvasTableRows.js';

export interface NativeSceneActions {
  zoom: number;
  begin: (event: PointerEvent<HTMLElement>, node: NodeLayout) => void;
  preserve: (
    node: NodeLayout,
    x: number,
    y: number,
    size?: { width: number; height: number },
  ) => void;
  savePlacement: () => Promise<void>;
}
export interface NativeCanvasSceneProps {
  base: NativeDesignDocument;
  sharedSource: NativeDesignDocument;
  drawn: ReturnType<typeof nativeCanvasScene>;
  effectiveView: string;
  mode: 'physical' | 'logical';
  selectedNode: string | null;
  selectedObjectIds?: string[] | undefined;
  selectedColumnId?: string | undefined;
  onNodeSelect?:
    | ((node: NodeLayout, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void)
    | undefined;
  onNodeContextMenu?: ((node: NodeLayout, event: MouseEvent<HTMLElement>) => void) | undefined;
  onConnectFromColumn?: ((columnId: string) => void) | undefined;
  onDescriptionCommit?: ((objectId: string, value: string) => void) | undefined;
  editorContext?: NativeEditorContext | undefined;
  onRequestStructure?: NativeCanvasStructureRequest | undefined;
  onRequestAction?: NativeCanvasActionRequest | undefined;
  /** Physical values mean NULL allowed; logical values mean required. */
  onToggleNullable?:
    | ((tableId: string, columnId: string, value: boolean, mode: 'physical' | 'logical') => void)
    | undefined;
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
  resizeEnabled?: boolean;
  onAddColumn?: ((tableId: string) => void) | undefined;
  onOpenDomain?: ((domainId: string) => void) | undefined;
  gesture: RefObject<{ node: NodeLayout; x: number; y: number; pointerId: number } | null>;
  actions: RefObject<NativeSceneActions>;
  onEdit?: ((target: NativeInlineTarget, focusTarget?: HTMLElement) => void) | undefined;
}
/** Camera state lives outside this subtree. Refs are read only by event handlers. */
export const NativeCanvasScene = memo(function NativeCanvasScene({
  base,
  sharedSource,
  drawn,
  effectiveView,
  mode,
  selectedNode,
  selectedObjectIds,
  selectedColumnId,
  onNodeSelect,
  onNodeContextMenu,
  onConnectFromColumn,
  onDescriptionCommit,
  editorContext,
  onRequestStructure,
  onRequestAction,
  onToggleNullable,
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
  onOpenDomain,
  onAddColumn,
  resizeEnabled = false,
  gesture,
  actions,
  onEdit,
}: NativeCanvasSceneProps) {
  const { t } = useI18n();
  return (
    <>
      <NativeTableLines
        document={base}
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
        if (!table && !note && !domain) return null;
        const unsavedDomain =
          !!domain && !sharedSource.layout.nodes.some((raw) => raw.id === node.id);
        const title = table
          ? nativeTableCanvasTitle(table, mode) || t('이름 없는 테이블')
          : (domain?.name ?? t('메모'));
        const namespace = table ? nativeTableCanvasNamespace(table, mode) : '';
        const selected = selectedObjectIds?.length
          ? selectedObjectIds.includes(node.objectId)
          : selectedNode === node.id ||
            (!!table && table.id === selectedTableId) ||
            (!!domain && domain.id === selectedDomainId);
        return (
          <article
            key={node.id}
            className={`native-erd-node canvas-node ${table ? 'table table-node' : note ? 'note note-node' : 'domain domain-node'}${selected ? ' selected' : ''}`}
            data-node-id={node.id}
            data-object-id={node.objectId}
            aria-label={title}
            role="group"
            tabIndex={0}
            data-selected={selected}
            data-preview={unsavedDomain || undefined}
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
              borderColor: selected ? 'var(--accent)' : nativeCardColor(base, node.objectId),
              ...(domain
                ? {
                    '--native-domain-color': domain.color ?? '#8993a3',
                    borderTopColor: domain.color ?? '#8993a3',
                  }
                : {}),
              ...(note
                ? {
                    '--native-note-color': note.color ?? '#fff3c4',
                    borderTopColor: note.color ?? '#fff3c4',
                  }
                : {}),
            }}
            onFocus={(event) => {
              if (event.target !== event.currentTarget || selectedObjectIds?.length) return;
              if (!onNodeSelect) setSelectedNode(node.id);
            }}
            onContextMenu={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest('input,textarea,[contenteditable="true"]')
              )
                return;
              onNodeContextMenu?.(node, event);
            }}
            onDoubleClick={(event) => {
              if (
                domain &&
                !(
                  event.target instanceof Element &&
                  event.target.closest('[data-inline-edit],textarea,input')
                )
              )
                onOpenDomain?.(domain.id);
            }}
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('input,textarea')) return;
              if (onNodeSelect) {
                onNodeSelect(node, event);
                return;
              }
              setSelectedNode(node.id);
              if (table && !(event.target instanceof Element && event.target.closest('button')))
                onSelect(table.id);
              if (domain && !(event.target instanceof Element && event.target.closest('button')))
                onSelectDomain?.(domain.id);
            }}
            onPointerDownCapture={(event) => {
              if (
                onNodeSelect &&
                (event.shiftKey || event.ctrlKey || event.metaKey) &&
                event.target instanceof Element &&
                event.target.closest('[data-inline-cell]')
              )
                event.preventDefault();
            }}
            onClickCapture={(event) => {
              if (
                onNodeSelect &&
                (event.shiftKey || event.ctrlKey || event.metaKey) &&
                event.target instanceof Element &&
                event.target.closest('[data-inline-cell]')
              ) {
                event.stopPropagation();
                onNodeSelect(node, event);
              }
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
              if (delta && !unsavedDomain) {
                event.preventDefault();
                const step = event.shiftKey ? 10 : 1;
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
                else if (domain) (onOpenDomain ?? onSelectDomain)?.(domain.id);
              }
            }}
          >
            {!note && (
              <header
                className={table ? 'native-table-header' : undefined}
                title={
                  table
                    ? `${effectiveView !== '__tables__' && effectiveView !== table.domainId ? t('외부 참조 · ') : ''}${t('소유 도메인 · {domain}', { domain: base.domains.find((d) => d.id === table.domainId)?.name ?? t('미지정') })}`
                    : undefined
                }
                style={
                  table
                    ? { background: nativeTableHeaderColor(base, table), color: '#ffffff' }
                    : undefined
                }
              >
                {domain && <span className="native-domain-overline">DOMAIN</span>}
                {table ? (
                  editorContext ? (
                    <NativeCanvasInlineCell
                      document={base}
                      target={{ tableId: table.id, mode, field: 'name' }}
                      context={editorContext}
                      title
                      display={title}
                      label={t('테이블명')}
                      className="native-table-title"
                      onSelect={() => onSelect(table.id)}
                      {...(onEdit ? { onAdvancedFormat: onEdit } : {})}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!onNodeSelect) onSelect(table.id);
                      }}
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
                  )
                ) : domain ? (
                  <h2>{title}</h2>
                ) : (
                  <strong>{title}</strong>
                )}
                {table && effectiveView === '__tables__' && (
                  <span
                    className="native-table-owner"
                    title={base.domains.find((d) => d.id === table.domainId)?.name ?? t('미지정')}
                  >
                    {base.domains.find((d) => d.id === table.domainId)?.name ?? t('미지정')}
                    {!!namespace && (
                      <span className="native-table-schema" title={namespace}>
                        {namespace}
                      </span>
                    )}
                  </span>
                )}
              </header>
            )}
            {table && (
              <>
                <NativeCanvasTableRows
                  document={base}
                  table={table}
                  mode={mode}
                  onSelect={onSelect}
                  onEdit={onEdit}
                  selectedColumnId={selectedColumnId}
                  onToggleNullable={onToggleNullable}
                  onConnectFromColumn={onConnectFromColumn}
                  editorContext={editorContext}
                  onRequestStructure={onRequestStructure}
                  onRequestAction={onRequestAction}
                  onSelectRelation={onSelectRelation}
                />
                <footer className="native-table-footer">
                  <IconButton
                    type="button"
                    aria-label={t('컬럼 추가')}
                    disabled={!onAddColumn}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onAddColumn?.(table.id)}
                  >
                    +
                  </IconButton>
                </footer>
              </>
            )}
            {note && (
              <DomainDescription
                memo
                name={t('메모')}
                value={note.text}
                readOnly={!onDescriptionCommit}
                onCommit={(value) => onDescriptionCommit?.(note.id, value)}
              />
            )}
            {domain && (
              <>
                <DomainDescription
                  name={domain.name}
                  value={domain.description}
                  readOnly={!onDescriptionCommit || unsavedDomain}
                  onCommit={(value) => onDescriptionCommit?.(domain.id, value)}
                />
                {unsavedDomain && (
                  <small className="native-domain-preview">
                    {t('저장된 배치가 없는 도메인입니다.')}
                  </small>
                )}
                {onOpenDomain && (
                  <Button
                    className="native-enter-domain"
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label={t('{name} 도메인 열기', { name: domain.name })}
                    onClick={() => onOpenDomain(domain.id)}
                  >
                    {t('도메인 열기 ↗')}
                  </Button>
                )}
              </>
            )}
            {!unsavedDomain && (
              <NativeResizeHandle node={node} actions={actions} disabled={!resizeEnabled} />
            )}
          </article>
        );
      })}
    </>
  );
});

function NativeResizeHandle({
  node,
  actions,
  disabled,
}: {
  node: NodeLayout;
  actions: RefObject<NativeSceneActions>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  return (
    <button
      type="button"
      className="native-card-resize"
      aria-label={t('카드 크기 조절')}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) return;
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          width: node.width,
          height: node.height,
        };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        event.stopPropagation();
        actions.current.preserve(node, node.x, node.y, {
          width: Math.max(
            160,
            Math.min(2000, start.width + (event.clientX - start.x) / actions.current.zoom),
          ),
          height: Math.max(
            100,
            Math.min(2000, start.height + (event.clientY - start.y) / actions.current.zoom),
          ),
        });
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        event.stopPropagation();
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        void actions.current.savePlacement();
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const delta = (
          {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10],
          } as Record<string, number[]>
        )[event.key];
        if (delta) {
          event.preventDefault();
          event.stopPropagation();
          actions.current.preserve(node, node.x, node.y, {
            width: Math.max(160, Math.min(2000, node.width + delta[0]!)),
            height: Math.max(100, Math.min(2000, node.height + delta[1]!)),
          });
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          void actions.current.savePlacement();
        }
      }}
    />
  );
}

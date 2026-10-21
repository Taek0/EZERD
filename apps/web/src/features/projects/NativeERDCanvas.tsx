import { runNativeTableLayout } from './native-table-auto-layout.js';
import { createNativeRelationArrangeController } from './native-relation-auto-arrange.js';
import {
  NativeRelationArrangeToast,
  type RelationArrangeNotice,
} from './NativeRelationArrangeToast.js';
import { useCommittedEvent } from '../../shared/hooks/use-committed-event.js';
import { createPlacementPersistence } from './native-placement-persistence.js';
import type { CommentContext } from '../comments/CommentsPanel.js';
import { pinPosition, reviewCanvasView, type ReviewTarget } from '../comments/comments-state.js';
import type { NativeDomainFilterValue } from './NativeDomainFilter.js';
import { selectionRect, intersectingObjects } from '../canvas/canvas-selection.js';
import { createSelectionFrame, retainSelection } from '../canvas/selection-frame.js';
import {
  canvasToolShortcut,
  toolShortcutInputSelector,
  toolShortcutOverlaySelector,
} from '../canvas/canvas-tool-shortcuts.js';
import {
  nativeCanvasMoveCommand,
  nativeSelectionPlacements,
  nativeAutoLayoutPlacements,
  nativeTableLayoutInput,
  nativeCanvasDraftPlacements,
  nativeZoomAt,
} from './native-canvas-selection.js';
export { nativeCanvasMoveCommand } from './native-canvas-selection.js';
import {
  copyNativeClipboard,
  prepareNativeClipboardPaste,
  readNativeClipboard,
} from './native-clipboard-helpers.js';
import { nativeClipboardMessage } from './native-clipboard.js';
import {
  rememberTableClipboard,
  readLocalTableClipboard,
} from '../../shared/clipboard/table-clipboard-store.js';
import { ConfirmProvider, useConfirm } from '../../components/ui/ConfirmProvider.js';
import { nativeCanvasDeleteCommands } from './native-canvas-delete.js';
import { createPortal } from 'react-dom';
import { NativeCanvasToolbar, NativeCameraControls } from './NativeCanvasToolbar.js';
import { NativeCanvasInputForm } from './NativeCanvasInputForm.js';
import { NativeSelectedObjectInspector } from './NativeSelectedObjectInspector.js';
export { NativeCanvasInputForm } from './NativeCanvasInputForm.js';
import { NativeRelationEditor } from './NativeRelationEditor.js';
import { NativeCanvasInlineEditor, type NativeInlineTarget } from './NativeCanvasInlineEditor.js';
import { nativeInlineKey } from './native-inline-edit.js';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type ComponentProps,
} from 'react';
import {
  nativeEditorCommandSchema,
  viewportSchema,
  nodeLayoutSchema,
  type NativeEditorCommand,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  createNativeTableCanvasMetrics,
  TABLES_VIEW_ID,
  basicCardSize,
  addTableReference,
  isVisibleInView,
  nativeColumnTypeDisplay,
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  createNativeTable,
  createNativeColumn,
  type NativeColumn,
  type NativeDesignDocument,
  type NodeLayout,
  type Viewport,
} from '@ezerd/model';
import { relationGeometry } from '../relations/relation-routing.js';
import { wheelCamera } from '../canvas/canvas-wheel.js';
import { Button, ContextMenu, AnimatedDetails } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { message } from '../../shared/api/client.js';
import { NativeEditorField, type NativeEditorSave } from './native-editor-form.js';
import {
  loadNativeEditorDraft,
  storeNativeEditorDraft,
  discardNativeEditorDraft,
  rebaseNativeEditorDraft,
  type NativeEditorDraft,
} from './native-editor-draft.js';
import './NativeERDCanvas.css';
import { useNativeExportBlocker } from './native-export-state.js';
import { nativeDurableId } from './native-durable-queue.js';
import { NativeCanvasStyleEditor } from './NativeCanvasStyleEditor.js';
import type { NativeCanvasRecoverySelection } from './native-canvas-recovery-types.js';
import { NativeDomainRelationEditor } from './NativeDomainRelationEditor.js';
import { NativeCanvasScene, type NativeSceneActions } from './NativeCanvasScene.js';
import { NativeCanvasPngExport } from './NativeCanvasPngExport.js';
import {
  nativeTableCanvasRows,
  nativeTableCanvasHeaderHeight,
  nativeRelationLabelWidth,
} from './native-canvas-style.js';
type DraftRef = { key: string; revision: string };
type CanvasCommand = NativeEditorCommand;

const MemoNativeCanvasPngExport = memo(NativeCanvasPngExport);
const MemoNativeDomainRelationEditor = memo(NativeDomainRelationEditor);
const MemoNativeCanvasStyleEditor = memo(NativeCanvasStyleEditor);
const MemoNativeCanvasActions = memo(NativeCanvasActions);

registerTranslations({
  '복구할 화면을 불러오는 중입니다. 원문은 보관된 입력에서 다운로드할 수 있습니다.':
    'Loading the recovery view. You can download its source from preserved input.',
  'Native ERD': 'Native ERD',
  '보관된 입력 복구': 'Recover saved input',
  '자동 배치': 'Automatic layout',
  '테이블 배치': 'Arrange tables',
  '테이블 배치 중…': 'Arranging tables…',
  '테이블을 배치했어요': 'Tables arranged',
  '문서가 변경되어 테이블 배치를 중단했어요':
    'Table arrangement stopped because the document changed',
  '테이블 배치를 취소했어요': 'Table arrangement cancelled',
  '테이블을 배치하지 못했어요': 'Could not arrange tables',
  '관계선 배치': 'Arrange relation lines',
  '도메인 개요': 'Domain overview',
  화면: 'View',
  '배치 저장': 'Save placement',
  '미저장 배치가 있습니다.': 'There is an unsaved placement.',
  '배치의 저장 기준이 변경되었습니다. 입력을 보관했습니다.':
    'The placement revision changed. Your input is preserved.',
  '노드 선택 후 방향키로 이동하고 Enter로 저장합니다.':
    'Select a node, move with arrow keys, and press Enter to save.',
  '참조 추가': 'Add reference',
  '참조 제거': 'Remove reference',
  '메모 추가': 'Add note',
  '메모 수정': 'Edit note',
  '메모 삭제': 'Delete note',
  중앙으로: 'Center view',
  확대: 'Zoom in',
  축소: 'Zoom out',
  '이 화면에 표시할 노드가 없습니다.': 'There are no nodes to display in this view.',
  '공유 도메인 화면은 공유 테이블 배치를 사용합니다.':
    'Shared domain views use shared table placements.',
  '도메인 선택': 'Select domains',
  작업: 'Action',
  이름: 'Name',
  메모: 'Note',
  '삭제를 확인했습니다.': 'I confirm this deletion.',
  '배치 재조회 후 비교': 'Review placement against the latest design',
  '저장된 배치가 없는 도메인입니다.': 'This domain has no saved placement.',
});

const limit = (value: number) =>
  Math.max(nodeLayoutSchema.shape.x.minValue!, Math.min(nodeLayoutSchema.shape.x.maxValue!, value));
const zoomLimit = (value: number) =>
  Math.max(
    viewportSchema.shape.zoom.minValue!,
    Math.min(viewportSchema.shape.zoom.maxValue!, value),
  );
export function nativeCanvasWheel(
  camera: Viewport,
  event: Parameters<typeof wheelCamera>[1],
  point: { x: number; y: number },
  height: number,
): Viewport {
  if (!(event.ctrlKey || event.metaKey)) {
    const next = wheelCamera(camera, event, point, height);
    return { ...next, x: limit(next.x), y: limit(next.y) };
  }
  const factor = wheelCamera({ x: 0, y: 0, zoom: 1 }, event, { x: 0, y: 0 }, height).zoom;
  const zoom = zoomLimit(camera.zoom * factor);
  return {
    ...camera,
    zoom,
    x: limit(point.x - ((point.x - camera.x) * zoom) / camera.zoom),
    y: limit(point.y - ((point.y - camera.y) * zoom) / camera.zoom),
  };
}
const expected = (snapshot: ProjectDocumentState) => ({
  version: snapshot.project.version,
  sequence: snapshot.sequence,
  databaseRevision: snapshot.project.databaseRevision,
});
const viewFor = (doc: NativeDesignDocument, viewId: string) =>
  viewId === 'overview' ? 'overview' : TABLES_VIEW_ID;
const sceneMetrics = new WeakMap<object, ReturnType<typeof createNativeTableCanvasMetrics>>();
export const nativeCanvasSceneMetrics = (scene: object) => sceneMetrics.get(scene);
/** Preview nodes can be reader-generated. Persist a real reference before moving an absent raw node. */
export function nativeCanvasScene(
  document: NativeDesignDocument,
  viewId: string,
  mode: 'physical' | 'logical',
  filter?: NativeDomainFilterValue | null,
  metricsFor = createNativeTableCanvasMetrics(document, mode),
) {
  const view = viewFor(document, viewId);
  // Placement changes still reroute every edge, but card measurements are shared by its ports.
  const tablesById = new Map((document.tables ?? []).map((table) => [table.id, table]));
  const domainIds = new Set(document.domains.map((domain) => domain.id));
  const noteIds = new Set(
    document.notes.filter((note) => note.viewId === view).map((note) => note.id),
  );
  const routesByRelation = new Map<
    string,
    NonNullable<NativeDesignDocument['layout']['relations']>[number]
  >();
  for (const route of document.layout.relations ?? [])
    if (route.viewId === view && !routesByRelation.has(route.relationId))
      routesByRelation.set(route.relationId, route);
  const sceneNodes = [...document.layout.nodes];
  if (view === 'overview') {
    const ids = new Set(sceneNodes.map((node) => node.id));
    const bottom = sceneNodes
      .filter((node) => node.viewId === view)
      .reduce(
        (max, node) =>
          Math.max(max, node.y + basicCardSize('domain', node.width, node.height).height),
        -240,
      );
    document.domains
      .filter(
        (domain) => !sceneNodes.some((node) => node.viewId === view && node.objectId === domain.id),
      )
      .forEach((domain, index) => {
        let id = `native-domain-preview:${index}`;
        while (ids.has(id)) id += ':';
        ids.add(id);
        sceneNodes.push({
          id,
          objectId: domain.id,
          viewId: view,
          x: (index % 3) * 280,
          y: limit(bottom + 280 + Math.floor(index / 3) * 250),
          width: 240,
          height: 210,
        });
      });
  }
  const nodes = sceneNodes
    .filter((node) => {
      if (node.viewId !== view) return false;
      const table = tablesById.get(node.objectId);
      if (table)
        return (
          view !== 'overview' &&
          (!filter ||
            (table.domainId === null
              ? filter.unassigned
              : filter.domainIds.includes(table.domainId))) &&
          isVisibleInView(table.scope, mode) &&
          (!domainIds.has(viewId) || table.domainId === viewId)
        );
      return noteIds.has(node.objectId) || (view === 'overview' && domainIds.has(node.objectId));
    })
    .map((node) => {
      const table = tablesById.get(node.objectId);
      const kind = table ? 'table' : domainIds.has(node.objectId) ? 'domain' : 'note';
      const size = basicCardSize(kind, node.width, node.height);
      const metrics = table ? metricsFor(table) : null;
      // Native labels drive rows; no v1 type/DDL/metrics adapter is involved.
      return {
        ...node,
        width: Math.min(
          nodeLayoutSchema.shape.width.maxValue!,
          Math.max(size.width, metrics?.width ?? size.width),
        ),
        height: Math.min(
          nodeLayoutSchema.shape.height.maxValue!,
          Math.max(size.height, metrics?.height ?? size.height),
        ),
      };
    });
  const byObject = new Map(nodes.map((node) => [node.objectId, node]));
  const relations = (document.tableRelations ?? []).flatMap((relation, lane) => {
    const source = byObject.get(relation.sourceTableId),
      target = byObject.get(relation.targetTableId);
    if (
      !source ||
      !target ||
      !isVisibleInView(relation.scope, mode) ||
      (mode === 'physical' && !relation.physical)
    )
      return [];
    const route = routesByRelation.get(relation.id);
    const label = mode === 'physical' ? (relation.physical?.name ?? '') : relation.logical.name;
    const columnAnchor = (
      node: NodeLayout,
      columnId: string | undefined,
      side: 'left' | 'right',
    ) => {
      const table = tablesById.get(node.objectId)!;
      const rows = metricsFor(table).rows;
      const index = rows.findIndex((row) => row.column.id === columnId);
      return index < 0
        ? undefined
        : {
            side,
            ratio: Math.max(
              0,
              Math.min(
                1,
                (nativeTableCanvasHeaderHeight +
                  rows.slice(0, index).reduce((height, row) => height + row.height, 0) +
                  rows[index]!.height / 2) /
                  node.height,
              ),
            ),
          };
    };
    const towardRight = target.x >= source.x;
    const sourceAnchor =
      route?.sourceAnchor ??
      (mode === 'physical'
        ? columnAnchor(
            source,
            relation.physical?.sourceColumnIds[0],
            towardRight ? 'right' : 'left',
          )
        : undefined);
    const targetAnchor =
      route?.targetAnchor ??
      (mode === 'physical'
        ? columnAnchor(
            target,
            relation.physical?.targetColumnIds[0],
            towardRight ? 'left' : 'right',
          )
        : undefined);
    const geometry = relationGeometry(
      source,
      target,
      nativeRelationLabelWidth(label),
      lane,
      route?.offset ?? 0,
      route?.bend,
      nodes.filter((node) => node !== source && node !== target),
      {
        ...(route ?? {}),
        ...(sourceAnchor ? { sourceAnchor } : {}),
        ...(targetAnchor ? { targetAnchor } : {}),
      },
    );
    return [{ relation, geometry, label }];
  });
  const scene = { nodes, relations, viewId: view };
  sceneMetrics.set(scene, metricsFor);
  return scene;
}

/** Reuse the base scene unless a persisted node in this view has a changed draft position. */
export function nativeCanvasDraftScene(
  document: NativeDesignDocument,
  scene: ReturnType<typeof nativeCanvasScene>,
  viewId: string,
  mode: 'physical' | 'logical',
  objectId?: string,
  x?: string,
  y?: string,
  filter?: NativeDomainFilterValue | null,
  width?: string,
  height?: string,
) {
  const moved = scene.nodes.find((node) => node.objectId === objectId);
  if (
    !moved ||
    !document.layout.nodes.some((node) => node.id === moved.id) ||
    (moved.x === Number(x) &&
      moved.y === Number(y) &&
      (width === undefined || moved.width === Number(width)) &&
      (height === undefined || moved.height === Number(height)))
  )
    return scene;
  const displayed = new Map(
    scene.nodes.map((node) => [
      node.id,
      node.objectId === objectId
        ? {
            ...node,
            x: Number(x),
            y: Number(y),
            ...(width === undefined ? {} : { width: Number(width) }),
            ...(height === undefined ? {} : { height: Number(height) }),
          }
        : node,
    ]),
  );
  return nativeCanvasScene(
    {
      ...document,
      layout: {
        ...document.layout,
        nodes: document.layout.nodes.map((node) => displayed.get(node.id) ?? node),
      },
    },
    viewId,
    mode,
    filter,
    sceneMetrics.get(scene),
  );
}
/** Choose group or single preview before routing, retaining malformed-draft recovery. */
export function nativeCanvasPlacementDraftScene(
  document: NativeDesignDocument,
  scene: ReturnType<typeof nativeCanvasScene>,
  viewId: string,
  mode: 'physical' | 'logical',
  values: Record<string, string>,
  filter?: NativeDomainFilterValue | null,
) {
  if (values.nodesJSON) {
    try {
      const placements = new Map(
        nativeCanvasDraftPlacements(values).map((node) => [node.id, node]),
      );
      const originals = [
        ...document.layout.nodes,
        ...scene.nodes.filter((node) => !document.layout.nodes.some((raw) => raw.id === node.id)),
      ];
      const display = {
        ...document,
        layout: {
          ...document.layout,
          nodes: originals.map((node) => placements.get(node.id) ?? node),
        },
      };
      const result = nativeCanvasScene(display, viewId, mode, filter, sceneMetrics.get(scene));
      result.nodes = result.nodes.map((node) => placements.get(node.id) ?? node);
      return result;
    } catch {
      // Corrupt group drafts retain the existing single-node recovery preview.
    }
  }
  return nativeCanvasDraftScene(
    document,
    scene,
    viewId,
    mode,
    values.objectId,
    values.x,
    values.y,
    filter,
    values.width,
    values.height,
  );
}
/** Only shared source-document inputs block export; local cameras do not change it. */
export function nativeCanvasExportBlocker(
  source: NativeDesignDocument,
  draft: NativeEditorDraft | null,
  sharedStorageFailure: boolean,
) {
  const viewId = draft?.values.viewId;
  const dirty =
    !!draft &&
    (viewId === TABLES_VIEW_ID ||
      viewId === 'overview' ||
      source.domains.some((domain) => domain.id === viewId));
  return { dirty, storageFailure: sharedStorageFailure };
}

export function NativeERDCanvas(props: ComponentProps<typeof NativeCanvasWorkspace>) {
  return (
    <ConfirmProvider>
      <NativeCanvasWorkspace {...props} />
    </ConfirmProvider>
  );
}
function NativeCanvasWorkspace({
  document,
  optimisticSourceDocument,
  snapshot,
  userId,
  editable,
  busy,
  onSave: onSaveFromParent,
  onReload: onReloadFromParent,
  mode,
  selectedTableId,
  selectedDomainId,
  onSelect: onSelectFromParent,
  onSelectDomain: onSelectDomainFromParent,
  recoverySelection,
  inspectorHost,
  routeInspectorHost,
  routeInspectorActive = true,
  recoveryOpen = false,
  inspectorOpen,
  onToggleInspector: onToggleInspectorFromParent,
  onOpenRecovery: onOpenRecoveryFromParent,
  onOpenIssues,
  onCreate: onCreateFromParent,
  onModeChange: onModeChangeFromParent,
  onViewChange: onViewChangeFromParent,
  pins,
  onReviewContext: onReviewContextFromParent,
  pinMode = false,
  onCreatePin: onCreatePinFromParent,
  reviewFocus,
  onRequestStructure: onRequestStructureFromParent,
  onRequestAction: onRequestActionFromParent,
  selectedColumnId,
  requestedView,
  onCanvasScopeChange: onCanvasScopeChangeFromParent,
  renderExportActions,
  toolbarHost,
  pathHost,
  panelToggle,
  navigatorControl,
  selectionHost,
  onRelationArrangeBusyChange,
  onArrangeSave: onArrangeSaveFromParent,
}: {
  document: NativeDesignDocument;
  /** Parent-owned validated create preview; snapshot remains the save/ACK baseline. */
  optimisticSourceDocument?: NativeDesignDocument;
  snapshot: ProjectDocumentState;
  userId?: string;
  editable: boolean;
  busy: boolean;
  /** External operations may block recovery; the pending row itself must not. */
  recoveryBusy?: boolean;
  onSave: NativeEditorSave;
  onReload: () => void;
  mode: 'physical' | 'logical';
  selectedTableId?: string;
  selectedDomainId?: string;
  onSelect: (tableId: string, columnId?: string) => void;
  onSelectDomain?: (domainId: string) => void;
  recoverySelection?: NativeCanvasRecoverySelection;
  inspectorHost?: HTMLElement | null;
  routeInspectorHost?: HTMLElement | null;
  routeInspectorActive?: boolean;
  recoveryOpen?: boolean;
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
  onOpenRecovery?: () => void;
  onOpenIssues?: () => void;
  onCreate?: (kind: 'table' | 'domain' | 'enum' | 'column') => void;
  onModeChange?: (mode: 'physical' | 'logical') => void;
  onViewChange?: (id: string) => void;
  pins?: ReactNode;
  onReviewContext?: (context: CommentContext, document: NativeDesignDocument) => void;
  pinMode?: boolean;
  onCreatePin?: (context: CommentContext) => void;
  reviewFocus?: (ReviewTarget & { nonce: number }) | null;
  onRequestStructure?: (
    action: 'patch' | 'delete' | 'foreignKey' | 'column' | 'key' | 'enum',
    target: string,
    tableId?: string,
  ) => void;
  onRequestAction?: (action: string, target: string, values?: Record<string, string>) => void;
  selectedColumnId?: string | undefined;
  requestedView?: { id: string; nonce: number };
  onCanvasScopeChange?: (scope: {
    viewId: string;
    filter: NativeDomainFilterValue | null;
    visibleObjectIds: string[];
    selectedObjectId: string | null;
    selectedNode: NodeLayout | null;
  }) => void;
  renderExportActions?: (png: {
    run: () => Promise<void>;
    disabled: boolean;
    busy: boolean;
  }) => ReactNode;
  toolbarHost?: HTMLElement | null;
  pathHost?: HTMLElement | null;
  panelToggle?: ReactNode;
  navigatorControl?: ReactNode;
  selectionHost?: HTMLElement | null;
  onRelationArrangeBusyChange?: (busy: boolean) => void;
  onArrangeSave?: (
    commands: NativeEditorCommand[],
    expectation: ReturnType<typeof expected>,
  ) => {
    operationId: string;
    completion: Promise<boolean>;
  };
}) {
  // Parent panel/resize state must not invalidate the memoized document scene.
  // Event handlers still observe the latest committed permissions and save baseline.
  const onSave = useCommittedEvent(onSaveFromParent);
  const onReload = useCommittedEvent(onReloadFromParent);
  const onArrangeSave = useCommittedEvent(onArrangeSaveFromParent);
  const onSelect = useCommittedEvent(onSelectFromParent);
  const onSelectDomain = useCommittedEvent(onSelectDomainFromParent);
  const onToggleInspector = useCommittedEvent(onToggleInspectorFromParent);
  const onOpenRecovery = useCommittedEvent(onOpenRecoveryFromParent);
  const onCreate = useCommittedEvent(onCreateFromParent);
  const onModeChange = useCommittedEvent(onModeChangeFromParent);
  const onViewChange = useCommittedEvent(onViewChangeFromParent);
  const onReviewContext = useCommittedEvent(onReviewContextFromParent);
  const onCreatePin = useCommittedEvent(onCreatePinFromParent);
  const onRequestStructure = useCommittedEvent(onRequestStructureFromParent);
  const onRequestAction = useCommittedEvent(onRequestActionFromParent);
  const onCanvasScopeChange = useCommittedEvent(onCanvasScopeChangeFromParent);
  const { t, locale } = useI18n();
  const [arrangeStatus, setArrangeStatus] = useState<RelationArrangeNotice>({
    phase: 'idle',
    canUndo: false,
  });
  const [tableArranging, setTableArranging] = useState(false);
  const [tableArrangeNotice, setTableArrangeNotice] = useState('');
  useEffect(() => {
    if (!tableArrangeNotice) return;
    const timer = setTimeout(() => setTableArrangeNotice(''), 8000);
    return () => clearTimeout(timer);
  }, [tableArrangeNotice]);
  const tableLayoutJob = useRef<AbortController | null>(null);
  const arranging = tableArranging || arrangeStatus.phase === 'computing';
  const confirm = useConfirm();
  const [descriptionId, setDescriptionId] = useState<string | null>(
    recoverySelection?.descriptionId ?? null,
  );
  useEffect(
    () => setDescriptionId(recoverySelection?.descriptionId ?? null),
    [recoverySelection?.descriptionId, userId, snapshot.project.id],
  );
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [blankSelection, setBlankSelection] = useState(false);
  useEffect(() => {
    if (selectedTableId || selectedDomainId) setBlankSelection(false);
  }, [selectedTableId, selectedDomainId]);
  const selectedObjectsRef = useRef(selectedObjectIds);
  selectedObjectsRef.current = selectedObjectIds;
  const groupOrigins = useRef<NodeLayout[] | null>(null);
  const marqueeElement = useRef<HTMLDivElement>(null);
  function setMarquee(rect: ReturnType<typeof selectionRect> | null) {
    const element = marqueeElement.current;
    if (!element) return;
    element.hidden = !rect;
    if (rect) {
      Object.assign(element.style, {
        left: rect.x + 'px',
        top: rect.y + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
      });
    }
  }
  const marqueeGesture = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    initial: string[];
  } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    source: string | null;
    columnId?: string;
    point: { x: number; y: number };
  } | null>(null);
  const [relationMenu, setRelationMenu] = useState<{
    id: string;
    kind: 'domain' | 'table';
    x: number;
    y: number;
  } | null>(null);
  const deletionBusy = useRef(false);
  const operationScope = useRef('');
  operationScope.current = JSON.stringify([
    userId,
    snapshot.project.id,
    snapshot.project.version,
    snapshot.sequence,
    snapshot.project.databaseRevision,
  ]);
  const [connection, setConnection] = useState<{
    kind: 'domain' | 'foreignKey';
    source: string;
  } | null>(null);
  const [connectPointer, setConnectPointer] = useState<{ x: number; y: number } | null>(null);
  const [viewId, setViewId] = useState(
    recoverySelection?.viewId ?? (selectedDomainId ? 'overview' : TABLES_VIEW_ID),
  );
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [sharedStorageFailure, setSharedStorageFailure] = useState(false);
  const [draft, setDraft] = useState<NativeEditorDraft | null>(null);
  const [submittedNodes, setSubmittedNodes] = useState<
    {
      revision: string;
      node: NodeLayout;
      sequence: number;
      databaseRevision: number;
      accepted: boolean;
    }[]
  >([]);
  const draftRef = useRef<NativeEditorDraft | null>(null);
  useEffect(() => {
    if (selectedDomainId && !draftRef.current && !gesture.current) setViewId('overview');
  }, [selectedDomainId]);
  const [inlineTarget, setInlineTarget] = useState<NativeInlineTarget | null>(null);
  const inlineFocusReturn = useRef<HTMLElement | null>(null);
  const closeInline = useCallback(() => setInlineTarget(null), []);
  useEffect(
    () => setInlineTarget(recoverySelection?.inline ?? null),
    [userId, snapshot.project.id, recoverySelection?.inline],
  );
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const closeRoute = useCallback(() => setSelectedRelationId(null), []);
  const [worldElement, setWorldElement] = useState<HTMLDivElement | null>(null);
  useEffect(
    () => setSelectedRelationId(recoverySelection?.routeId ?? null),
    [userId, snapshot.project.id, viewId, recoverySelection?.routeId],
  );
  const [domainFilter, setDomainFilter] = useState<NativeDomainFilterValue | null>(null);
  const navigateView = useCallback(
    (id: string, external = false) => {
      if (arranging && !external) return;
      const domain = document.domains.find((domain) => domain.id === id);
      setDomainFilter(domain ? { domainIds: [domain.id], unassigned: false } : null);
      setViewId(domain ? TABLES_VIEW_ID : id);
      onViewChange?.(domain ? TABLES_VIEW_ID : id);
    },
    [onViewChange, document.domains, arranging],
  );
  useEffect(() => {
    if (requestedView) navigateView(requestedView.id, true);
  }, [requestedView?.nonce]);
  const applyDomainFilter = useCallback(
    (filter: NativeDomainFilterValue | null) => {
      if (arranging) return;
      setViewId(TABLES_VIEW_ID);
      setDomainFilter(filter);
      onViewChange?.(TABLES_VIEW_ID);
    },
    [onViewChange, arranging],
  );
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const spacePan = useRef(false);
  const panGesture = useRef<{ pointerId: number; x: number; y: number; camera: Viewport } | null>(
    null,
  );
  const cardIdentity = JSON.stringify([
    userId,
    snapshot.project.id,
    snapshot.project.databaseRevision,
  ]);
  const cardIdentityRef = useRef(cardIdentity);
  useLayoutEffect(() => {
    cardIdentityRef.current = cardIdentity;
  }, [cardIdentity]);
  const [cardColumns, setCardColumns] = useState<{ identity: string; column: NativeColumn }[]>([]);
  const [cardFocus, setCardFocus] = useState<{
    identity: string;
    target: NativeInlineTarget;
  } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedDomainRelation, setSelectedDomainRelation] = useState<string | null>(null);
  const [camera, commitCamera] = useState<Viewport>({
    viewId: TABLES_VIEW_ID,
    x: 24,
    y: 24,
    zoom: 1,
  });
  function setCamera(viewport: Viewport) {
    commitCamera(viewport);
  }
  const gesture = useRef<{
    node: NodeLayout;
    x: number;
    y: number;
    pointerId: number;
    pending?: boolean;
  } | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const prevent = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('.native-inline-editor')) return;
      event.preventDefault();
    };
    element.addEventListener('wheel', prevent, { passive: false });
    return () => element.removeEventListener('wheel', prevent);
  }, []);
  const sharedSource =
    optimisticSourceDocument ??
    (snapshot.sourceDocument.schemaVersion === 2 ? snapshot.sourceDocument : document);
  const storedBase = document;
  useEffect(() => {
    setSubmittedNodes((entries) => {
      const remaining = entries.filter(({ node, sequence, databaseRevision, accepted }) => {
        const saved = storedBase.layout.nodes.find((candidate) => candidate.id === node.id);
        if (
          !saved ||
          databaseRevision !== snapshot.project.databaseRevision ||
          (accepted && snapshot.sequence > sequence)
        )
          return false;
        return (
          saved.x !== node.x ||
          saved.y !== node.y ||
          saved.width !== node.width ||
          saved.height !== node.height
        );
      });
      return remaining.length === entries.length ? entries : remaining;
    });
  }, [storedBase, snapshot.sequence, snapshot.project.databaseRevision]);
  useEffect(() => setSubmittedNodes([]), [userId, snapshot.project.id]);
  const base = useMemo(() => {
    const columns = cardColumns.filter(
      (entry) =>
        entry.identity === cardIdentity &&
        !storedBase.columns?.some((column) => column.id === entry.column.id),
    );
    if (!submittedNodes.length && !columns.length) return storedBase;
    const pending = new Map(submittedNodes.map(({ node }) => [node.id, node]));
    return {
      ...storedBase,
      columns: [...(storedBase.columns ?? []), ...columns.map((entry) => entry.column)],
      layout: {
        ...storedBase.layout,
        nodes: storedBase.layout.nodes.map((node) => pending.get(node.id) ?? node),
      },
    };
  }, [storedBase, submittedNodes, cardColumns, cardIdentity]);
  useEffect(() => {
    setCardColumns((entries) => {
      const remaining = entries.filter(
        (entry) =>
          entry.identity === cardIdentity &&
          !storedBase.columns?.some((column) => column.id === entry.column.id),
      );
      return remaining.length === entries.length ? entries : remaining;
    });
  }, [storedBase.columns, cardIdentity]);
  useLayoutEffect(() => {
    if (!cardFocus || cardFocus.identity !== cardIdentity || !worldElement) return;
    const key = nativeInlineKey(cardFocus.target);
    const cell = Array.from(worldElement.querySelectorAll<HTMLElement>('[data-inline-key]')).find(
      (element) => element.dataset.inlineKey === key,
    );
    if (cell) {
      cell.focus();
      setCardFocus(null);
    }
  }, [cardFocus, cardIdentity, worldElement, base]);
  const effectiveView =
    viewId === TABLES_VIEW_ID ||
    viewId === 'overview' ||
    base.domains.some((domain) => domain.id === viewId)
      ? viewId
      : TABLES_VIEW_ID;
  const recoveryWaiting =
    !!recoverySelection?.viewId && viewId === recoverySelection.viewId && effectiveView !== viewId;
  const placementEditable = editable;
  const [submittedPlacement, setSubmittedPlacement] = useState<string | null>(null);
  const placementDraftBlocked = !!draft && draft.revision !== submittedPlacement;
  const allBusy = busy || recoveryWaiting;
  const inputKey = `canvas:placement:${effectiveView}`;
  const exportState = nativeCanvasExportBlocker(sharedSource, draft, sharedStorageFailure);
  useNativeExportBlocker(
    userId ?? '',
    snapshot.project.id,
    exportState.dirty,
    exportState.storageFailure,
  );
  const stale = !!draft && draft.expected.databaseRevision !== snapshot.project.databaseRevision;
  const placementPersistence = useMemo(
    () =>
      createPlacementPersistence<NativeEditorDraft>(
        storeNativeEditorDraft,
        () => {
          setStorageError('');
          setSharedStorageFailure(false);
        },
        (error) => {
          setError(message(error));
          setStorageError(message(error));
          setSharedStorageFailure(true);
        },
      ),
    [userId, snapshot.project.id, snapshot.project.databaseRevision, inputKey],
  );
  useLayoutEffect(
    () => () => {
      placementPersistence.flush();
    },
    [placementPersistence],
  );
  useEffect(() => {
    placementPersistence.flush();
  }, [placementPersistence, selectedNode, selectedTableId, selectedDomainId]);
  useEffect(() => {
    const flush = () => {
      placementPersistence.flush();
    };
    globalThis.document?.addEventListener('visibilitychange', flush);
    if (typeof window !== 'undefined') window.addEventListener?.('pagehide', flush);
    return () => {
      globalThis.document?.removeEventListener('visibilitychange', flush);
      if (typeof window !== 'undefined') window.removeEventListener?.('pagehide', flush);
    };
  }, [placementPersistence]);
  useEffect(() => {
    gesture.current = null;
    if (!userId) {
      setDraft(null);
      draftRef.current = null;
      return;
    }
    if (recoveryWaiting) return;
    try {
      const loaded = loadNativeEditorDraft(userId, snapshot.project.id, inputKey);
      setDraft(loaded);
      draftRef.current = loaded;
    } catch (error) {
      setError(message(error));
      setStorageError(message(error));
      setSharedStorageFailure(true);
    }
  }, [recoveryWaiting, inputKey, userId, snapshot.project.id, snapshot.project.databaseRevision]);
  useEffect(() => {
    commitCamera({ viewId: effectiveView, x: 24, y: 24, zoom: 1 });
  }, [userId, snapshot.project.id, effectiveView]);
  const contentMetrics = useMemo(
    () => createNativeTableCanvasMetrics(base, mode),
    [base.tables, base.columns, base.keys, base.tableRelations, base.enums, mode],
  );
  const scene = useMemo(
    () => nativeCanvasScene(base, effectiveView, mode, domainFilter, contentMetrics),
    [base, effectiveView, mode, domainFilter, contentMetrics],
  );
  useEffect(() => {
    const node = scene.nodes.find((node) => node.objectId === recoverySelection?.objectId);
    if (node) {
      setBlankSelection(false);
      setSelectedNode(node.id);
      setSelectedObjectIds([node.objectId]);
    }
  }, [scene, recoverySelection?.objectId]);
  const draftObjectId = draft?.values.objectId;
  const draftX = draft?.values.x;
  const draftY = draft?.values.y;
  const draftWidth = draft?.values.width,
    draftHeight = draft?.values.height;
  const drawn = useMemo(
    () =>
      nativeCanvasPlacementDraftScene(
        base,
        scene,
        effectiveView,
        mode,
        draft?.values ?? {},
        domainFilter,
      ),
    [
      base,
      scene,
      draft?.values.nodesJSON,
      effectiveView,
      mode,
      domainFilter,
      draftObjectId,
      draftX,
      draftY,
      draftWidth,
      draftHeight,
    ],
  );
  useLayoutEffect(() => {
    if (tableLayoutJob.current) setTableArrangeNotice('문서가 변경되어 테이블 배치를 중단했어요');
    tableLayoutJob.current?.abort();
    tableLayoutJob.current = null;
    setTableArranging(false);
    return () => {
      tableLayoutJob.current?.abort();
    };
  }, [
    base,
    scene,
    effectiveView,
    mode,
    userId,
    snapshot,
    placementEditable,
    allBusy,
    placementDraftBlocked,
  ]);
  const arrangeEligible =
    !!userId &&
    placementEditable &&
    effectiveView === TABLES_VIEW_ID &&
    !domainFilter &&
    drawn.relations.length > 0;
  const arrangeState = useRef({
    document: base,
    scene: drawn,
    viewId: effectiveView,
    mode,
    eligible: arrangeEligible,
    snapshot,
    ...(userId ? { userId } : {}),
  });
  const arrangeController = useRef<ReturnType<typeof createNativeRelationArrangeController> | null>(
    null,
  );
  useLayoutEffect(() => {
    arrangeState.current = {
      document: base,
      scene: drawn,
      viewId: effectiveView,
      mode,
      eligible: arrangeEligible,
      snapshot,
      ...(userId ? { userId } : {}),
    };
    arrangeController.current?.update();
  }, [base, drawn, effectiveView, mode, arrangeEligible, snapshot, userId]);
  useLayoutEffect(() => {
    const controller = createNativeRelationArrangeController({
      getState: () => arrangeState.current,
      save: (commands: NativeEditorCommand[], expectation: ReturnType<typeof expected>) =>
        onArrangeSave?.(commands, expectation) ?? onSave(commands, expectation),
      onReload,
      onStatus: setArrangeStatus,
    });
    arrangeController.current = controller;
    controller.update();
    return () => {
      controller.dispose();
      arrangeController.current = null;
    };
  }, [snapshot.project.id, userId, onSave, onArrangeSave, onReload]);
  useEffect(() => {
    onRelationArrangeBusyChange?.(arranging);
    return () => onRelationArrangeBusyChange?.(false);
  }, [arranging, onRelationArrangeBusyChange]);
  const visibleSelection = useMemo(
    () => selectedObjectIds.filter((id) => scene.nodes.some((node) => node.objectId === id)),
    [selectedObjectIds, scene],
  );
  const applyMarqueePoint = useCommittedEvent((point: { x: number; y: number }) => {
    const box = marqueeGesture.current;
    if (!box) return;
    const rect = selectionRect(box.start, canvasPoint(point.x, point.y));
    setMarquee(rect);
    if (blankSelection && (rect.width || rect.height)) setBlankSelection(false);
    const next = [...new Set([...box.initial, ...intersectingObjects(rect, drawn.nodes)])];
    // Avoid even scheduling a React update when only the rectangle changed.
    if (retainSelection(selectedObjectsRef.current, next) === selectedObjectsRef.current) return;
    selectedObjectsRef.current = next;
    setSelectedObjectIds((previous) => retainSelection(previous, next));
  });
  const [marqueeFrame] = useState(() => createSelectionFrame(applyMarqueePoint));
  useEffect(() => () => marqueeFrame.cancel(), [marqueeFrame]);
  const scopeCallback = useRef(onCanvasScopeChange);
  scopeCallback.current = onCanvasScopeChange;
  useEffect(
    () =>
      scopeCallback.current?.({
        viewId: effectiveView,
        filter: domainFilter,
        visibleObjectIds: scene.nodes.map((node) => node.objectId),
        selectedObjectId: blankSelection
          ? null
          : (selectedRelationId ??
            selectedDomainRelation ??
            scene.nodes.find((node) => node.id === selectedNode)?.objectId ??
            selectedTableId ??
            selectedDomainId ??
            null),
        selectedNode: scene.nodes.find((node) => node.id === selectedNode) ?? null,
      }),
    [
      scene,
      effectiveView,
      domainFilter,
      selectedNode,
      selectedTableId,
      selectedDomainId,
      selectedRelationId,
      selectedDomainRelation,
      blankSelection,
    ],
  );
  const selectionIds = visibleSelection.length
    ? visibleSelection
    : selectedNode
      ? scene.nodes.filter((node) => node.id === selectedNode).map((node) => node.objectId)
      : selectedTableId
        ? [selectedTableId]
        : selectedDomainId
          ? [selectedDomainId]
          : [];
  useEffect(() => {
    setSelectedNode((id) =>
      id && scene.nodes.some((node) => node.id === id)
        ? id
        : selectedObjectsRef.current.length === 1
          ? (scene.nodes.find((node) => node.objectId === selectedObjectsRef.current[0])?.id ??
            null)
          : null,
    );
    setSelectedObjectIds((ids) => {
      const visible = ids.filter((id) => scene.nodes.some((node) => node.objectId === id));
      return ids.length === visible.length ? ids : visible;
    });
  }, [scene]);
  useEffect(() => {
    const id = selectedDomainId ?? selectedTableId;
    if (!id || blankSelection || selectedObjectsRef.current.length > 1) return;
    const node = scene.nodes.find((node) => node.objectId === id);
    if (node) {
      setSelectedNode(node.id);
      setSelectedObjectIds((ids) => (ids.length === 1 && ids[0] === id ? ids : [id]));
    }
  }, [scene, selectedTableId, selectedDomainId]);
  useEffect(() => {
    setMenu(null);
    setConnection(null);
    setConnectPointer(null);
    setSelectedObjectIds([]);
    setSelectedNode(null);
    marqueeFrame.cancel();
    setMarquee(null);
    marqueeGesture.current = null;
    groupOrigins.current = null;
  }, [effectiveView, userId, snapshot.project.id]);
  function preservePlacements(placements: NodeLayout[]) {
    if (!userId || !placementEditable || allBusy || stale || !placements.length) return;
    if (placements.length > 100) {
      setError(t('한 번에 저장할 객체가 너무 많습니다. 나누어서 이동해 주세요.'));
      return;
    }
    try {
      const retained = draftRef.current?.revision !== submittedPlacement ? draftRef.current : null;
      const retainedIds = retained
        ? nativeCanvasDraftPlacements(retained.values).map((node) => node.objectId)
        : [];
      if (
        retained &&
        (retainedIds.length
          ? retainedIds.some((id) => !placements.some((node) => node.objectId === id))
          : !placements.some((node) => node.objectId === retained.values.objectId))
      ) {
        setError(t('미저장 배치가 있습니다.'));
        return;
      }
      const commands = placements.map((node) =>
        nativeCanvasMoveCommand(sharedSource, node, {
          x: node.x,
          y: node.y,
        }),
      );
      const node = placements[0]!;
      const current = retained;
      const origins = placements.map(
        (node) => scene.nodes.find((raw) => raw.id === node.id) ?? node,
      );
      const next: NativeEditorDraft = {
        userId,
        projectId: snapshot.project.id,
        key: inputKey,
        revision: nativeDurableId(),
        expected: current?.expected ?? expected(snapshot),
        before: current?.before ?? {
          nodesJSON: JSON.stringify(origins),
          objectId: node.objectId,
          x: String(origins[0]!.x),
          y: String(origins[0]!.y),
          nodeId: node.id,
          viewId: node.viewId,
        },
        values: {
          nodesJSON: JSON.stringify(placements),
          objectId: node.objectId,
          x: String(node.x),
          y: String(node.y),
          nodeId: node.id,
          viewId: node.viewId,
          commands: JSON.stringify(commands),
        },
      };
      draftRef.current = next;
      setDraft(next);
      placementPersistence.enqueue(next);
      setError('');
    } catch (error) {
      setError(message(error));
      setStorageError(message(error));
      setSharedStorageFailure(true);
    }
  }
  function preserve(
    node: NodeLayout,
    x: number,
    y: number,
    size?: { width: number; height: number },
  ) {
    if (!userId || !placementEditable || allBusy || stale) return;
    if (!size && gesture.current?.pending) {
      if (Math.abs(x - gesture.current.node.x) + Math.abs(y - gesture.current.node.y) < 4) return;
      gesture.current.pending = false;
    }
    if (!size && groupOrigins.current && groupOrigins.current.length > 1) {
      const origin = groupOrigins.current.find((item) => item.id === node.id);
      if (origin)
        preservePlacements(
          nativeSelectionPlacements(groupOrigins.current, x - origin.x, y - origin.y),
        );
      return;
    }
    if (
      base.domains.some((domain) => domain.id === node.objectId) &&
      !sharedSource.layout.nodes.some((raw) => raw.id === node.id)
    )
      return;
    const command = nativeCanvasMoveCommand(sharedSource, node, {
      ...(size
        ? {
            width: Math.max(
              nodeLayoutSchema.shape.width.minValue!,
              Math.min(nodeLayoutSchema.shape.width.maxValue!, size.width),
            ),
            height: Math.max(
              nodeLayoutSchema.shape.height.minValue!,
              Math.min(nodeLayoutSchema.shape.height.maxValue!, size.height),
            ),
          }
        : { x: limit(x), y: limit(y) }),
    });
    const current = draftRef.current;
    if (
      current &&
      current.revision !== submittedPlacement &&
      current.values.objectId !== node.objectId
    ) {
      setError(t('미저장 배치가 있습니다.'));
      return;
    }
    const origin =
      current?.values.objectId === node.objectId && current.revision !== submittedPlacement
        ? current
        : null;
    const next: NativeEditorDraft = {
      userId,
      projectId: snapshot.project.id,
      key: inputKey,
      revision: nativeDurableId(),
      expected: origin?.expected ?? expected(snapshot),
      before: origin?.before ?? {
        objectId: node.objectId,
        x: String(node.x),
        y: String(node.y),
        nodeId: node.id,
        viewId: node.viewId,
      },
      values: {
        objectId: node.objectId,
        x: String(limit(x)),
        y: String(limit(y)),
        ...(size ? { width: String(size.width), height: String(size.height) } : {}),
        nodeId: node.id,
        viewId: node.viewId,
        commands: JSON.stringify([command]),
      },
    };
    draftRef.current = next;
    setDraft(next);
    try {
      placementPersistence.enqueue(next);
      setError('');
    } catch (error) {
      setError(message(error));
      setStorageError(message(error));
      setSharedStorageFailure(true);
    }
  }
  async function savePlacement() {
    groupOrigins.current = null;
    if (!placementPersistence.flush()) return;
    const current = draftRef.current;
    if (!userId || !current || !placementEditable || allBusy || stale || storageError) return;
    try {
      const commands = (JSON.parse(current.values.commands!) as unknown[]).map((command) =>
        nativeEditorCommandSchema.parse(command),
      );
      setSubmittedPlacement(current.revision);
      const placements = current.values.nodesJSON
        ? nativeCanvasDraftPlacements(current.values)
        : drawn.nodes.filter((node) => node.objectId === current.values.objectId);
      setSubmittedNodes((entries) => [
        ...entries.filter(({ node }) => !placements.some((next) => next.id === node.id)),
        ...placements.map((node) => ({
          revision: current.revision,
          node,
          sequence: snapshot.sequence,
          databaseRevision: snapshot.project.databaseRevision,
          accepted: false,
        })),
      ]);
      const saved = await onSave(commands, current.expected, {
        key: current.key,
        revision: current.revision,
      });
      setSubmittedPlacement((revision) => (revision === current.revision ? null : revision));
      if (saved)
        setSubmittedNodes((entries) =>
          entries.map((entry) =>
            entry.revision === current.revision ? { ...entry, accepted: true } : entry,
          ),
        );
      if (!saved)
        setSubmittedNodes((entries) =>
          entries.filter(({ revision }) => revision !== current.revision),
        );
      if (saved) {
        discardNativeEditorDraft(userId, snapshot.project.id, current);
        if (alive.current && draftRef.current?.revision === current.revision) {
          draftRef.current = null;
          setDraft(null);
        }
      }
    } catch (error) {
      setSubmittedPlacement((revision) => (revision === current.revision ? null : revision));
      setSubmittedNodes((entries) =>
        entries.filter(({ revision }) => revision !== current.revision),
      );
      setError(message(error));
    }
  }
  function begin(event: PointerEvent<HTMLElement>, node: NodeLayout) {
    if (
      event.button !== 0 ||
      !placementEditable ||
      allBusy ||
      stale ||
      (event.target instanceof Element &&
        event.target.closest('button,input,select,textarea,[contenteditable=true]'))
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    groupOrigins.current =
      selectedObjectsRef.current.includes(node.objectId) && selectedObjectsRef.current.length > 1
        ? scene.nodes.filter((item) => selectedObjectsRef.current.includes(item.objectId))
        : null;
    gesture.current = {
      node,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      pending: event.target instanceof Element && !!event.target.closest('.table-inline'),
    };
    setSelectedNode(node.id);
  }
  function canvasPoint(clientX: number, clientY: number) {
    const rect = surface.current?.getBoundingClientRect();
    return {
      x: limit((clientX - (rect?.left ?? 0) - camera.x) / camera.zoom),
      y: limit((clientY - (rect?.top ?? 0) - camera.y) / camera.zoom),
    };
  }
  function contextMenu(
    node: NodeLayout | null,
    event: {
      clientX: number;
      clientY: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    },
  ) {
    event.preventDefault();
    event.stopPropagation();
    setRelationMenu(null);
    if (node) setBlankSelection(false);
    if (node && !selectedObjectsRef.current.includes(node.objectId)) {
      setSelectedObjectIds([node.objectId]);
      setSelectedNode(node.id);
    }
    setMenu({
      source: node?.objectId ?? null,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 290)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 320)),
      point: canvasPoint(event.clientX, event.clientY),
    });
  }
  function selectNode(
    node: NodeLayout,
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) {
    setBlankSelection(false);
    setSelectedRelationId(null);
    setSelectedDomainRelation(null);
    if (connection) {
      void completeConnection(node.objectId);
      return;
    }
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setSelectedObjectIds((ids) =>
        ids.includes(node.objectId)
          ? ids.filter((id) => id !== node.objectId)
          : [...ids, node.objectId],
      );
    } else if (!selectedObjectsRef.current.includes(node.objectId))
      setSelectedObjectIds([node.objectId]);
    setSelectedNode(node.id);
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) {
      if (base.tables?.some((table) => table.id === node.objectId)) onSelect(node.objectId);
      else if (base.domains.some((domain) => domain.id === node.objectId))
        onSelectDomain?.(node.objectId);
    }
  }
  async function saveCommands(commands: CanvasCommand[], ref?: DraftRef): Promise<boolean> {
    if (!userId || allBusy || placementDraftBlocked || stale || storageError || !commands.length)
      return false;
    if (!editable) return false;
    return onSave(
      commands.map((command) => nativeEditorCommandSchema.parse(command)),
      expected(snapshot),
      ref,
    );
  }
  async function commitDescription(id: string, value: string) {
    if (!userId || !placementEditable || allBusy || placementDraftBlocked) return;
    const domain = sharedSource.domains.find((item) => item.id === id);
    const note = base.notes.find((item) => item.id === id);
    if (!domain && !note) return;
    const key = `canvas:description:${effectiveView}:${id}`;
    const input: NativeEditorDraft = {
      userId,
      projectId: snapshot.project.id,
      key,
      revision: nativeDurableId(),
      expected: expected(snapshot),
      before: {
        objectId: id,
        text: domain?.description ?? note?.text ?? '',
      },
      values: { objectId: id, text: value },
    };
    try {
      storeNativeEditorDraft(input);
      const command = nativeEditorCommandSchema.parse(
        domain
          ? { type: 'patch_domain', id, patch: { description: value } }
          : { type: 'patch_note', id, patch: { text: value } },
      );
      const saved = await saveCommands([command], { key, revision: input.revision });
      if (saved) discardNativeEditorDraft(userId, snapshot.project.id, input);
      else setDescriptionId(id);
    } catch (error) {
      setError(message(error));
      setDescriptionId(id);
    }
  }
  async function createObject(kind: 'table' | 'domain' | 'note', point?: { x: number; y: number }) {
    if (!placementEditable || allBusy || placementDraftBlocked) return;
    const rect = surface.current?.getBoundingClientRect();
    const at = point ?? {
      x: limit(((rect?.width ?? 800) / 2 - camera.x) / camera.zoom - 120),
      y: limit(((rect?.height ?? 600) / 2 - camera.y) / camera.zoom - 70),
    };
    const id = nativeDurableId();
    try {
      let commands: CanvasCommand[];
      if (kind === 'note')
        commands = [
          {
            type: 'upsert_note',
            value: { id, viewId: drawn.viewId, text: t('업무 설명을 입력하세요.') },
            placement: at,
          },
        ];
      else if (kind === 'domain')
        commands = [
          {
            type: 'add_domain',
            value: { id, name: t('새 도메인'), description: '', color: '#8993a3' },
            placement: at,
            nodeId: nativeDurableId(),
          },
        ];
      else {
        if (!editable) return;
        const owner = base.domains.some((d) => d.id === effectiveView)
          ? effectiveView
          : domainFilter?.domainIds.length === 1 && !domainFilter.unassigned
            ? domainFilter.domainIds[0]!
            : null;
        const table = createNativeTable(sharedSource.database, id, owner);
        table.scope = mode;
        if (
          domainFilter &&
          (owner ? !domainFilter.domainIds.includes(owner) : !domainFilter.unassigned)
        )
          applyDomainFilter(null);
        commands = [
          { type: 'add_table', value: table },
          {
            type: 'add_table_reference',
            tableId: id,
            viewId: TABLES_VIEW_ID,
            nodeId: nativeDurableId(),
            placement: at,
          },
        ];
      }
      const saving = saveCommands(commands);
      // Parent selects tables only after durable enqueue succeeds, before ACK.
      if ((await saving) && kind !== 'table') {
        setBlankSelection(false);
        setSelectedObjectIds([id]);
        if (kind === 'domain') onSelectDomain?.(id);
      }
    } catch (error) {
      setError(message(error));
    }
  }
  async function arrangeVisibleNodes() {
    if (
      !placementEditable ||
      allBusy ||
      placementDraftBlocked ||
      arranging ||
      tableLayoutJob.current
    )
      return;
    const count = scene.nodes.filter(
      (node) => !base.notes.some((note) => note.id === node.objectId),
    ).length;
    if (count > 100) {
      setError(t('한 번에 저장할 객체가 너무 많습니다. 나누어서 이동해 주세요.'));
      return;
    }
    const job = new AbortController();
    tableLayoutJob.current = job;
    setTableArrangeNotice('');
    try {
      let placements: NodeLayout[];
      if (effectiveView === 'overview') {
        placements = nativeAutoLayoutPlacements(base, scene.nodes, effectiveView, mode);
      } else {
        setTableArranging(true);
        placements = await runNativeTableLayout(
          nativeTableLayoutInput(base, scene.nodes, mode),
          job.signal,
        );
      }
      if (job.signal.aborted || tableLayoutJob.current !== job) return;
      tableLayoutJob.current = null;
      setTableArranging(false);
      const savedScope = operationScope.current;
      // One normal save preserves the existing one-operation history/undo semantics.
      const saved = await saveCommands(
        placements.map((node) =>
          nativeCanvasMoveCommand(sharedSource, node, { x: node.x, y: node.y }),
        ),
      );
      if (alive.current && operationScope.current === savedScope)
        setTableArrangeNotice(saved ? '테이블을 배치했어요' : '테이블을 배치하지 못했어요');
    } catch (error) {
      if (!job.signal.aborted) setTableArrangeNotice('테이블을 배치하지 못했어요');
    } finally {
      if (tableLayoutJob.current === job) {
        tableLayoutJob.current = null;
        setTableArranging(false);
      }
    }
  }
  async function deleteSelection(ids = selectionIds) {
    if (
      !placementEditable ||
      allBusy ||
      placementDraftBlocked ||
      deletionBusy.current ||
      !ids.length
    )
      return;
    deletionBusy.current = true;
    const scope = operationScope.current;
    try {
      const commands = nativeCanvasDeleteCommands(sharedSource, ids);
      if (!commands.length) return;
      if (
        !(await confirm({
          title:
            ids.length > 1
              ? t('선택한 객체 {count}개 삭제', { count: ids.length })
              : t('객체 삭제'),
          description: t('선택한 객체와 소유 데이터·연결 관계를 삭제할까요?'),
          confirmLabel: t('삭제'),
          destructive: true,
        }))
      )
        return;
      if (!alive.current || operationScope.current !== scope) return;
      if (await saveCommands(commands)) {
        setSelectedObjectIds([]);
        setSelectedNode(null);
      }
    } catch (error) {
      setError(message(error));
    } finally {
      deletionBusy.current = false;
    }
  }
  function copySelection(transfer?: DataTransfer, cut = false) {
    const ids = selectionIds.filter((id) => sharedSource.tables?.some((table) => table.id === id));
    if (!ids.length || (cut && !editable)) return;
    try {
      const copied = copyNativeClipboard(snapshot, ids);
      rememberTableClipboard(copied.text);
      if (transfer) transfer.setData('text/plain', copied.text);
      else void navigator.clipboard?.writeText(copied.text).catch(() => {});
      if (cut) void deleteSelection(ids);
      setError('');
    } catch (error) {
      setError(t(nativeClipboardMessage(error instanceof Error ? error.message : '')));
    }
  }
  async function pasteSelection(text: string, point?: { x: number; y: number }) {
    if (!editable || allBusy || placementDraftBlocked || effectiveView === 'overview') return;
    try {
      const domainId = base.domains.some((d) => d.id === effectiveView) ? effectiveView : null;
      const paste = prepareNativeClipboardPaste(
        snapshot,
        text,
        domainId,
        point ?? { x: limit(-camera.x / camera.zoom + 32), y: limit(-camera.y / camera.zoom + 32) },
      );
      if (!paste.plan.canApply) throw Error('clipboard.policy-blocked');
      await onSave([paste.command], expected(snapshot));
    } catch (error) {
      setError(t(nativeClipboardMessage(error instanceof Error ? error.message : '')));
    }
  }
  async function pasteFromMenu() {
    const scope = operationScope.current,
      point = menu?.point;
    let text = readLocalTableClipboard();
    try {
      if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
    } catch {}
    if (alive.current && scope === operationScope.current) await pasteSelection(text, point);
  }
  async function completeConnection(target: string) {
    if (!connection || !editable || allBusy || placementDraftBlocked) return;
    try {
      let command: CanvasCommand;
      if (connection.kind === 'domain') {
        if (effectiveView !== 'overview') return;
        if (!base.domains.some((d) => d.id === target) || target === connection.source) return;
        command = {
          type: 'add_domain_relation',
          value: {
            id: nativeDurableId(),
            sourceDomainId: connection.source,
            targetDomainId: target,
            name: '',
            description: '',
            direction: 'forward',
          },
        };
      } else {
        const column = base.columns?.find((c) => c.id === connection.source);
        const key = base.keys?.find(
          (k) =>
            k.tableId === column?.tableId &&
            k.kind === 'primary' &&
            k.columnIds.includes(connection.source),
        );
        if (!column || !key || !base.tables?.some((table) => table.id === target))
          throw Error('foreign-key.primary-key-not-found');
        command = {
          type: 'create_foreign_key',
          primaryTableId: column.tableId,
          foreignTableId: target,
          primaryKeyId: key.id,
          relationId: nativeDurableId(),
          columnIds: key.columnIds.map(() => nativeDurableId()),
        };
      }
      if (await saveCommands([command])) {
        setConnection(null);
        setConnectPointer(null);
      }
    } catch (error) {
      setError(message(error));
    }
  }
  const inlineContext = useMemo(
    () => ({
      userId: userId ?? '',
      snapshot,
      busy: allBusy || placementDraftBlocked || !editable,
      onSave,
    }),
    [userId, snapshot, allBusy, placementDraftBlocked, editable, onSave],
  );
  const addColumnFromCard = useCallback(
    async (tableId: string) => {
      if (!userId || !editable || allBusy || placementDraftBlocked) return;
      const table = base.tables?.find((item) => item.id === tableId);
      if (!table) return;
      const column = createNativeColumn(base.database, table, nativeDurableId());
      setCardColumns((entries) => [...entries, { identity: cardIdentity, column }]);
      setCardFocus({
        identity: cardIdentity,
        target: { tableId, columnId: column.id, mode, field: 'name' },
      });
      onSelect(tableId, column.id);
      try {
        const saved = await onSave([{ type: 'add_column', value: column }], expected(snapshot));
        if (!saved)
          setCardColumns((entries) => entries.filter((entry) => entry.column.id !== column.id));
      } catch (failure) {
        setCardColumns((entries) => entries.filter((entry) => entry.column.id !== column.id));
        if (cardIdentityRef.current === cardIdentity) setError(message(failure));
      }
    },
    [
      userId,
      editable,
      allBusy,
      placementDraftBlocked,
      base,
      cardIdentity,
      mode,
      onSelect,
      onSave,
      snapshot,
    ],
  );
  const routeSave = async (
    commands: CanvasCommand[],
    expectation: ReturnType<typeof expected>,
    ref: DraftRef,
  ) => {
    if (
      !userId ||
      !placementEditable ||
      allBusy ||
      draft ||
      arranging ||
      expectation.version !== snapshot.project.version ||
      expectation.sequence !== snapshot.sequence ||
      expectation.databaseRevision !== snapshot.project.databaseRevision
    )
      return false;
    return onSave(
      commands.map((command) => nativeEditorCommandSchema.parse(command)),
      expectation,
      ref,
    );
  };
  const routeSaveRef = useRef(routeSave);
  useLayoutEffect(() => {
    routeSaveRef.current = routeSave;
  });
  const routeContext = useMemo(
    () => ({
      userId: userId ?? '',
      snapshot,
      busy: allBusy || arranging || placementDraftBlocked || !placementEditable,
      affectsSharedDocument: true,
      onSave: (
        commands: CanvasCommand[],
        expectation: ReturnType<typeof expected>,
        ref: DraftRef,
      ) => routeSaveRef.current(commands, expectation, ref),
    }),
    [userId, snapshot, allBusy, arranging, placementDraftBlocked, placementEditable],
  );
  const openInline = useCallback((target: NativeInlineTarget, focusTarget?: HTMLElement) => {
    inlineFocusReturn.current = focusTarget ?? null;
    setSelectedRelationId(null);
    setInlineTarget(target);
  }, []);
  const selectRoute = useCallback(
    (id: string | null) => {
      setInlineTarget(null);
      setSelectedRelationId(id);
      setBlankSelection(false);
      setSelectedNode(null);
      setSelectedObjectIds([]);
      setSelectedDomainRelation(null);
      if (id) onRequestStructure?.('patch', JSON.stringify(['tableRelations', id]));
    },
    [onRequestStructure],
  );
  const selectDomainRelation = useCallback(
    (id: string) => {
      setSelectedDomainRelation(id);
      setBlankSelection(false);
      setSelectedNode(null);
      setSelectedObjectIds([]);
      setSelectedRelationId(null);
      onRequestAction?.('domainRelation', id);
    },
    [onRequestAction],
  );
  const sharedEditorContext = useMemo(
    () =>
      userId ? { userId, snapshot, busy: allBusy || placementDraftBlocked, onSave } : undefined,
    [userId, snapshot, allBusy, placementDraftBlocked, onSave],
  );
  const switchCanvasTool = useCommittedEvent((event: KeyboardEvent) => {
    const next = canvasToolShortcut(event, {
      editing:
        event.keyCode === 229 ||
        (event.target instanceof Element &&
          !!event.target.closest(`${toolShortcutInputSelector},.native-inline-editor`)),
      overlayOpen: !!globalThis.document?.querySelector(toolShortcutOverlaySelector),
      dragging: !!gesture.current || !!panGesture.current || !!marqueeGesture.current,
    });
    if (next) {
      event.preventDefault();
      setTool(next);
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('keydown', switchCanvasTool);
    return () => window.removeEventListener('keydown', switchCanvasTool);
  }, [switchCanvasTool]);
  const sceneActions = useRef<NativeSceneActions>({
    zoom: camera.zoom,
    begin,
    preserve,
    savePlacement,
  });
  useLayoutEffect(() => {
    sceneActions.current = { zoom: camera.zoom, begin, preserve, savePlacement };
  });
  const sceneCallbacks = useRef({
    selectNode,
    contextMenu,
    commitDescription,
    toggleNullable: (
      tableId: string,
      columnId: string,
      value: boolean,
      viewMode: 'logical' | 'physical',
    ) => {
      const primary = (sharedSource.keys ?? []).some(
        (key) =>
          key.tableId === tableId &&
          key.kind === 'primary' &&
          key.scope !== 'logical' &&
          key.columnIds.includes(columnId),
      );
      if (viewMode === 'physical' && value && primary) return;
      void saveCommands([
        nativeEditorCommandSchema.parse({
          type: 'patch_column',
          id: columnId,
          patch:
            viewMode === 'physical'
              ? { physical: { nullable: value } }
              : { logical: { required: value } },
        }),
      ]);
    },
  });
  useLayoutEffect(() => {
    sceneCallbacks.current = {
      ...sceneCallbacks.current,
      selectNode,
      contextMenu,
      commitDescription,
      toggleNullable: (tableId, columnId, value, viewMode) => {
        const primary = (sharedSource.keys ?? []).some(
          (key) =>
            key.tableId === tableId &&
            key.kind === 'primary' &&
            key.scope !== 'logical' &&
            key.columnIds.includes(columnId),
        );
        if (viewMode === 'physical' && value && primary) return;
        void saveCommands([
          nativeEditorCommandSchema.parse({
            type: 'patch_column',
            id: columnId,
            patch:
              viewMode === 'physical'
                ? { physical: { nullable: value } }
                : { logical: { required: value } },
          }),
        ]);
      },
    };
  });
  const selectNodeLatest = useCallback(
    (...args: Parameters<typeof selectNode>) => sceneCallbacks.current.selectNode(...args),
    [],
  );
  const nodeMenuLatest = useCallback(
    (...args: Parameters<typeof contextMenu>) => sceneCallbacks.current.contextMenu(...args),
    [],
  );
  const commitDescriptionLatest = useCallback((id: string, value: string) => {
    void sceneCallbacks.current.commitDescription(id, value);
  }, []);
  const toggleNullableLatest = useCallback(
    (tableId: string, columnId: string, value: boolean, viewMode: 'logical' | 'physical') =>
      sceneCallbacks.current.toggleNullable(tableId, columnId, value, viewMode),
    [],
  );
  const connectFromColumn = useCallback((source: string) => {
    setConnection({ kind: 'foreignKey', source });
    setConnectPointer(null);
  }, []);
  const toolbarViews = useMemo(
    () => [
      { id: TABLES_VIEW_ID, name: t('전체 테이블') },
      { id: 'overview', name: t('도메인 맵') },
      ...base.domains.map((domain) => ({ id: domain.id, name: domain.name })),
    ],
    [base.domains, locale],
  );
  const routeEditor =
    selectedRelationId && userId && (placementEditable || recoverySelection?.routeId) ? (
      <NativeRelationEditor
        key={`${userId}:${snapshot.project.id}:${effectiveView}:${selectedRelationId}`}
        document={base}
        scene={drawn}
        viewId={drawn.viewId}
        relationId={selectedRelationId}
        world={worldElement}
        context={routeContext}
        active={routeInspectorActive}
        onClose={closeRoute}
      />
    ) : null;
  const auxiliary = (
    <>
      <div className="native-canvas-settings">
        {(inspectorHost === undefined || recoverySelection?.domainRelation) && (
          <MemoNativeDomainRelationEditor
            allowCreate={effectiveView === 'overview'}
            document={sharedSource}
            editable={editable}
            {...(recoverySelection?.domainRelation
              ? {
                  initialAction: recoverySelection.domainRelation.action,
                  ...(recoverySelection.domainRelation.id
                    ? { selectedId: recoverySelection.domainRelation.id }
                    : {}),
                }
              : selectedDomainRelation
                ? { selectedId: selectedDomainRelation }
                : {})}
            {...(sharedEditorContext ? { context: sharedEditorContext } : {})}
          />
        )}
        {recoverySelection?.style && (
          <MemoNativeCanvasStyleEditor
            document={sharedSource}
            editable={editable}
            {...(selectedTableId ? { selectedTableId } : {})}
            {...(selectedDomainId ? { selectedDomainId } : {})}
            {...(recoverySelection?.style ? { initialSelection: recoverySelection.style } : {})}
            {...(sharedEditorContext ? { context: sharedEditorContext } : {})}
          />
        )}
        {recoveryWaiting && (
          <p role="status">
            {t('복구할 화면을 불러오는 중입니다. 원문은 보관된 입력에서 다운로드할 수 있습니다.')}
          </p>
        )}
        {userId && editable && !recoveryWaiting && recoverySelection?.action && (
          <MemoNativeCanvasActions
            key={JSON.stringify([
              userId,
              snapshot.project.id,
              snapshot.project.databaseRevision,
              effectiveView,
            ])}
            document={base}
            source={sharedSource}
            snapshot={snapshot}
            userId={userId}
            viewId={effectiveView}
            busy={allBusy || placementDraftBlocked}
            onSharedSave={onSave}
            sharedEditable={editable}
            initialSelection={recoverySelection.action}
          />
        )}
      </div>
    </>
  );
  const exportControl = useMemo(
    () => (
      <MemoNativeCanvasPngExport
        snapshot={snapshot}
        {...(userId ? { userId } : {})}
        viewId={effectiveView}
        mode={mode}
        sceneFor={nativeCanvasScene}
        filter={domainFilter}
        {...(renderExportActions ? { renderControl: renderExportActions } : {})}
      />
    ),
    [snapshot, userId, effectiveView, mode, domainFilter, renderExportActions],
  );
  const reviewCallback = useRef(onReviewContext);
  reviewCallback.current = onReviewContext;
  useEffect(() => {
    reviewCallback.current?.(
      {
        viewId: effectiveView,
        selectedObjectId:
          scene.nodes.find((node) => node.id === selectedNode)?.objectId ??
          selectedRelationId ??
          selectedDomainRelation ??
          selectedDomainId ??
          selectedTableId ??
          null,
        visibleObjectIds: scene.nodes.map((node) => node.objectId),
        position: (() => {
          const node = scene.nodes.find((node) => node.id === selectedNode);
          const rect = surface.current?.getBoundingClientRect();
          return node
            ? { x: node.x + node.width / 2, y: node.y + node.height / 2 }
            : {
                x: ((rect?.width ?? 800) / 2 - camera.x) / camera.zoom,
                y: ((rect?.height ?? 600) / 2 - camera.y) / camera.zoom,
              };
        })(),
      },
      base,
    );
  }, [
    base,
    scene,
    effectiveView,
    selectedDomainId,
    selectedTableId,
    selectedNode,
    selectedRelationId,
    selectedDomainRelation,
  ]);
  useEffect(() => {
    if (!reviewFocus) return;
    const view = reviewCanvasView(base, reviewFocus);
    const point = pinPosition(base, reviewFocus);
    if (effectiveView !== view) {
      navigateView(view);
      return;
    }
    const rect = surface.current?.getBoundingClientRect();
    setCamera({
      viewId: view,
      x: (rect?.width ?? 800) / 2 - point.x,
      y: (rect?.height ?? 600) / 2 - point.y,
      zoom: 1,
    });
  }, [reviewFocus?.nonce, effectiveView]);
  const toolbar = (
    <NativeCanvasToolbar
      {...{ panelToggle, navigatorControl }}
      {...(pathHost !== undefined ? { pathHost } : {})}
      exportControl={exportControl}
      viewId={effectiveView}
      views={toolbarViews}
      onView={navigateView}
      domains={base.domains}
      filter={domainFilter}
      onFilter={applyDomainFilter}
      onCreate={(kind) => {
        if (kind === 'enum') {
          if (onRequestAction) onRequestAction('enums', '');
          else onCreate?.('enum');
        } else void createObject(kind);
      }}
      onNote={() => void createObject('note')}
      onOpenIssues={onOpenIssues}
      onOpenEnums={() => onRequestAction?.('enums', '')}
      onOpenRecovery={onOpenRecoveryFromParent ? onOpenRecovery : undefined}
      editable={editable}
      noteEditable={placementEditable}
      disabled={!!draft}
      navigationLocked={arranging}
      mode={mode}
      onMode={onModeChange}
      inspectorOpen={inspectorOpen}
      onToggleInspector={onToggleInspector}
    />
  );
  const selectedObjectNode = scene.nodes.find((node) => node.id === selectedNode);
  const selectionInspector = selectedObjectNode && userId && (
    <NativeSelectedObjectInspector
      document={sharedSource}
      node={selectedObjectNode}
      viewId={effectiveView}
      context={{
        userId,
        snapshot,
        busy: allBusy || placementDraftBlocked || !placementEditable,
        affectsSharedDocument: true,
        onSave: (commands, exp, ref) => routeSave(commands, exp, ref),
      }}
    />
  );
  return (
    <section className="native-erd" aria-label={t('Native ERD')}>
      {toolbarHost === undefined
        ? toolbar
        : toolbarHost
          ? createPortal(toolbar, toolbarHost)
          : null}
      {error && (recoveryOpen || error !== t('미저장 배치가 있습니다.')) && (
        <p role="alert">{error}</p>
      )}
      {base.domains.some((domain) => domain.id === effectiveView) && (
        <p>{t('공유 도메인 화면은 공유 테이블 배치를 사용합니다.')}</p>
      )}

      {draft && (recoveryOpen || stale) && (
        <div role="status">
          <p>
            {t(
              stale
                ? '배치의 저장 기준이 변경되었습니다. 입력을 보관했습니다.'
                : '미저장 배치가 있습니다.',
            )}
          </p>
          {stale && (
            <>
              <dl>
                <dt>{t('현재 값')}</dt>
                <dd>
                  {scene.nodes.find((node) => node.objectId === draft.values.objectId)?.x},{' '}
                  {scene.nodes.find((node) => node.objectId === draft.values.objectId)?.y}
                </dd>
                <dt>{t('미저장 배치가 있습니다.')}</dt>
                <dd>
                  {draft.values.x}, {draft.values.y}
                </dd>
              </dl>
              <Button
                disabled={
                  !placementEditable ||
                  allBusy ||
                  draft.expected.databaseRevision !== snapshot.project.databaseRevision ||
                  !scene.nodes.some((node) => node.objectId === draft.values.objectId)
                }
                onClick={() => {
                  const node = scene.nodes.find((node) => node.objectId === draft.values.objectId);
                  if (!node || !userId) return;
                  try {
                    const placements = nativeCanvasDraftPlacements(draft.values);
                    if (placements.length) {
                      const currentNodes = placements.map((saved) => {
                        const current = scene.nodes.find(
                          (raw) => raw.objectId === saved.objectId && raw.viewId === saved.viewId,
                        );
                        if (!current) throw Error('canvas.node-not-found');
                        return {
                          ...current,
                          x: saved.x,
                          y: saved.y,
                          width: saved.width,
                          height: saved.height,
                        };
                      });
                      const next = {
                        ...draft,
                        revision: nativeDurableId(),
                        expected: expected(snapshot),
                        before: {
                          ...draft.before,
                          nodesJSON: JSON.stringify(
                            scene.nodes.filter((raw) =>
                              placements.some((saved) => saved.objectId === raw.objectId),
                            ),
                          ),
                        },
                        values: {
                          ...draft.values,
                          nodesJSON: JSON.stringify(currentNodes),
                          commands: JSON.stringify(
                            currentNodes.map((current) =>
                              nativeCanvasMoveCommand(sharedSource, current, {
                                x: current.x,
                                y: current.y,
                              }),
                            ),
                          ),
                        },
                      };
                      draftRef.current = next;
                      setDraft(next);
                      storeNativeEditorDraft(next);
                      setError('');
                      setStorageError('');
                      setSharedStorageFailure(false);
                      return;
                    }
                    const command = nativeCanvasMoveCommand(sharedSource, node, {
                      x: Number(draft.values.x),
                      y: Number(draft.values.y),
                    });
                    const next = {
                      ...draft,
                      revision: nativeDurableId(),
                      expected: expected(snapshot),
                      before: {
                        objectId: node.objectId,
                        x: String(node.x),
                        y: String(node.y),
                        nodeId: node.id,
                        viewId: node.viewId,
                      },
                      values: {
                        ...draft.values,
                        commands: JSON.stringify([command]),
                        nodeId: node.id,
                        viewId: node.viewId,
                      },
                    };
                    draftRef.current = next;
                    setDraft(next);
                    storeNativeEditorDraft(next);
                    setError('');
                    setStorageError('');
                    setSharedStorageFailure(false);
                  } catch (error) {
                    setError(message(error));
                    setStorageError(message(error));
                    setSharedStorageFailure(true);
                  }
                }}
              >
                {t('최신 저장 내용과 비교 후 수정')}
              </Button>
            </>
          )}
          <Button
            disabled={!placementEditable || allBusy || stale || !!storageError}
            onClick={() => void savePlacement()}
          >
            {t('배치 저장')}
          </Button>
        </div>
      )}
      <div
        data-arranging={arranging || undefined}
        className={`native-erd-surface canvas-surface${tool === 'hand' ? ' hand-tool' : ''}${pinMode ? ' pin-mode' : ''}`}
        style={{
          backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
          backgroundImage: `radial-gradient(circle, var(--erd-grid-dot-color) ${1.05 * camera.zoom}px, transparent ${1.15 * camera.zoom}px)`,
        }}
        onContextMenu={(event) => {
          if (event.target instanceof Element && event.target.closest(toolShortcutInputSelector))
            return;
          const relationElement =
            event.target instanceof Element ? event.target.closest('[data-relation-id]') : null;
          if (relationElement) {
            event.preventDefault();
            event.stopPropagation();
            const id = relationElement.getAttribute('data-relation-id')!;
            setMenu(null);
            setRelationMenu({
              id,
              kind: base.domainRelations.some((relation) => relation.id === id)
                ? 'domain'
                : 'table',
              x: Math.max(8, Math.min(event.clientX, window.innerWidth - 290)),
              y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)),
            });
            return;
          }
          const element =
            event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
          contextMenu(
            element
              ? (scene.nodes.find((node) => node.id === element.getAttribute('data-node-id')) ??
                  null)
              : null,
            event,
          );
        }}
        onCopy={(event) => {
          if (
            tool === 'hand' ||
            (event.target instanceof Element && event.target.closest(toolShortcutInputSelector))
          )
            return;
          if (!selectionIds.some((id) => sharedSource.tables?.some((table) => table.id === id)))
            return;
          event.preventDefault();
          event.stopPropagation();
          copySelection(event.clipboardData);
        }}
        onCut={(event) => {
          if (
            !editable ||
            allBusy ||
            draft ||
            tool === 'hand' ||
            (event.target instanceof Element && event.target.closest(toolShortcutInputSelector))
          )
            return;
          if (!selectionIds.some((id) => sharedSource.tables?.some((table) => table.id === id)))
            return;
          event.preventDefault();
          event.stopPropagation();
          copySelection(event.clipboardData, true);
        }}
        onPaste={(event) => {
          if (
            !editable ||
            allBusy ||
            draft ||
            tool === 'hand' ||
            (event.target instanceof Element && event.target.closest(toolShortcutInputSelector))
          )
            return;
          const text = event.clipboardData.getData('text/plain');
          try {
            readNativeClipboard(text);
          } catch {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void pasteSelection(text);
        }}
        onPointerDownCapture={(event) => {
          // React portals retain ancestry, but their options are not canvas space.
          if (!event.currentTarget.contains(event.target as Node)) return;
          setMenu(null);
          setRelationMenu(null);
          // Route handles are portalled into the world, outside the editor's DOM subtree.
          // Let their own pointer capture run before canvas selection, panning or pin creation.
          if (event.target instanceof Element && event.target.closest('.native-route-controls'))
            return;
          if (
            pinMode &&
            event.button === 0 &&
            onCreatePin &&
            !(
              event.target instanceof Element &&
              event.target.closest('.native-camera-controls,.comment-pin,.native-inline-editor')
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onCreatePin({
              viewId: effectiveView,
              selectedObjectId: null,
              visibleObjectIds: scene.nodes.map((node) => node.objectId),
              position: {
                x: (event.clientX - rect.left - camera.x) / camera.zoom,
                y: (event.clientY - rect.top - camera.y) / camera.zoom,
              },
            });
            return;
          }
          if (
            event.target instanceof Element &&
            event.target.closest('.native-inline-editor,.native-camera-controls')
          )
            return;
          if (!(tool === 'hand' || spacePan.current || event.button === 1)) {
            if (
              event.button === 0 &&
              event.target instanceof Element &&
              !event.target.closest(
                '[data-node-id],button,.native-inline-editor,.relations,.native-table-lines,.comment-pin',
              )
            ) {
              event.currentTarget.setPointerCapture(event.pointerId);
              marqueeFrame.cancel();
              const start = canvasPoint(event.clientX, event.clientY);
              marqueeGesture.current = {
                pointerId: event.pointerId,
                start,
                initial: event.shiftKey ? selectedObjectsRef.current : [],
              };
              setMarquee(selectionRect(start, start));
              if (!event.shiftKey) {
                setSelectedObjectIds([]);
                setSelectedNode(null);
                setBlankSelection(true);
                setSelectedRelationId(null);
                setSelectedDomainRelation(null);
              }
            }
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          panGesture.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            camera,
          };
        }}
        onPointerMove={(event) => {
          if (connection) setConnectPointer(canvasPoint(event.clientX, event.clientY));
          const box = marqueeGesture.current;
          if (box?.pointerId === event.pointerId) {
            marqueeFrame.schedule({ x: event.clientX, y: event.clientY });
            return;
          }
          const pan = panGesture.current;
          if (pan?.pointerId !== event.pointerId) return;
          event.stopPropagation();
          setCamera({
            ...pan.camera,
            x: limit(pan.camera.x + event.clientX - pan.x),
            y: limit(pan.camera.y + event.clientY - pan.y),
          });
        }}
        onPointerUp={(event) => {
          if (marqueeGesture.current?.pointerId === event.pointerId) {
            // Release may arrive before the scheduled frame; include its final position.
            marqueeFrame.schedule({ x: event.clientX, y: event.clientY });
            marqueeFrame.flush();
            marqueeGesture.current = null;
            marqueeFrame.cancel();
            setMarquee(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          if (panGesture.current?.pointerId !== event.pointerId) return;
          event.stopPropagation();
          panGesture.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          placementPersistence.flush();
          panGesture.current = null;
          marqueeGesture.current = null;
          marqueeFrame.cancel();
          setMarquee(null);
          groupOrigins.current = null;
          spacePan.current = false;
        }}
        onLostPointerCapture={(event) => {
          placementPersistence.flush();
          if (panGesture.current?.pointerId === event.pointerId) panGesture.current = null;
          if (marqueeGesture.current?.pointerId === event.pointerId) {
            marqueeFrame.cancel();
            marqueeGesture.current = null;
            setMarquee(null);
          }
        }}
        onClickCapture={(event) => {
          // Portalled menu actions belong to the overlay, even in hand/connection mode.
          if (!event.currentTarget.contains(event.target as Node)) return;
          if (connection && event.target instanceof Element) {
            const node = event.target.closest('[data-object-id]');
            if (node) {
              event.stopPropagation();
              void completeConnection(node.getAttribute('data-object-id')!);
              return;
            }
          }
          if (
            tool === 'hand' &&
            !(
              event.target instanceof Element &&
              event.target.closest('.native-inline-editor,.native-camera-controls')
            )
          )
            event.stopPropagation();
        }}
        onKeyDownCapture={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return;
          if (
            event.target instanceof Element &&
            event.target.closest(`${toolShortcutInputSelector},.native-inline-editor`)
          )
            return;
          if (
            event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            event.repeat ||
            globalThis.document?.querySelector(toolShortcutOverlaySelector)
          )
            return;
          if (event.key === 'Escape') {
            setConnection(null);
            setConnectPointer(null);
            setMenu(null);
            marqueeFrame.cancel();
            setMarquee(null);
            marqueeGesture.current = null;
            setSelectedObjectIds([]);
            return;
          }
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            // The original column menu owns its capture phase and selected column context.
            if (event.target instanceof Element && event.target.closest('[data-column-id]')) return;
            event.preventDefault();
            const node = scene.nodes.find((node) => node.id === selectedNode),
              rect =
                event.target instanceof Element
                  ? event.target.getBoundingClientRect()
                  : event.currentTarget.getBoundingClientRect();
            contextMenu(node ?? null, {
              clientX: rect.left + 20,
              clientY: rect.top + 30,
              preventDefault: () => {},
              stopPropagation: () => {},
            });
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            setSelectedObjectIds(scene.nodes.map((node) => node.objectId));
            return;
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'v' &&
            readLocalTableClipboard()
          ) {
            event.preventDefault();
            void pasteSelection(readLocalTableClipboard());
            return;
          }
          if (
            event.key === 'Delete' &&
            tool === 'select' &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            void deleteSelection();
            return;
          }
          if (
            visibleSelection.length > 1 &&
            event.target instanceof Element &&
            event.target.matches('[data-node-id]')
          ) {
            const delta = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            }[event.key];
            if (delta && placementEditable && !allBusy && !stale) {
              event.preventDefault();
              event.stopPropagation();
              const step = event.shiftKey ? 10 : 1;
              preservePlacements(
                nativeSelectionPlacements(
                  drawn.nodes.filter((node) => visibleSelection.includes(node.objectId)),
                  delta[0]! * step,
                  delta[1]! * step,
                ),
              );
              return;
            }
            if (event.key === 'Enter' && draft) {
              event.preventDefault();
              event.stopPropagation();
              void savePlacement();
              return;
            }
          }
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (
            event.code === 'Space' &&
            !(event.target instanceof Element && event.target.closest('button,[role=button]'))
          ) {
            event.preventDefault();
            spacePan.current = true;
          }
          switchCanvasTool(event.nativeEvent);
        }}
        onKeyUpCapture={(event) => {
          if (event.code === 'Space') spacePan.current = false;
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            placementPersistence.flush();
            spacePan.current = false;
            panGesture.current = null;
          }
        }}
        ref={surface}
        tabIndex={0}
        onWheel={(event) => {
          if (gesture.current || panGesture.current) return;
          if (event.target instanceof Element && event.target.closest('input,select,textarea'))
            return;
          const rect = event.currentTarget.getBoundingClientRect();
          const next = nativeCanvasWheel(
            camera,
            event,
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            rect.height,
          );
          setCamera({ ...next, x: limit(next.x), y: limit(next.y), zoom: zoomLimit(next.zoom) });
        }}
      >
        <div
          className="native-erd-world canvas-world"
          ref={setWorldElement}
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            // Do not retain the whole scene in a promoted layer across zoom changes.
            // Chrome can otherwise leave stale horizontal bands after zooming out.
            willChange: 'auto',
          }}
        >
          {pins}
          <div key={effectiveView} className="native-scene-entry">
            <NativeCanvasScene
              base={base}
              sharedSource={sharedSource}
              drawn={drawn}
              effectiveView={effectiveView}
              mode={mode}
              selectedNode={selectedNode}
              selectedObjectIds={visibleSelection}
              onNodeSelect={selectNodeLatest}
              onNodeContextMenu={nodeMenuLatest}
              onConnectFromColumn={
                userId && editable && !allBusy && !placementDraftBlocked
                  ? connectFromColumn
                  : undefined
              }
              onDescriptionCommit={
                placementEditable && !allBusy && !placementDraftBlocked
                  ? commitDescriptionLatest
                  : undefined
              }
              selectedTableId={selectedTableId}
              selectedColumnId={selectedColumnId}
              selectedDomainId={selectedDomainId}
              selectedDomainRelation={selectedDomainRelation}
              selectedRelationId={selectedRelationId}
              onSelectRelation={selectRoute}
              draftObjectId={draftObjectId}
              setSelectedNode={setSelectedNode}
              setSelectedDomainRelation={selectDomainRelation}
              onSelect={onSelect}
              onSelectDomain={onSelectDomain}
              gesture={gesture}
              actions={sceneActions}
              onOpenDomain={navigateView}
              onAddColumn={
                userId && editable && !allBusy && !placementDraftBlocked
                  ? addColumnFromCard
                  : undefined
              }
              resizeEnabled={placementEditable && !allBusy && !stale}
              onEdit={userId && editable ? openInline : undefined}
              {...(userId && editable ? { editorContext: inlineContext } : {})}
              onRequestStructure={onRequestStructure}
              onRequestAction={onRequestAction}
              onToggleNullable={
                userId && editable && !allBusy && !placementDraftBlocked
                  ? toggleNullableLatest
                  : undefined
              }
            />
          </div>
          <div
            ref={marqueeElement}
            className="canvas-selection-box"
            data-export-hidden="true"
            hidden
            style={{ borderWidth: 1 / camera.zoom }}
          />
          {connection &&
            connectPointer &&
            (() => {
              const column = base.columns?.find((c) => c.id === connection.source);
              const node = drawn.nodes.find(
                (node) => node.objectId === (column?.tableId ?? connection.source),
              );
              return node ? (
                <svg className="relations connection-preview-layer" aria-hidden="true">
                  <path
                    className="domain-connection-preview"
                    d={`M ${node.x + node.width / 2} ${node.y + node.height / 2} L ${connectPointer.x} ${connectPointer.y}`}
                  />
                </svg>
              ) : null;
            })()}
        </div>
        {inlineTarget && userId && (
          <NativeCanvasInlineEditor
            key={`${userId}:${snapshot.project.id}`}
            document={sharedSource}
            target={inlineTarget}
            context={inlineContext}
            focusTarget={inlineFocusReturn.current}
            onClose={closeInline}
          />
        )}
        {descriptionId &&
          userId &&
          (() => {
            const domain = base.domains.find((item) => item.id === descriptionId),
              note = base.notes.find((item) => item.id === descriptionId);
            if (!domain && !note) return null;
            return (
              <aside
                className="native-inline-editor"
                role="dialog"
                aria-label={t(domain ? '업무 설명' : '메모 내용')}
                onWheel={(event) => event.stopPropagation()}
              >
                <Button onClick={() => setDescriptionId(null)}>{t('닫기')}</Button>
                <NativeCanvasInputForm
                  context={{
                    userId,
                    snapshot,
                    busy: allBusy || placementDraftBlocked || !placementEditable,
                    affectsSharedDocument: true,
                    onSave: async (commands, exp, ref) => {
                      const saved = await routeSave(commands, exp, ref);
                      if (saved) setDescriptionId(null);
                      return saved;
                    },
                  }}
                  title={t(domain ? '업무 설명' : '메모 내용')}
                  draftKey={`canvas:description:${effectiveView}:${descriptionId}`}
                  initial={{
                    objectId: descriptionId,
                    text: domain?.description ?? note?.text ?? '',
                  }}
                  disabled={!placementEditable}
                  build={(values) => {
                    return [
                      nativeEditorCommandSchema.parse(
                        domain
                          ? {
                              type: 'patch_domain',
                              id: descriptionId,
                              patch: { description: values.text },
                            }
                          : { type: 'patch_note', id: descriptionId, patch: { text: values.text } },
                      ),
                    ];
                  }}
                >
                  {(values, change) => (
                    <NativeEditorField
                      label={domain ? '업무 설명' : '메모 내용'}
                      multiline
                      value={values.text ?? ''}
                      onChange={(value) => change('text', value)}
                    />
                  )}
                </NativeCanvasInputForm>
              </aside>
            );
          })()}
        <div className="native-canvas-hint canvas-hint" role={connection ? 'status' : undefined}>
          {connection
            ? t(
                connection.kind === 'domain'
                  ? '연결할 도메인을 클릭하세요 · Escape 취소'
                  : 'PK를 받을 테이블을 클릭하세요 · FK 컬럼 자동 추가 · Escape 취소',
              )
            : visibleSelection.length > 1
              ? t('{count}개 선택됨 · 함께 드래그하여 이동', { count: visibleSelection.length })
              : t(
                  tool === 'hand'
                    ? '손 도구 · 드래그로 화면 이동'
                    : '커서 도구 · 빈 공간 드래그로 여러 객체 선택',
                )}
        </div>
        <NativeCameraControls
          notice={
            tableArranging || tableArrangeNotice ? (
              <div className="native-arrange-toast" role="status" aria-live="polite">
                <span
                  className="native-arrange-spinner"
                  aria-hidden="true"
                  hidden={!tableArranging}
                />
                <span className="native-arrange-toast-message">
                  {t(tableArranging ? '테이블 배치 중…' : tableArrangeNotice)}
                </span>
                <Button
                  hidden={!tableArranging}
                  onClick={() => {
                    tableLayoutJob.current?.abort();
                    tableLayoutJob.current = null;
                    setTableArranging(false);
                    setTableArrangeNotice('테이블 배치를 취소했어요');
                  }}
                >
                  {t('취소')}
                </Button>
              </div>
            ) : (
              <NativeRelationArrangeToast
                status={arrangeStatus}
                crowdedTableNames={(arrangeStatus.crowdedTableIds ?? []).map((id) => {
                  const table = base.tables?.find((item) => item.id === id);
                  return table
                    ? mode === 'logical'
                      ? table.logical.name || table.physical.name
                      : table.physical.name || table.logical.name
                    : id;
                })}
                onCancel={() => arrangeController.current?.cancel()}
                onUndo={() => arrangeController.current?.undo()}
              />
            )
          }
          tool={tool}
          onTool={setTool}
          zoom={camera.zoom}
          onZoom={(factor) => {
            const rect = surface.current?.getBoundingClientRect();
            setCamera(
              nativeZoomAt(camera, zoomLimit(camera.zoom * factor), {
                x: (rect?.width ?? 800) / 2,
                y: (rect?.height ?? 600) / 2,
              }),
            );
          }}
          onReset={() => {
            const rect = surface.current?.getBoundingClientRect();
            setCamera(
              nativeZoomAt(camera, 1, {
                x: (rect?.width ?? 800) / 2,
                y: (rect?.height ?? 600) / 2,
              }),
            );
          }}
          onFit={() => {
            const x = drawn.nodes.length ? Math.min(...drawn.nodes.map((node) => node.x)) : 0;
            const y = drawn.nodes.length ? Math.min(...drawn.nodes.map((node) => node.y)) : 0;
            setCamera({ viewId: effectiveView, x: limit(24 - x), y: limit(24 - y), zoom: 1 });
          }}
        />
        {!drawn.nodes.length && (
          <div className="canvas-empty">
            <span className="empty-symbol" aria-hidden="true">
              {effectiveView === 'overview' ? '◇' : '▦'}
            </span>
            <h2>
              {t(
                effectiveView === 'overview'
                  ? '큰 그림부터 시작하세요'
                  : domainFilter
                    ? '필터에 해당하는 테이블이 없습니다'
                    : '테이블부터 시작하세요',
              )}
            </h2>
            <p>
              {t(
                effectiveView === 'overview'
                  ? '도메인을 만들고 업무의 흐름을 연결해 보세요.'
                  : '테이블을 추가하고 컬럼과 관계를 설계하세요.',
              )}
            </p>
            <Button
              variant="primary"
              disabled={!editable || allBusy || placementDraftBlocked}
              onClick={() => void createObject(effectiveView === 'overview' ? 'domain' : 'table')}
            >
              {t(effectiveView === 'overview' ? '첫 도메인 만들기' : '첫 테이블 만들기')}
            </Button>
          </div>
        )}
      </div>
      <ContextMenu
        position={menu ? { x: menu.x, y: menu.y } : null}
        label={t(menu?.source ? '객체 메뉴' : '캔버스 메뉴')}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                ...(menu.source && sharedSource.tables?.some((table) => table.id === menu.source)
                  ? [
                      {
                        id: 'cut-tables',
                        label: t('오려두기'),
                        disabled: !editable || allBusy || placementDraftBlocked,
                        onAction: () => copySelection(undefined, true),
                      },
                      { id: 'copy-tables', label: t('복사하기'), onAction: () => copySelection() },
                    ]
                  : []),
                ...(!menu.source && effectiveView !== 'overview'
                  ? [
                      {
                        id: 'paste-tables',
                        label: t('붙여넣기'),
                        disabled: !editable || allBusy || placementDraftBlocked,
                        onAction: () => void pasteFromMenu(),
                      },
                    ]
                  : []),
                ...(onCreatePin
                  ? [
                      {
                        id: 'create-pin',
                        label: t('이 위치에 핀 남기기'),
                        onAction: () =>
                          onCreatePin({
                            viewId: effectiveView,
                            selectedObjectId: menu.source,
                            visibleObjectIds: scene.nodes.map((n) => n.objectId),
                            position: menu.point,
                          }),
                      },
                    ]
                  : []),
                ...(effectiveView === 'overview' &&
                menu.source &&
                base.domains.some((d) => d.id === menu.source)
                  ? [
                      {
                        id: 'direct-relation',
                        label: t('도메인 직접 연결'),
                        disabled:
                          !editable || allBusy || placementDraftBlocked || base.domains.length < 2,
                        onAction: () => {
                          setConnection({ kind: 'domain', source: menu.source! });
                          setConnectPointer(null);
                        },
                      },
                      {
                        id: 'panel-relation',
                        label: t('새 도메인 관계'),
                        disabled: !editable,
                        onAction: () =>
                          onRequestAction?.('domainRelation', '', { sourceDomainId: menu.source! }),
                      },
                    ]
                  : []),
                ...(!menu.source
                  ? [
                      {
                        id: effectiveView === 'overview' ? 'new-domain' : 'new-table',
                        label: t(
                          effectiveView === 'overview' ? '새 도메인 생성' : '새 테이블 생성',
                        ),
                        disabled: !editable || allBusy || placementDraftBlocked,
                        onAction: () =>
                          void createObject(
                            effectiveView === 'overview' ? 'domain' : 'table',
                            menu.point,
                          ),
                      },
                      {
                        id: 'new-note',
                        label: t('메모 추가'),
                        disabled: !placementEditable || allBusy || placementDraftBlocked,
                        onAction: () => void createObject('note', menu.point),
                      },
                      {
                        id: 'auto-layout',
                        label: t('자동 배치'),
                        disabled:
                          !placementEditable ||
                          allBusy ||
                          placementDraftBlocked ||
                          !scene.nodes.length,
                        onAction: () => {},
                        children: [
                          {
                            id: 'auto-layout-tables',
                            label: t('테이블 배치'),
                            disabled: arranging,
                            onAction: () => void arrangeVisibleNodes(),
                          },
                          {
                            id: 'auto-layout-relations',
                            label: t('관계선 배치'),
                            disabled: arranging || !arrangeEligible,
                            onAction: () => {
                              setTableArrangeNotice('');
                              arrangeController.current?.start();
                            },
                          },
                        ],
                      },
                    ]
                  : []),
                ...(menu.source
                  ? [
                      {
                        id: 'delete-selected',
                        label: t('삭제'),
                        disabled: !placementEditable || allBusy || placementDraftBlocked,
                        onAction: () => void deleteSelection(),
                      },
                    ]
                  : []),
              ]
            : []
        }
      />
      <ContextMenu
        position={relationMenu ? { x: relationMenu.x, y: relationMenu.y } : null}
        label={t('관계 메뉴')}
        onClose={() => setRelationMenu(null)}
        items={
          relationMenu
            ? [
                {
                  id: 'edit-relation',
                  label: t('관계 속성'),
                  onAction: () =>
                    relationMenu.kind === 'domain'
                      ? onRequestAction?.('domainRelation', relationMenu.id)
                      : onRequestStructure?.(
                          'patch',
                          JSON.stringify(['tableRelations', relationMenu.id]),
                        ),
                },
                ...(relationMenu.kind === 'table'
                  ? [
                      {
                        id: 'reset-route',
                        label: t('자동 경로로 복원'),
                        disabled:
                          arranging || !placementEditable || allBusy || placementDraftBlocked,
                        onAction: () =>
                          void saveCommands([
                            {
                              type: 'delete_relation_layout',
                              relationId: relationMenu.id,
                              viewId: drawn.viewId,
                            },
                          ]),
                      },
                    ]
                  : []),
                {
                  id: 'delete-relation',
                  label: t('관계 삭제'),
                  disabled: !editable || allBusy || placementDraftBlocked,
                  onAction: () => {
                    const scope = operationScope.current,
                      id = relationMenu.id,
                      kind = relationMenu.kind;
                    void (async () => {
                      if (
                        !(await confirm({
                          title: t('관계 삭제'),
                          description: t('선택한 관계를 삭제할까요?'),
                          destructive: true,
                          confirmLabel: t('삭제'),
                        }))
                      )
                        return;
                      if (!alive.current || scope !== operationScope.current) return;
                      await onSave(
                        [
                          nativeEditorCommandSchema.parse(
                            kind === 'domain'
                              ? { type: 'delete_domain_relation', id }
                              : {
                                  type: 'delete_objects',
                                  targets: [{ collection: 'tableRelations', id }],
                                },
                          ),
                        ],
                        expected(snapshot),
                      );
                    })().catch((error) => setError(message(error)));
                  },
                },
              ]
            : []
        }
      />
      {routeInspectorHost === undefined
        ? routeEditor
        : routeInspectorHost
          ? createPortal(routeEditor, routeInspectorHost)
          : null}
      {inspectorHost === undefined
        ? auxiliary
        : inspectorHost
          ? createPortal(auxiliary, inspectorHost)
          : null}
      {selectionHost === undefined
        ? selectionInspector
        : selectionHost
          ? createPortal(selectionInspector, selectionHost)
          : null}
    </section>
  );
}

export function NativeCanvasActions({
  document,
  source,
  snapshot,
  userId,
  viewId,
  busy,
  onSharedSave,
  sharedEditable,
  initialSelection,
}: {
  document: NativeDesignDocument;
  source: NativeDesignDocument;
  snapshot: ProjectDocumentState;
  userId: string;
  viewId: string;
  busy: boolean;
  onSharedSave: NativeEditorSave;
  sharedEditable: boolean;
  initialSelection?: { action: string; target: string };
}) {
  const { t } = useI18n();
  const [action, setAction] = useState(initialSelection?.action ?? 'note');
  const [target, setTarget] = useState(initialSelection?.target ?? '');
  const [id] = useState(() => nativeDurableId());
  // An ACK can precede the refreshed document. Keep only references that have not
  // appeared in that document yet; once observed, deletion must not resurrect them.
  const referenceScope = JSON.stringify([
    userId,
    snapshot.project.id,
    snapshot.project.databaseRevision,
  ]);
  const acceptedReferences = useRef(new Map<string, string>());
  const referenceDocument = useRef(document);
  const referenceKey = (tableId: string, targetView: string) =>
    JSON.stringify([referenceScope, tableId, targetView]);
  useLayoutEffect(() => {
    referenceDocument.current = document;
    for (const node of document.layout.nodes)
      acceptedReferences.current.delete(referenceKey(node.objectId, node.viewId));
  }, [document.layout.nodes, referenceScope]);
  const placementView = viewFor(document, viewId);
  const note = document.notes.find((note) => note.id === target);
  const referenceNode =
    action === 'reference'
      ? document.layout.nodes.find(
          (node) => node.objectId === target && node.viewId === placementView,
        )
      : undefined;
  const context = {
    userId,
    snapshot,
    busy,
    affectsSharedDocument: true,
    onSave: async (commands: CanvasCommand[], exp: ReturnType<typeof expected>, ref?: DraftRef) => {
      if (!commands.length) return false;
      const rememberReferences = () => {
        for (const command of commands) {
          if (command.type !== 'add_table_reference') continue;
          if (
            referenceDocument.current.layout.nodes.some(
              (node) => node.objectId === command.tableId && node.viewId === command.viewId,
            )
          )
            continue;
          const nodeId =
            'nodeId' in command && command.nodeId
              ? command.nodeId
              : addTableReference(
                  document,
                  command.tableId,
                  command.viewId,
                  command.placement,
                ).layout.nodes.find(
                  (node) => node.objectId === command.tableId && node.viewId === command.viewId,
                )!.id;
          acceptedReferences.current.set(referenceKey(command.tableId, command.viewId), nodeId);
        }
      };
      {
        if (!sharedEditable) return false;
        const saved = await onSharedSave(
          commands.map((command) => nativeEditorCommandSchema.parse(command)),
          exp,
          ref,
        );
        if (saved) rememberReferences();
        return saved;
      }
    },
  };
  return (
    <details className="native-erd-actions" open={initialSelection ? true : undefined}>
      <summary>{t('보관된 입력 복구')}</summary>
      <NativeEditorField
        label="작업"
        value={action}
        disabled={busy}
        onChange={(value) => {
          setAction(value);
          setTarget('');
        }}
        choices={[
          { value: 'reference', label: t('참조 추가'), disabled: placementView === 'overview' },
          { value: 'note', label: t('메모 추가') },
          { value: 'note-edit', label: t('메모 수정') },
          { value: 'note-delete', label: t('메모 삭제') },
        ]}
      />
      {action !== 'note' && (
        <NativeEditorField
          label="대상"
          value={target}
          disabled={busy}
          onChange={setTarget}
          choices={[
            { value: '', label: '—' },
            ...(action.startsWith('note-')
              ? document.notes
                  .filter((note) => note.viewId === placementView)
                  .map((note) => ({ value: note.id, label: note.text.slice(0, 30) || note.id }))
              : (document.tables ?? []).map((table) => ({
                  value: table.id,
                  label: table.physical.name || table.logical.name || table.id,
                }))),
          ]}
        />
      )}
      <NativeCanvasInputForm
        key={`${action}:${target}`}
        context={context}
        title={t('작업')}
        draftKey={`canvas:action:${viewId}:${action}:${target}`}
        initial={{
          id,
          text: note?.text ?? '',
          x: String(referenceNode?.x ?? 40),
          y: String(referenceNode?.y ?? 40),
          confirm: 'false',
        }}
        disabled={!sharedEditable}
        build={(values) => {
          let command: unknown;
          if (action === 'reference') {
            const nodeId =
              document.layout.nodes.find(
                (node) => node.objectId === target && node.viewId === placementView,
              )?.id ?? acceptedReferences.current.get(referenceKey(target, placementView));
            command = nodeId
              ? {
                  type: 'update_node_layout',
                  nodeId,
                  patch: { x: Number(values.x), y: Number(values.y) },
                }
              : {
                  type: 'add_table_reference',
                  tableId: target,
                  viewId: placementView,
                  nodeId: values.id,
                  placement: { x: Number(values.x), y: Number(values.y) },
                };
          } else if (action === 'note')
            command = {
              type: 'upsert_note',
              value: { id: values.id, viewId: placementView, text: values.text },
              placement: { x: Number(values.x), y: Number(values.y) },
            };
          else if (action === 'note-edit')
            command = { type: 'patch_note', id: target, patch: { text: values.text } };
          else if (action === 'note-delete') {
            if (values.confirm !== 'true') throw new Error('deletion.review-required');
            command = { type: 'delete_note', id: target };
          } else throw new Error('canvas.action-unsupported');
          return [nativeEditorCommandSchema.parse(command)];
        }}
      >
        {(values, change) => (
          <>
            {['note', 'note-edit'].includes(action) && (
              <NativeEditorField
                label="메모"
                value={values.text ?? ''}
                multiline
                onChange={(value) => change('text', value)}
              />
            )}
            {['note', 'reference'].includes(action) && (
              <>
                <NativeEditorField
                  label="X"
                  type="number"
                  value={values.x ?? ''}
                  onChange={(value) => change('x', value)}
                />
                <NativeEditorField
                  label="Y"
                  type="number"
                  value={values.y ?? ''}
                  onChange={(value) => change('y', value)}
                />
              </>
            )}
            {['note-delete'].includes(action) && (
              <NativeEditorField
                label="삭제를 확인했습니다."
                value={values.confirm ?? 'false'}
                choices={[
                  { value: 'false', label: 'false' },
                  { value: 'true', label: 'true' },
                ]}
                onChange={(value) => change('confirm', value)}
              />
            )}
          </>
        )}
      </NativeCanvasInputForm>
    </details>
  );
}

import { useCommittedEvent } from '../../shared/hooks/use-committed-event.js';
import type { CommentContext } from '../comments/CommentsPanel.js';
import { pinPosition, reviewCanvasView, type ReviewTarget } from '../comments/comments-state.js';
import type { NativeDomainFilterValue } from './NativeDomainFilter.js';
import { selectionRect, intersectingObjects } from '../canvas/canvas-selection.js';
import {
  toolShortcutInputSelector,
  toolShortcutOverlaySelector,
} from '../canvas/canvas-tool-shortcuts.js';
import {
  nativeCanvasMoveCommand,
  nativeSelectionPlacements,
  nativeAutoLayoutPlacements,
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
import { rememberTableClipboard, readLocalTableClipboard } from '../canvas/table-clipboard.js';
import { ConfirmProvider, useConfirm } from '../../components/ui/ConfirmProvider.js';
import { nativeCanvasDeleteCommands } from './native-canvas-delete.js';
import { createPortal } from 'react-dom';
import { NativeCanvasToolbar, NativeCameraControls } from './NativeCanvasToolbar.js';
import { NativeCanvasInputForm } from './NativeCanvasInputForm.js';
import { NativeSelectedObjectInspector } from './NativeSelectedObjectInspector.js';
export { NativeCanvasInputForm } from './NativeCanvasInputForm.js';
import { NativeRelationEditor } from './NativeRelationEditor.js';
import { NativeCanvasInlineEditor, type NativeInlineTarget } from './NativeCanvasInlineEditor.js';
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
  nativeSharedCanvasCommandSchema,
  nativePersonalCanvasCommandSchema,
  personalStateSnapshotSchema,
  viewportSchema,
  nodeLayoutSchema,
  type NativeCanvasPersonalPending,
  type NativePersonalCanvasCommand,
  type NativeEditorCommand,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  TABLES_VIEW_ID,
  basicCardSize,
  addTableReference,
  removeTableReference,
  updateNodeLayout,
  addNote,
  updateNote,
  removeNote,
  upsertRelationLayout,
  upsertCombinedView,
  removeCombinedView,
  setViewport,
  extractPersonalState,
  reconcilePersonalState,
  mergeStoredPersonalState,
  isVisibleInView,
  nativeColumnTypeDisplay,
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  createNativeTable,
  type NativeDesignDocument,
  type NodeLayout,
  type Viewport,
} from '@ezerd/model';
import { relationGeometry } from '../relations/relation-routing.js';
import { wheelCamera } from '../canvas/canvas-wheel.js';
import { Button, ContextMenu, Checkbox, AnimatedDetails } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { message, request } from '../../shared/api/client.js';
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
import { NativePrivateCASRecovery } from './NativePrivateCASRecovery.js';
import { NativeCanvasStyleEditor } from './NativeCanvasStyleEditor.js';
import type { NativeCanvasRecoverySelection } from './native-canvas-recovery-types.js';
import { NativeDomainRelationEditor } from './NativeDomainRelationEditor.js';
import { NativeCanvasScene, type NativeSceneActions } from './NativeCanvasScene.js';
import { NativeCanvasPngExport } from './NativeCanvasPngExport.js';
import {
  nativeTableCanvasRows,
  nativeTableCanvasMetrics,
  nativeTableCanvasHeaderHeight,
  nativeRelationLabelWidth,
} from './native-canvas-style.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { getNativeDurableQueue, type NativeDurableState } from './native-durable-queue.js';
import {
  nativePrivateCanvasGuardAvailable,
  nativePrivateSnapshotSchema,
  loadNativePrivatePending,
  discardNativePrivatePending,
  stageNativePrivateCanvas,
  recoverNativePrivateCanvas,
} from './native-private-canvas.js';
type PersonalStateSnapshot = ReturnType<typeof personalStateSnapshotSchema.parse>;
type DraftRef = { key: string; revision: string };
type CanvasCommand = NativeEditorCommand | NativePersonalCanvasCommand;

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
  '도메인 개요': 'Domain overview',
  '개인 화면': 'Personal view',
  화면: 'View',
  '배치 저장': 'Save placement',
  '미저장 배치가 있습니다.': 'There is an unsaved placement.',
  '배치 입력 초기화': 'Reset placement input',
  '배치의 저장 기준이 변경되었습니다. 입력을 보관했습니다.':
    'The placement revision changed. Your input is preserved.',
  '노드 선택 후 방향키로 이동하고 Enter로 저장합니다.':
    'Select a node, move with arrow keys, and press Enter to save.',
  '참조 추가': 'Add reference',
  '참조 제거': 'Remove reference',
  '메모 추가': 'Add note',
  '메모 수정': 'Edit note',
  '메모 삭제': 'Delete note',
  '화면 생성': 'Create view',
  '화면 수정': 'Edit view',
  '화면 삭제': 'Delete view',
  '개인 저장 결과 확인': 'Check personal save result',
  '미확인 개인 저장 요청이 있습니다.': 'A personal save request is unconfirmed.',
  '개인 요청 초기화': 'Reset personal request',
  '개인 화면을 불러오는 중입니다.': 'Loading personal views.',
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
  '개인 화면 저장은 아직 지원하지 않습니다. 이 프로젝트에서는 공유 캔버스를 사용해 주세요.':
    'Saving personal views is not available yet. Use the shared canvas in this project.',
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
const privateView = (doc: NativeDesignDocument, viewId: string) =>
  !!doc.views?.some((view) => view.id === viewId);
const personalGuardAvailable = nativePrivateCanvasGuardAvailable;
const viewFor = (doc: NativeDesignDocument, viewId: string) =>
  doc.domains.some((domain) => domain.id === viewId) ? TABLES_VIEW_ID : viewId;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function nativeCanvasPersonalCandidate(
  document: NativeDesignDocument,
  raw: NativePersonalCanvasCommand,
): NativeDesignDocument {
  const command = nativePersonalCanvasCommandSchema.parse(raw);
  const requirePrivate = (viewId: string) => {
    if (!privateView(document, viewId)) throw new Error('canvas.personal-view-required');
  };
  switch (command.type) {
    case 'upsert_combined_view':
      return upsertCombinedView(document, command.value);
    case 'delete_combined_view':
      requirePrivate(command.id);
      return removeCombinedView(document, command.id);
    case 'set_viewport':
      return setViewport(document, command.value);
    case 'add_table_reference': {
      requirePrivate(command.viewId);
      let next = addTableReference(document, command.tableId, command.viewId, command.placement);
      const node = next.layout.nodes.find(
        (node) => node.objectId === command.tableId && node.viewId === command.viewId,
      )!;
      next = updateNodeLayout(next, node.id, {
        ...(command.placement.width !== undefined ? { width: command.placement.width } : {}),
        ...(command.placement.height !== undefined ? { height: command.placement.height } : {}),
      });
      if (command.nodeId) {
        if (document.layout.nodes.some((item) => item.id === command.nodeId))
          throw new Error('document.duplicate-identities');
        next = {
          ...next,
          layout: {
            ...next.layout,
            nodes: next.layout.nodes.map((item) =>
              item.id === node.id ? { ...item, id: command.nodeId! } : item,
            ),
          },
        };
      }
      return next;
    }
    case 'update_node_layout':
    case 'remove_table_reference': {
      const node = document.layout.nodes.find((node) => node.id === command.nodeId);
      if (!node) throw new Error('canvas.node-not-found');
      requirePrivate(node.viewId);
      return command.type === 'update_node_layout'
        ? updateNodeLayout(document, node.id, command.patch)
        : removeTableReference(document, node.id);
    }
    case 'upsert_note': {
      requirePrivate(command.value.viewId);
      const current = document.notes.find((note) => note.id === command.value.id);
      if (current && current.viewId !== command.value.viewId)
        throw new Error('canvas.note-view-immutable');
      let next = current
        ? updateNote(document, current.id, command.value)
        : addNote(document, command.value, command.placement ?? { x: 0, y: 0 });
      if (command.placement) {
        const node = next.layout.nodes.find(
          (node) => node.objectId === command.value.id && node.viewId === command.value.viewId,
        )!;
        next = updateNodeLayout(next, node.id, command.placement);
      }
      return next;
    }
    case 'patch_note':
    case 'delete_note': {
      const note = document.notes.find((note) => note.id === command.id);
      if (!note) throw new Error('canvas.note-not-found');
      requirePrivate(note.viewId);
      return command.type === 'patch_note'
        ? updateNote(document, note.id, command.patch)
        : removeNote(document, note.id);
    }
    case 'upsert_relation_layout':
      requirePrivate(command.value.viewId);
      return upsertRelationLayout(document, command.value);
    case 'delete_relation_layout':
      requirePrivate(command.viewId);
      return {
        ...document,
        layout: {
          ...document.layout,
          relations: (document.layout.relations ?? []).filter(
            (route) => route.relationId !== command.relationId || route.viewId !== command.viewId,
          ),
        },
      };
  }
}

export function loadNativeCanvasPersonalPending(
  userId: string,
  projectId: string,
  storage: Storage = localStorage,
) {
  return loadNativePrivatePending(userId, projectId, { storage });
}
export function discardNativeCanvasPersonalPending(
  pending: NativeCanvasPersonalPending,
  storage: Storage = localStorage,
) {
  return discardNativePrivatePending(pending, { storage });
}
export function stageNativeCanvasPersonal(
  userId: string,
  snapshot: ProjectDocumentState,
  personal: PersonalStateSnapshot,
  candidate: NativeDesignDocument,
  storage: Storage = localStorage,
  editorDraft?: DraftRef,
) {
  return stageNativePrivateCanvas(
    userId,
    snapshot,
    nativePrivateSnapshotSchema.parse(personal),
    candidate,
    { storage },
    editorDraft,
  );
}
export function recoverNativeCanvasPersonal(
  pending: NativeCanvasPersonalPending,
  snapshot: ProjectDocumentState,
  allowReplay: boolean,
  storage: Storage = localStorage,
  api: typeof request = request,
) {
  return recoverNativePrivateCanvas(pending, snapshot, allowReplay, { storage }, api);
}
/** Preview nodes can be reader-generated. Persist a real reference before moving an absent raw node. */
export function nativeCanvasScene(
  document: NativeDesignDocument,
  viewId: string,
  mode: 'physical' | 'logical',
  filter?: NativeDomainFilterValue | null,
) {
  const view = viewFor(document, viewId);
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
      const table = document.tables?.find((table) => table.id === node.objectId);
      if (table)
        return (
          view !== 'overview' &&
          (!filter ||
            (table.domainId === null
              ? filter.unassigned
              : filter.domainIds.includes(table.domainId))) &&
          isVisibleInView(table.scope, mode) &&
          (!document.domains.some((domain) => domain.id === viewId) || table.domainId === viewId)
        );
      return (
        document.notes.some((note) => note.id === node.objectId && note.viewId === view) ||
        (view === 'overview' && document.domains.some((domain) => domain.id === node.objectId))
      );
    })
    .map((node) => {
      const table = document.tables?.find((table) => table.id === node.objectId);
      const kind = table
        ? 'table'
        : document.domains.some((domain) => domain.id === node.objectId)
          ? 'domain'
          : 'note';
      const size = basicCardSize(kind, node.width, node.height);
      const metrics = table ? nativeTableCanvasMetrics(document, table, mode) : null;
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
    const route = document.layout.relations?.find(
      (route) => route.relationId === relation.id && route.viewId === view,
    );
    const label = mode === 'physical' ? (relation.physical?.name ?? '') : relation.logical.name;
    const columnAnchor = (
      node: NodeLayout,
      columnId: string | undefined,
      side: 'left' | 'right',
    ) => {
      const table = document.tables?.find((table) => table.id === node.objectId)!;
      const columns = (document.columns ?? []).filter(
        (column) =>
          column.tableId === node.objectId && isVisibleInView(column.scope, mode, table.scope),
      );
      const index = columns.findIndex((column) => column.id === columnId);
      const rows = nativeTableCanvasRows(document, table, mode);
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
  return { nodes, relations, viewId: view };
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
  );
}
/** Only shared source-document inputs block export; personal cameras/views do not change it. */
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
  snapshot,
  userId,
  editable,
  personalEditable = editable,
  busy,
  recoveryBusy = busy,
  onSave: onSaveFromParent,
  onReload: onReloadFromParent,
  mode,
  selectedTableId,
  selectedDomainId,
  onSelect: onSelectFromParent,
  onSelectDomain: onSelectDomainFromParent,
  recoverySelection,
  inspectorHost,
  inspectorOpen,
  onToggleInspector: onToggleInspectorFromParent,
  onOpenTools: onOpenToolsFromParent,
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
  selectionHost,
}: {
  document: NativeDesignDocument;
  snapshot: ProjectDocumentState;
  userId?: string;
  editable: boolean;
  /** Main can pass the workspace's own-personal permission separately from shared editing. */
  personalEditable?: boolean;
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
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
  onOpenTools?: () => void;
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
  selectionHost?: HTMLElement | null;
}) {
  // Parent panel/resize state must not invalidate the memoized document scene.
  // Event handlers still observe the latest committed permissions and save baseline.
  const onSave = useCommittedEvent(onSaveFromParent);
  const onReload = useCommittedEvent(onReloadFromParent);
  const onSelect = useCommittedEvent(onSelectFromParent);
  const onSelectDomain = useCommittedEvent(onSelectDomainFromParent);
  const onToggleInspector = useCommittedEvent(onToggleInspectorFromParent);
  const onOpenTools = useCommittedEvent(onOpenToolsFromParent);
  const onCreate = useCommittedEvent(onCreateFromParent);
  const onModeChange = useCommittedEvent(onModeChangeFromParent);
  const onViewChange = useCommittedEvent(onViewChangeFromParent);
  const onReviewContext = useCommittedEvent(onReviewContextFromParent);
  const onCreatePin = useCommittedEvent(onCreatePinFromParent);
  const onRequestStructure = useCommittedEvent(onRequestStructureFromParent);
  const onRequestAction = useCommittedEvent(onRequestActionFromParent);
  const onCanvasScopeChange = useCommittedEvent(onCanvasScopeChangeFromParent);
  const { t, locale } = useI18n();
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
  const [marquee, setMarquee] = useState<ReturnType<typeof selectionRect> | null>(null);
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
  const [personal, setPersonal] = useState<PersonalStateSnapshot | null>(null);
  const [personalPending, setPersonalPending] = useState<NativeCanvasPersonalPending | null>(null);
  const [personalBusy, setPersonalBusy] = useState(false);
  const [privateQueueState, setPrivateQueueState] = useState<NativeDurableState>('unknown');
  const privateIdentity = JSON.stringify([
    userId,
    snapshot.project.id,
    snapshot.project.databaseRevision,
    snapshot.project.version,
    snapshot.sequence,
  ]);
  const activeIdentity = useRef(privateIdentity);
  activeIdentity.current = privateIdentity;
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [sharedStorageFailure, setSharedStorageFailure] = useState(false);
  const [draft, setDraft] = useState<NativeEditorDraft | null>(null);
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
  const [worldElement, setWorldElement] = useState<HTMLDivElement | null>(null);
  const closeRoute = useCallback(() => setSelectedRelationId(null), []);
  useEffect(
    () => setSelectedRelationId(recoverySelection?.routeId ?? null),
    [userId, snapshot.project.id, viewId, recoverySelection?.routeId],
  );
  const [domainFilter, setDomainFilter] = useState<NativeDomainFilterValue | null>(null);
  const navigateView = useCallback(
    (id: string) => {
      const domain = document.domains.find((domain) => domain.id === id);
      setDomainFilter(domain ? { domainIds: [domain.id], unassigned: false } : null);
      setViewId(domain ? TABLES_VIEW_ID : id);
      onViewChange?.(domain ? TABLES_VIEW_ID : id);
    },
    [onViewChange, document.domains],
  );
  useEffect(() => {
    if (requestedView) navigateView(requestedView.id);
  }, [requestedView?.nonce]);
  const applyDomainFilter = useCallback(
    (filter: NativeDomainFilterValue | null) => {
      setViewId(TABLES_VIEW_ID);
      setDomainFilter(filter);
      onViewChange?.(TABLES_VIEW_ID);
    },
    [onViewChange],
  );
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const spacePan = useRef(false);
  const panGesture = useRef<{ pointerId: number; x: number; y: number; camera: Viewport } | null>(
    null,
  );
  const addColumnFromCard = useCallback(
    (tableId: string) => {
      onSelect(tableId);
      onCreate?.('column');
    },
    [onSelect, onCreate],
  );
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedDomainRelation, setSelectedDomainRelation] = useState<string | null>(null);
  const [camera, setCamera] = useState<Viewport>({ viewId: TABLES_VIEW_ID, x: 24, y: 24, zoom: 1 });
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
  useEffect(() => {
    setPersonal(null);
    setPersonalPending(null);
    setPersonalBusy(false);
    setPrivateQueueState('unknown');
    if (!userId) return;
    let active = true;
    const current = () => active && activeIdentity.current === privateIdentity;
    let unsubscribe = () => {};
    try {
      const actorApi = captureNativeActorApi(userId);
      const queue = getNativeDurableQueue();
      let refreshing = false;
      let lastQueueState: NativeDurableState = 'unknown';
      let queueInitialized = false;
      const fetchPersonal = async () => {
        const raw = await actorApi(
          `/api/projects/${encodeURIComponent(snapshot.project.id)}/personal-state`,
          { cache: 'no-store' },
        );
        const parsed =
          raw && typeof raw === 'object' && 'databaseRevision' in raw
            ? nativePrivateSnapshotSchema.parse(raw)
            : personalStateSnapshotSchema.parse(raw);
        if (!current()) return;
        if (
          parsed.projectVersion !== snapshot.project.version ||
          parsed.syncSequence !== snapshot.sequence ||
          ('databaseRevision' in parsed &&
            parsed.databaseRevision !== snapshot.project.databaseRevision)
        ) {
          onReload();
          return;
        }
        setPersonal(parsed);
      };
      const refresh = async () => {
        if (refreshing || !current()) return;
        refreshing = true;
        try {
          const pending = await loadNativeCanvasPersonalPending(userId, snapshot.project.id);
          if (current()) {
            setPersonalPending(pending);
            const state = queue.state(userId, snapshot.project.id);
            setPrivateQueueState(state);
            const finished = queueInitialized && state === 'empty' && lastQueueState !== 'empty';
            queueInitialized = true;
            lastQueueState = state;
            if (finished) await fetchPersonal();
          }
        } catch (error) {
          if (current()) {
            setError(message(error));
            setStorageError(message(error));
            setPrivateQueueState('unknown');
          }
        } finally {
          refreshing = false;
        }
      };
      unsubscribe = queue.subscribe(userId, snapshot.project.id, () => {
        void refresh();
      });
      void refresh();
      void fetchPersonal().catch((error) => {
        if (current()) setError(message(error));
      });
    } catch (error) {
      if (current()) {
        setError(message(error));
        setStorageError(message(error));
      }
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId, privateIdentity, snapshot.project.id]);
  const sharedSource =
    snapshot.sourceDocument.schemaVersion === 2 ? snapshot.sourceDocument : document;
  const base = useMemo(
    () =>
      personal
        ? mergeStoredPersonalState(document, reconcilePersonalState(sharedSource, personal.state))
        : {
            ...document,
            views: [],
            layout: {
              ...document.layout,
              nodes: document.layout.nodes.filter((node) => !privateView(document, node.viewId)),
              viewports: [],
            },
          },
    [document, sharedSource, personal?.state],
  );
  const effectiveView =
    viewId === TABLES_VIEW_ID ||
    viewId === 'overview' ||
    base.domains.some((domain) => domain.id === viewId) ||
    privateView(base, viewId)
      ? viewId
      : TABLES_VIEW_ID;
  const isPrivate = privateView(base, effectiveView);
  const recoveryWaiting =
    !!recoverySelection?.viewId && viewId === recoverySelection.viewId && effectiveView !== viewId;
  const placementEditable = isPrivate ? personalEditable : editable;
  const personalReady = personalGuardAvailable() && !!personal && 'databaseRevision' in personal;
  const allBusy =
    busy ||
    recoveryWaiting ||
    personalBusy ||
    !!personalPending ||
    privateQueueState === 'pending' ||
    privateQueueState === 'sending' ||
    (isPrivate && (!personalReady || privateQueueState !== 'empty'));
  const inputKey = `canvas:placement:${effectiveView}`;
  const exportState = nativeCanvasExportBlocker(sharedSource, draft, sharedStorageFailure);
  useNativeExportBlocker(
    userId ?? '',
    snapshot.project.id,
    exportState.dirty,
    exportState.storageFailure,
  );
  const stale =
    !!draft &&
    (draft.expected.version !== snapshot.project.version ||
      draft.expected.sequence !== snapshot.sequence ||
      draft.expected.databaseRevision !== snapshot.project.databaseRevision ||
      (isPrivate && String(personal?.version ?? '') !== draft.values.personalVersion));
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
      if (!isPrivate) setSharedStorageFailure(true);
    }
    const viewport = personal?.state.viewports.find(
      (viewport) => viewport.viewId === effectiveView,
    );
    setCamera(viewport ?? { viewId: effectiveView, x: 24, y: 24, zoom: 1 });
  }, [
    recoveryWaiting,
    inputKey,
    userId,
    snapshot.project.id,
    snapshot.project.version,
    snapshot.sequence,
    snapshot.project.databaseRevision,
    personal?.version,
  ]);
  const scene = useMemo(
    () => nativeCanvasScene(base, effectiveView, mode, domainFilter),
    [base, effectiveView, mode, domainFilter],
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
  const singleDrawn = useMemo(
    () =>
      nativeCanvasDraftScene(
        base,
        scene,
        effectiveView,
        mode,
        draftObjectId,
        draftX,
        draftY,
        domainFilter,
        draftWidth,
        draftHeight,
      ),
    [
      base,
      scene,
      effectiveView,
      mode,
      draftObjectId,
      draftX,
      draftY,
      domainFilter,
      draftWidth,
      draftHeight,
    ],
  );
  const drawn = useMemo(() => {
    if (!draft?.values.nodesJSON) return singleDrawn;
    try {
      const placements = new Map(
        nativeCanvasDraftPlacements(draft.values).map((node) => [node.id, node]),
      );
      const originals = [
        ...base.layout.nodes,
        ...scene.nodes.filter((node) => !base.layout.nodes.some((raw) => raw.id === node.id)),
      ];
      const display = {
        ...base,
        layout: { ...base.layout, nodes: originals.map((node) => placements.get(node.id) ?? node) },
      };
      const result = nativeCanvasScene(display, effectiveView, mode, domainFilter);
      return { ...result, nodes: result.nodes.map((node) => placements.get(node.id) ?? node) };
    } catch {
      return singleDrawn;
    }
  }, [base, scene, singleDrawn, draft?.values.nodesJSON, effectiveView, mode, domainFilter]);
  const visibleSelection = useMemo(
    () => selectedObjectIds.filter((id) => scene.nodes.some((node) => node.objectId === id)),
    [selectedObjectIds, scene],
  );
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
      const retained = draftRef.current;
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
        nativeCanvasMoveCommand(isPrivate ? base : sharedSource, node, {
          x: node.x,
          y: node.y,
        }),
      );
      const node = placements[0]!;
      const current = draftRef.current;
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
          personalVersion: String(personal?.version ?? ''),
        },
      };
      draftRef.current = next;
      setDraft(next);
      storeNativeEditorDraft(next);
      setError('');
      setStorageError('');
      if (!isPrivate) setSharedStorageFailure(false);
    } catch (error) {
      setError(message(error));
      setStorageError(message(error));
      if (!isPrivate) setSharedStorageFailure(true);
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
    const command = nativeCanvasMoveCommand(isPrivate ? base : sharedSource, node, {
      x: limit(x),
      y: limit(y),
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
        : {}),
    });
    const current = draftRef.current;
    if (current && current.values.objectId !== node.objectId) {
      setError(t('미저장 배치가 있습니다.'));
      return;
    }
    const next: NativeEditorDraft = {
      userId,
      projectId: snapshot.project.id,
      key: inputKey,
      revision: nativeDurableId(),
      expected: current?.expected ?? expected(snapshot),
      before: current?.before ?? {
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
        personalVersion: String(personal?.version ?? ''),
      },
    };
    draftRef.current = next;
    setDraft(next);
    try {
      storeNativeEditorDraft(next);
      setError('');
      setStorageError('');
      if (!isPrivate) setSharedStorageFailure(false);
    } catch (error) {
      setError(message(error));
      setStorageError(message(error));
      if (!isPrivate) setSharedStorageFailure(true);
    }
  }
  async function savePersonalCommands(
    commands: NativePersonalCanvasCommand[],
    editorDraft?: DraftRef,
  ): Promise<boolean> {
    if (!userId || !personalEditable || allBusy || !personal || privateQueueState !== 'empty')
      return false;
    if (!personalReady) {
      setError(
        t(
          '개인 화면 저장은 아직 지원하지 않습니다. 이 프로젝트에서는 공유 캔버스를 사용해 주세요.',
        ),
      );
      return false;
    }
    setPersonalBusy(true);
    const identity = privateIdentity;
    const current = () => alive.current && activeIdentity.current === identity;
    setError('');
    try {
      // A reader preview may contain generated shared layout; only original native source is persisted.
      const personalSource = mergeStoredPersonalState(
        sharedSource,
        reconcilePersonalState(sharedSource, personal.state),
      );
      const candidate = commands.reduce(nativeCanvasPersonalCandidate, personalSource);
      let staged: NativeCanvasPersonalPending;
      try {
        staged = await stageNativeCanvasPersonal(
          userId,
          snapshot,
          personal,
          candidate,
          localStorage,
          editorDraft,
        );
      } catch (error) {
        if (current()) setStorageError(message(error));
        throw error;
      }
      if (current()) {
        setStorageError('');
        setPersonalPending(staged);
      }
      const result = await recoverNativeCanvasPersonal(staged, snapshot, personalEditable);
      if (!current()) return true;
      setPersonalPending((value) => (value?.revision === staged.revision ? null : value));
      setPersonal(result);
      onReload();
      return true;
    } catch (error) {
      if (current()) setError(message(error));
      return false;
    } finally {
      if (current()) setPersonalBusy(false);
    }
  }
  function savePersonalCommand(command: NativePersonalCanvasCommand, editorDraft?: DraftRef) {
    return savePersonalCommands([command], editorDraft);
  }
  async function savePlacement() {
    groupOrigins.current = null;
    const current = draftRef.current;
    if (!userId || !current || !placementEditable || allBusy || stale || storageError) return;
    try {
      const commands = (JSON.parse(current.values.commands!) as unknown[]).map((command) =>
        nativeEditorCommandSchema.parse(command),
      );
      let saved: boolean;
      if (isPrivate) {
        if (String(personal?.version ?? '') !== current.values.personalVersion)
          throw new Error('native.personal-conflict');
        saved = await savePersonalCommands(
          commands.map((command) => nativePersonalCanvasCommandSchema.parse(command)),
          {
            key: current.key,
            revision: current.revision,
          },
        );
      } else
        saved = await onSave(commands, current.expected, {
          key: current.key,
          revision: current.revision,
        });
      if (saved) {
        discardNativeEditorDraft(userId, snapshot.project.id, current);
        if (alive.current && draftRef.current?.revision === current.revision) {
          draftRef.current = null;
          setDraft(null);
        }
      }
    } catch (error) {
      setError(message(error));
    }
  }
  async function saveCanvasCommand(
    command: NativePersonalCanvasCommand,
    editorDraft?: DraftRef,
  ): Promise<boolean> {
    if (
      isPrivate ||
      command.type === 'set_viewport' ||
      command.type === 'upsert_combined_view' ||
      command.type === 'delete_combined_view'
    )
      return savePersonalCommand(command, editorDraft);
    return onSave([nativeSharedCanvasCommandSchema.parse(command)], expected(snapshot));
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
    if (!userId || allBusy || draft || stale || storageError || !commands.length) return false;
    if (
      isPrivate &&
      commands.every((command) => nativePersonalCanvasCommandSchema.safeParse(command).success)
    )
      return (
        placementEditable &&
        savePersonalCommands(
          commands.map((command) => nativePersonalCanvasCommandSchema.parse(command)),
          ref,
        )
      );
    if (!editable) return false;
    return onSave(
      commands.map((command) => nativeEditorCommandSchema.parse(command)),
      expected(snapshot),
      ref,
    );
  }
  async function commitDescription(id: string, value: string) {
    if (!userId || !placementEditable || allBusy || draft) return;
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
        personalVersion: String(personal?.version ?? ''),
      },
      values: { objectId: id, text: value, personalVersion: String(personal?.version ?? '') },
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
    if (!placementEditable || allBusy || draft) return;
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
        if (isPrivate) {
          onCreate?.('table');
          return;
        }
        const owner = base.domains.some((d) => d.id === effectiveView)
          ? effectiveView
          : domainFilter?.domainIds.length === 1 && !domainFilter.unassigned
            ? domainFilter.domainIds[0]!
            : null;
        const table = createNativeTable(sharedSource.database, id, owner);
        table.scope = mode;
        table.logical.name = t('새 테이블');
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
      if (await saveCommands(commands)) {
        setBlankSelection(false);
        setSelectedObjectIds([id]);
        if (kind === 'table') onSelect(id);
        else if (kind === 'domain') onSelectDomain?.(id);
      }
    } catch (error) {
      setError(message(error));
    }
  }
  async function arrangeVisibleNodes() {
    if (!placementEditable || allBusy || draft) return;
    try {
      const placements = nativeAutoLayoutPlacements(base, scene.nodes, effectiveView);
      if (placements.length > 100) {
        setError(t('한 번에 저장할 객체가 너무 많습니다. 나누어서 이동해 주세요.'));
        return;
      }
      await saveCommands(
        placements.map((node) =>
          nativeCanvasMoveCommand(isPrivate ? base : sharedSource, node, { x: node.x, y: node.y }),
        ),
      );
    } catch (error) {
      setError(message(error));
    }
  }
  async function deleteSelection(ids = selectionIds) {
    if (!placementEditable || allBusy || draft || deletionBusy.current || !ids.length) return;
    deletionBusy.current = true;
    const scope = operationScope.current;
    try {
      const commands = nativeCanvasDeleteCommands(
        isPrivate ? base : sharedSource,
        ids,
        effectiveView,
        isPrivate,
      );
      if (!commands.length) return;
      if (
        !(await confirm({
          title:
            ids.length > 1
              ? t('선택한 객체 {count}개 삭제', { count: ids.length })
              : t('객체 삭제'),
          description: t(
            isPrivate
              ? '이 화면의 참조와 메모를 삭제할까요? 원본 테이블은 유지됩니다.'
              : '선택한 객체와 소유 데이터·연결 관계를 삭제할까요?',
          ),
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
      rememberTableClipboard(copied.text, true);
      if (transfer) transfer.setData('text/plain', copied.text);
      else void navigator.clipboard?.writeText(copied.text).catch(() => {});
      if (cut) void deleteSelection(ids);
      setError('');
    } catch (error) {
      setError(t(nativeClipboardMessage(error instanceof Error ? error.message : '')));
    }
  }
  async function pasteSelection(text: string, point?: { x: number; y: number }) {
    if (!editable || allBusy || draft || effectiveView === 'overview') return;
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
    if (!connection || !editable || allBusy || draft) return;
    try {
      let command: CanvasCommand;
      if (connection.kind === 'domain') {
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
    () => ({ userId: userId ?? '', snapshot, busy: allBusy || !!draft || !editable, onSave }),
    [userId, snapshot, allBusy, draft, editable, onSave],
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
      expectation.version !== snapshot.project.version ||
      expectation.sequence !== snapshot.sequence ||
      expectation.databaseRevision !== snapshot.project.databaseRevision
    )
      return false;
    if (isPrivate)
      return savePersonalCommands(
        commands.map((command) => nativePersonalCanvasCommandSchema.parse(command)),
        ref,
      );
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
      busy: allBusy || !!draft || !placementEditable,
      affectsSharedDocument: !isPrivate,
      onSave: (
        commands: CanvasCommand[],
        expectation: ReturnType<typeof expected>,
        ref: DraftRef,
      ) => routeSaveRef.current(commands, expectation, ref),
    }),
    [userId, snapshot, allBusy, draft, placementEditable, isPrivate],
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
    () => (userId ? { userId, snapshot, busy: allBusy || !!draft, onSave } : undefined),
    [userId, snapshot, allBusy, draft, onSave],
  );
  const canvasSaveRef = useRef(saveCanvasCommand);
  useLayoutEffect(() => {
    canvasSaveRef.current = saveCanvasCommand;
  });
  const saveCanvasLatest = useCallback(
    (command: NativePersonalCanvasCommand, ref?: DraftRef) => canvasSaveRef.current(command, ref),
    [],
  );
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
      ...(base.views ?? []).map((view) => ({
        id: view.id,
        name: `${t('개인 화면')}: ${view.name}`,
      })),
    ],
    [base.domains, base.views, locale],
  );
  const auxiliary = (
    <>
      <div className="native-canvas-settings">
        <MemoNativeDomainRelationEditor
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
        <MemoNativeCanvasStyleEditor
          document={sharedSource}
          editable={editable}
          {...(selectedTableId ? { selectedTableId } : {})}
          {...(selectedDomainId ? { selectedDomainId } : {})}
          {...(recoverySelection?.style ? { initialSelection: recoverySelection.style } : {})}
          {...(sharedEditorContext ? { context: sharedEditorContext } : {})}
        />
        {recoveryWaiting && (
          <p role="status">
            {t('복구할 화면을 불러오는 중입니다. 원문은 보관된 입력에서 다운로드할 수 있습니다.')}
          </p>
        )}
        {userId &&
          (editable || personalEditable) &&
          !recoveryWaiting &&
          recoverySelection?.action && (
            <MemoNativeCanvasActions
              key={`${effectiveView}:${snapshot.project.version}:${snapshot.sequence}:${personal?.version ?? ''}`}
              document={base}
              source={sharedSource}
              snapshot={snapshot}
              userId={userId}
              viewId={effectiveView}
              busy={allBusy || !!draft || (isPrivate && !personal)}
              onSave={saveCanvasLatest}
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
        {...(personal ? { personal } : {})}
        personalBusy={personalBusy}
        writerState={privateQueueState}
        filter={domainFilter}
        {...(renderExportActions ? { renderControl: renderExportActions } : {})}
      />
    ),
    [
      snapshot,
      userId,
      effectiveView,
      mode,
      personal,
      personalBusy,
      privateQueueState,
      domainFilter,
      renderExportActions,
    ],
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
      {...{ panelToggle }}
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
      onPaste={() => void pasteFromMenu()}
      onResetRoutes={() =>
        void saveCommands(
          (base.layout.relations ?? [])
            .filter(
              (route) =>
                route.viewId === drawn.viewId &&
                scene.relations.some((item) => item.relation.id === route.relationId),
            )
            .map((route) => ({
              type: 'delete_relation_layout' as const,
              relationId: route.relationId,
              viewId: route.viewId,
            })),
        )
      }
      onOpenEnums={() => onRequestAction?.('enums', '')}
      onTools={onOpenTools}
      editable={editable}
      noteEditable={placementEditable}
      disabled={personalBusy || !!draft}
      mode={mode}
      onMode={onModeChange}
      inspectorOpen={inspectorOpen}
      onToggleInspector={onToggleInspector}
    />
  );
  const selectedObjectNode = scene.nodes.find((node) => node.id === selectedNode);
  const selectionInspector = selectedObjectNode && userId && (
    <NativeSelectedObjectInspector
      document={isPrivate ? base : sharedSource}
      node={selectedObjectNode}
      viewId={effectiveView}
      personalVersion={isPrivate ? personal?.version : undefined}
      context={{
        userId,
        snapshot,
        busy: allBusy || !!draft || !placementEditable,
        affectsSharedDocument: !isPrivate,
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
      {error && <p role="alert">{error}</p>}
      {personalEditable && !personalReady && (
        <p role="status">
          {t(
            '개인 화면 저장은 아직 지원하지 않습니다. 이 프로젝트에서는 공유 캔버스를 사용해 주세요.',
          )}
        </p>
      )}
      {userId && !personal && <p role="status">{t('개인 화면을 불러오는 중입니다.')}</p>}
      {base.domains.some((domain) => domain.id === effectiveView) && (
        <p>{t('공유 도메인 화면은 공유 테이블 배치를 사용합니다.')}</p>
      )}

      {draft && (
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
                  !scene.nodes.some((node) => node.objectId === draft.values.objectId) ||
                  (isPrivate && !personal)
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
                              nativeCanvasMoveCommand(isPrivate ? base : sharedSource, current, {
                                x: current.x,
                                y: current.y,
                              }),
                            ),
                          ),
                          personalVersion: String(personal?.version ?? ''),
                        },
                      };
                      draftRef.current = next;
                      setDraft(next);
                      storeNativeEditorDraft(next);
                      setError('');
                      setStorageError('');
                      if (!isPrivate) setSharedStorageFailure(false);
                      return;
                    }
                    const command = nativeCanvasMoveCommand(isPrivate ? base : sharedSource, node, {
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
                        personalVersion: String(personal?.version ?? ''),
                      },
                    };
                    draftRef.current = next;
                    setDraft(next);
                    storeNativeEditorDraft(next);
                    setError('');
                    setStorageError('');
                    if (!isPrivate) setSharedStorageFailure(false);
                  } catch (error) {
                    setError(message(error));
                    setStorageError(message(error));
                    if (!isPrivate) setSharedStorageFailure(true);
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
          <Button
            disabled={allBusy}
            onClick={() => {
              if (!userId) return;
              discardNativeEditorDraft(userId, snapshot.project.id, draft);
              draftRef.current = null;
              setDraft(null);
            }}
          >
            {t('배치 입력 초기화')}
          </Button>
        </div>
      )}
      {personalPending && (
        <div role="status">
          <p>{t('미확인 개인 저장 요청이 있습니다.')}</p>
          <Button
            disabled={personalBusy}
            onClick={() => {
              const identity = privateIdentity;
              const current = () => alive.current && activeIdentity.current === identity;
              setPersonalBusy(true);
              void recoverNativeCanvasPersonal(personalPending, snapshot, personalEditable)
                .then((result) => {
                  if (current()) {
                    setPersonalPending((value) =>
                      value?.revision === personalPending.revision ? null : value,
                    );
                    setPersonal(result);
                    onReload();
                  }
                })
                .catch((error) => {
                  if (current()) setError(message(error));
                })
                .finally(() => {
                  if (current()) setPersonalBusy(false);
                });
            }}
          >
            {t('개인 저장 결과 확인')}
          </Button>
          <Button
            disabled={
              personalBusy || privateQueueState === 'unknown' || privateQueueState === 'sending'
            }
            onClick={() => {
              const identity = privateIdentity;
              const current = () => alive.current && activeIdentity.current === identity;
              setPersonalBusy(true);
              void discardNativeCanvasPersonalPending(personalPending)
                .then(() => {
                  if (current())
                    setPersonalPending((value) =>
                      value?.revision === personalPending.revision ? null : value,
                    );
                })
                .catch((error) => {
                  if (current()) setError(message(error));
                })
                .finally(() => {
                  if (current()) setPersonalBusy(false);
                });
            }}
          >
            {t('개인 요청 초기화')}
          </Button>
          {!!userId && (
            <NativePrivateCASRecovery
              userId={userId}
              snapshot={snapshot}
              pending={personalPending}
              disabled={recoveryBusy || personalBusy || privateQueueState === 'sending'}
              options={{
                assertCurrent: () => {
                  if (!alive.current || activeIdentity.current !== privateIdentity)
                    throw Error('native.private-proof-scope-mismatch');
                },
              }}
              onDiscard={(archive) => {
                if (
                  !alive.current ||
                  activeIdentity.current !== privateIdentity ||
                  archive.pending.revision !== personalPending.revision
                )
                  return;
                setPersonalPending((value) =>
                  value?.revision === archive.pending.revision ? null : value,
                );
                setError('');
                void getNativeDurableQueue()
                  .read(userId, snapshot.project.id)
                  .then(() => {
                    if (alive.current && activeIdentity.current === privateIdentity) onReload();
                  })
                  .catch((error) => {
                    if (alive.current && activeIdentity.current === privateIdentity)
                      setError(message(error));
                  });
              }}
            />
          )}
        </div>
      )}
      <div
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
          setMenu(null);
          setRelationMenu(null);
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
            const rect = selectionRect(box.start, canvasPoint(event.clientX, event.clientY));
            setMarquee(rect);
            if (rect.width || rect.height) setBlankSelection(false);
            setSelectedObjectIds([
              ...new Set([...box.initial, ...intersectingObjects(rect, drawn.nodes)]),
            ]);
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
            marqueeGesture.current = null;
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
          panGesture.current = null;
          marqueeGesture.current = null;
          setMarquee(null);
          groupOrigins.current = null;
          spacePan.current = false;
        }}
        onLostPointerCapture={() => {
          panGesture.current = null;
        }}
        onClickCapture={(event) => {
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
          if (
            event.target instanceof Element &&
            event.target.closest(
              '.native-inline-editor,input,textarea,select,[contenteditable=true]',
            )
          )
            return;
          if (
            event.nativeEvent.isComposing ||
            event.repeat ||
            globalThis.document?.querySelector(toolShortcutOverlaySelector)
          )
            return;
          if (event.key === 'Escape') {
            setConnection(null);
            setConnectPointer(null);
            setMenu(null);
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
          if (event.key.toLowerCase() === 'h') setTool('hand');
          if (event.key.toLowerCase() === 'v') setTool('select');
        }}
        onKeyUpCapture={(event) => {
          if (event.code === 'Space') spacePan.current = false;
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
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
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
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
                userId && editable && !allBusy && !draft ? connectFromColumn : undefined
              }
              onDescriptionCommit={
                placementEditable && !allBusy && !draft ? commitDescriptionLatest : undefined
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
              onAddColumn={editable ? addColumnFromCard : undefined}
              resizeEnabled={placementEditable && !allBusy && !stale}
              onEdit={userId && editable ? openInline : undefined}
              {...(userId && editable ? { editorContext: inlineContext } : {})}
              onRequestStructure={onRequestStructure}
              onRequestAction={onRequestAction}
              onToggleNullable={
                userId && editable && !allBusy && !draft ? toggleNullableLatest : undefined
              }
            />
          </div>
          {marquee && (
            <div
              className="canvas-selection-box"
              data-export-hidden="true"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.width,
                height: marquee.height,
                borderWidth: 1 / camera.zoom,
              }}
            />
          )}
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
                    busy: allBusy || !!draft || !placementEditable,
                    affectsSharedDocument: !isPrivate,
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
                    personalVersion: String(personal?.version ?? ''),
                  }}
                  disabled={!placementEditable}
                  build={(values) => {
                    if (isPrivate && values.personalVersion !== String(personal?.version ?? ''))
                      throw Error('native.personal-conflict');
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
        {selectedRelationId && userId && (placementEditable || recoverySelection?.routeId) && (
          <NativeRelationEditor
            key={`${userId}:${snapshot.project.id}:${effectiveView}:${selectedRelationId}`}
            document={base}
            scene={drawn}
            viewId={drawn.viewId}
            relationId={selectedRelationId}
            world={worldElement}
            context={routeContext}
            personalVersion={isPrivate ? personal?.version : undefined}
            onClose={closeRoute}
          />
        )}
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
              disabled={!editable || allBusy || !!draft}
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
                        disabled: !editable || allBusy || !!draft,
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
                        disabled: !editable || allBusy || !!draft,
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
                ...(menu.source && base.domains.some((d) => d.id === menu.source)
                  ? [
                      {
                        id: 'direct-relation',
                        label: t('도메인 직접 연결'),
                        disabled: !editable || allBusy || !!draft || base.domains.length < 2,
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
                        disabled: !editable || allBusy || !!draft,
                        onAction: () =>
                          void createObject(
                            effectiveView === 'overview' ? 'domain' : 'table',
                            menu.point,
                          ),
                      },
                      {
                        id: 'new-note',
                        label: t('메모 추가'),
                        disabled: !placementEditable || allBusy || !!draft,
                        onAction: () => void createObject('note', menu.point),
                      },
                      {
                        id: 'auto-layout',
                        label: t('자동 배치'),
                        disabled: !placementEditable || allBusy || !!draft || !scene.nodes.length,
                        onAction: () => void arrangeVisibleNodes(),
                      },
                    ]
                  : []),
                ...(menu.source
                  ? [
                      {
                        id: 'delete-selected',
                        label: t('삭제'),
                        disabled: !placementEditable || allBusy || !!draft,
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
                        disabled: !placementEditable || allBusy || !!draft,
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
                  disabled: !editable || allBusy || !!draft,
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

function NativeCanvasActions({
  document,
  source,
  snapshot,
  userId,
  viewId,
  busy,
  onSave,
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
  onSave: (command: NativePersonalCanvasCommand, editorDraft?: DraftRef) => Promise<boolean>;
  onSharedSave: NativeEditorSave;
  sharedEditable: boolean;
  initialSelection?: { action: string; target: string };
}) {
  const { t } = useI18n();
  const [action, setAction] = useState(initialSelection?.action ?? 'note');
  const [target, setTarget] = useState(initialSelection?.target ?? '');
  const [id] = useState(() => nativeDurableId());
  const isPrivate = privateView(document, viewId),
    placementView = viewFor(document, viewId);
  const note = document.notes.find((note) => note.id === target);
  const view = document.views?.find((view) => view.id === target);
  const context = {
    userId,
    snapshot,
    busy,
    affectsSharedDocument: !isPrivate && !['view', 'view-edit', 'view-delete'].includes(action),
    onSave: async (commands: CanvasCommand[], exp: ReturnType<typeof expected>, ref?: DraftRef) => {
      if (!commands.length) return false;
      if (!isPrivate && !['view', 'view-edit', 'view-delete'].includes(action)) {
        if (!sharedEditable) return false;
        return onSharedSave(
          commands.map((command) => nativeEditorCommandSchema.parse(command)),
          exp,
          ref,
        );
      }
      const command = nativePersonalCanvasCommandSchema.parse(commands[0]);
      return onSave(command, ref);
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
          { value: 'remove-reference', label: t('참조 제거'), disabled: !isPrivate },
          { value: 'note', label: t('메모 추가') },
          { value: 'note-edit', label: t('메모 수정') },
          { value: 'note-delete', label: t('메모 삭제') },
          { value: 'view', label: t('화면 생성'), disabled: !personalGuardAvailable() },
          { value: 'view-edit', label: t('화면 수정'), disabled: !personalGuardAvailable() },
          { value: 'view-delete', label: t('화면 삭제'), disabled: !personalGuardAvailable() },
        ]}
      />
      {!['note', 'view'].includes(action) && (
        <NativeEditorField
          label="대상"
          value={target}
          disabled={busy}
          onChange={setTarget}
          choices={[
            { value: '', label: '—' },
            ...(action.startsWith('view-')
              ? (document.views ?? []).map((view) => ({ value: view.id, label: view.name }))
              : action.startsWith('note-')
                ? document.notes
                    .filter((note) => note.viewId === placementView)
                    .map((note) => ({ value: note.id, label: note.text.slice(0, 30) || note.id }))
                : (document.tables ?? [])
                    .filter((table) =>
                      isPrivate
                        ? table.domainId !== null &&
                          document
                            .views!.find((view) => view.id === viewId)!
                            .domainIds.includes(table.domainId)
                        : true,
                    )
                    .map((table) => ({
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
          name: view?.name ?? '',
          domains: view?.domainIds.join('\n') ?? '',
          text: note?.text ?? '',
          x: '40',
          y: '40',
          confirm: 'false',
        }}
        disabled={
          (['view', 'view-edit'].includes(action) && !document.domains.length) ||
          (action.startsWith('view') && !personalGuardAvailable()) ||
          (!isPrivate && !sharedEditable && !action.startsWith('view'))
        }
        build={(values) => {
          let command: unknown;
          if (action === 'reference')
            command = {
              type: 'add_table_reference',
              tableId: target,
              viewId: placementView,
              nodeId: values.id,
              placement: { x: Number(values.x), y: Number(values.y) },
            };
          else if (action === 'remove-reference') {
            if (values.confirm !== 'true') throw new Error('deletion.review-required');
            const node = document.layout.nodes.find(
              (node) => node.objectId === target && node.viewId === placementView,
            );
            if (!node) throw new Error('canvas.node-not-found');
            command = { type: 'remove_table_reference', nodeId: node.id };
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
          } else if (action === 'view-delete') {
            if (values.confirm !== 'true') throw new Error('deletion.review-required');
            command = { type: 'delete_combined_view', id: target };
          } else
            command = {
              type: 'upsert_combined_view',
              value: {
                id: action === 'view-edit' ? target : values.id,
                name: values.name,
                domainIds: (values.domains ?? '').split('\n').filter(Boolean),
              },
            };
          // The shared queue excludes private view commands. Personal forms route directly to PUT.
          return [
            ['view', 'view-edit', 'view-delete'].includes(action)
              ? nativePersonalCanvasCommandSchema.parse(command)
              : nativeEditorCommandSchema.parse(command),
          ];
        }}
      >
        {(values, change) => (
          <>
            {['view', 'view-edit'].includes(action) && (
              <>
                <NativeEditorField
                  label="이름"
                  value={values.name ?? ''}
                  onChange={(value) => change('name', value)}
                />
                <fieldset>
                  <legend>{t('도메인 선택')}</legend>
                  {document.domains.map((domain) => (
                    <label key={domain.id}>
                      <input
                        type="checkbox"
                        checked={(values.domains ?? '').split('\n').includes(domain.id)}
                        onChange={(event) => {
                          const ids = (values.domains ?? '').split('\n').filter(Boolean);
                          change(
                            'domains',
                            (event.target.checked
                              ? [...ids, domain.id]
                              : ids.filter((id) => id !== domain.id)
                            ).join('\n'),
                          );
                        }}
                      />
                      {domain.name}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
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
            {['note-delete', 'view-delete', 'remove-reference'].includes(action) && (
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

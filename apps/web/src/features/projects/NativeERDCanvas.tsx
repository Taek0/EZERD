import type { CommentContext } from '../comments/CommentsPanel.js';
import { pinPosition, reviewCanvasView, type ReviewTarget } from '../comments/comments-state.js';
import type { NativeDomainFilterValue } from './NativeDomainFilter.js';
import { createPortal } from 'react-dom';
import { NativeCanvasToolbar, NativeCameraControls } from './NativeCanvasToolbar.js';
import { NativeCanvasInputForm } from './NativeCanvasInputForm.js';
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
  type NativeDesignDocument,
  type NodeLayout,
  type Viewport,
} from '@ezerd/model';
import { relationGeometry } from '../relations/relation-routing.js';
import { wheelCamera } from '../canvas/canvas-wheel.js';
import { Button } from '../../components/ui/index.js';
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
import { NativeClipboardMenu } from './native-clipboard.js';
import { NativePrivateCASRecovery } from './NativePrivateCASRecovery.js';
import { NativeCanvasStyleEditor } from './NativeCanvasStyleEditor.js';
import type { NativeCanvasRecoverySelection } from './native-canvas-recovery-types.js';
import { NativeDomainRelationEditor } from './NativeDomainRelationEditor.js';
import { NativeCanvasScene, type NativeSceneActions } from './NativeCanvasScene.js';
import { NativeCanvasPngExport } from './NativeCanvasPngExport.js';
import { nativeTableCanvasRows } from './native-canvas-style.js';
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
const MemoNativeClipboardMenu = memo(NativeClipboardMenu);
const MemoNativeCanvasActions = memo(NativeCanvasActions);

registerTranslations({
  '복구할 화면을 불러오는 중입니다. 원문은 보관된 입력에서 다운로드할 수 있습니다.':
    'Loading the recovery view. You can download its source from preserved input.',
  'Native ERD': 'Native ERD',
  '공유 캔버스': 'Shared canvas',
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
  '카메라 저장': 'Save camera',
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
  '카메라 초기화': 'Reset camera',
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
export function nativeCanvasMoveCommand(
  source: NativeDesignDocument,
  displayed: NodeLayout,
  patch: Pick<NodeLayout, 'x' | 'y'>,
): NativeEditorCommand {
  const raw = source.layout.nodes.find(
    (node) => node.objectId === displayed.objectId && node.viewId === displayed.viewId,
  );
  if (raw)
    return nativeEditorCommandSchema.parse({ type: 'update_node_layout', nodeId: raw.id, patch });
  if (!source.tables?.some((table) => table.id === displayed.objectId))
    throw new Error('canvas.node-not-found');
  return nativeEditorCommandSchema.parse({
    type: 'add_table_reference',
    tableId: displayed.objectId,
    viewId: displayed.viewId,
    nodeId: nativeDurableId(),
    placement: { ...patch, width: displayed.width, height: displayed.height },
  });
}

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
      // Native labels drive rows; no v1 type/DDL/metrics adapter is involved.
      return {
        ...node,
        width: size.width,
        height: Math.min(
          nodeLayoutSchema.shape.height.maxValue!,
          Math.max(
            size.height,
            table
              ? 78 +
                  nativeTableCanvasRows(document, table, mode).reduce(
                    (height, row) => height + row.height,
                    0,
                  )
              : size.height,
          ),
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
                (78 +
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
      Math.max(90, label.length * 8 + 24),
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
) {
  const moved = scene.nodes.find((node) => node.objectId === objectId);
  if (
    !moved ||
    !document.layout.nodes.some((node) => node.id === moved.id) ||
    (moved.x === Number(x) && moved.y === Number(y))
  )
    return scene;
  const displayed = new Map(
    scene.nodes.map((node) => [
      node.id,
      node.objectId === objectId ? { ...node, x: Number(x), y: Number(y) } : node,
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

export function NativeERDCanvas({
  document,
  snapshot,
  userId,
  editable,
  personalEditable = editable,
  busy,
  recoveryBusy = busy,
  onSave,
  onReload,
  mode,
  selectedTableId,
  selectedDomainId,
  onSelect,
  onSelectDomain,
  recoverySelection,
  inspectorHost,
  inspectorOpen,
  onToggleInspector,
  onOpenTools,
  onCreate,
  onModeChange,
  onViewChange,
  pins,
  onReviewContext,
  pinMode = false,
  onCreatePin,
  reviewFocus,
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
  onCreate?: (kind: 'table' | 'domain' | 'enum') => void;
  onModeChange?: (mode: 'physical' | 'logical') => void;
  onViewChange?: (id: string) => void;
  pins?: ReactNode;
  onReviewContext?: (context: CommentContext, document: NativeDesignDocument) => void;
  pinMode?: boolean;
  onCreatePin?: (context: CommentContext) => void;
  reviewFocus?: (ReviewTarget & { nonce: number }) | null;
}) {
  const { t, locale } = useI18n();
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
      setDomainFilter(null);
      setViewId(id);
      onViewChange?.(id);
    },
    [onViewChange],
  );
  const applyDomainFilter = useCallback((filter: NativeDomainFilterValue | null) => {
    setViewId(TABLES_VIEW_ID);
    setDomainFilter(filter);
  }, []);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [toolbarAction, setToolbarAction] = useState<{
    action: string;
    target: string;
    nonce: number;
  } | null>(null);
  const spacePan = useRef(false);
  const panGesture = useRef<{ pointerId: number; x: number; y: number; camera: Viewport } | null>(
    null,
  );
  const addNoteFromToolbar = useCallback(() => {
    setToolbarAction((value) => ({ action: 'note', target: '', nonce: (value?.nonce ?? 0) + 1 }));
    onOpenTools?.();
  }, [onOpenTools]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedDomainRelation, setSelectedDomainRelation] = useState<string | null>(null);
  const [camera, setCamera] = useState<Viewport>({ viewId: TABLES_VIEW_ID, x: 24, y: 24, zoom: 1 });
  const gesture = useRef<{ node: NodeLayout; x: number; y: number; pointerId: number } | null>(
    null,
  );
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
  const savedCamera = personal?.state.viewports.find(
    (viewport) => viewport.viewId === effectiveView,
  ) ?? { viewId: effectiveView, x: 24, y: 24, zoom: 1 };
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
    setSelectedNode(null);
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
  const draftObjectId = draft?.values.objectId;
  const draftX = draft?.values.x;
  const draftY = draft?.values.y;
  const drawn = useMemo(
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
      ),
    [base, scene, effectiveView, mode, draftObjectId, draftX, draftY, domainFilter],
  );
  function preserve(node: NodeLayout, x: number, y: number) {
    if (!userId || !placementEditable || allBusy || stale) return;
    if (
      base.domains.some((domain) => domain.id === node.objectId) &&
      !sharedSource.layout.nodes.some((raw) => raw.id === node.id)
    )
      return;
    const command = nativeCanvasMoveCommand(isPrivate ? base : sharedSource, node, {
      x: limit(x),
      y: limit(y),
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
  async function savePersonalCommand(
    command: NativePersonalCanvasCommand,
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
      const candidate = nativeCanvasPersonalCandidate(personalSource, command);
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
  async function savePlacement() {
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
        saved = await savePersonalCommand(nativePersonalCanvasCommandSchema.parse(commands[0]), {
          key: current.key,
          revision: current.revision,
        });
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
      (event.target instanceof Element && event.target.closest('button,input,select,textarea'))
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { node, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    setSelectedNode(node.id);
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
      return commands.length === 1
        ? savePersonalCommand(nativePersonalCanvasCommandSchema.parse(commands[0]), ref)
        : false;
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
  const openInline = useCallback((target: NativeInlineTarget) => {
    setSelectedRelationId(null);
    setInlineTarget(target);
  }, []);
  const selectRoute = useCallback((id: string | null) => {
    setInlineTarget(null);
    setSelectedRelationId(id);
  }, []);
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
        {' '}
        {personalEditable && (
          <Button
            disabled={allBusy || !personal || !personalReady}
            onClick={() =>
              void savePersonalCommand({
                type: 'set_viewport',
                value: { ...camera, viewId: effectiveView },
              })
            }
          >
            {t('카메라 저장')}
          </Button>
        )}
        <Button onClick={() => setCamera(savedCamera)}>{t('카메라 초기화')}</Button>{' '}
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
        <MemoNativeClipboardMenu
          key={`clipboard:${userId ?? ''}:${snapshot.project.id}`}
          snapshot={snapshot}
          {...(userId ? { userId } : {})}
          editable={editable}
          busy={allBusy || !!draft}
          onSave={onSave}
          {...(selectedTableId ? { selectedTableId } : {})}
          destinationDomainId={
            base.domains.some((domain) => domain.id === effectiveView) ? effectiveView : null
          }
        />
        {recoveryWaiting && (
          <p role="status">
            {t('복구할 화면을 불러오는 중입니다. 원문은 보관된 입력에서 다운로드할 수 있습니다.')}
          </p>
        )}
        {userId && (editable || personalEditable) && !recoveryWaiting && (
          <MemoNativeCanvasActions
            key={`${effectiveView}:${snapshot.project.version}:${snapshot.sequence}:${personal?.version ?? ''}:${toolbarAction?.nonce ?? 0}`}
            document={base}
            source={sharedSource}
            snapshot={snapshot}
            userId={userId}
            viewId={effectiveView}
            busy={allBusy || !!draft || (isPrivate && !personal)}
            onSave={saveCanvasLatest}
            onSharedSave={onSave}
            sharedEditable={editable}
            {...(toolbarAction
              ? { initialSelection: toolbarAction }
              : recoverySelection?.action
                ? { initialSelection: recoverySelection.action }
                : {})}
          />
        )}
      </div>
    </>
  );
  const reviewCallback = useRef(onReviewContext);
  reviewCallback.current = onReviewContext;
  useEffect(() => {
    reviewCallback.current?.(
      {
        viewId: effectiveView,
        selectedObjectId: selectedDomainId ?? selectedTableId ?? null,
        visibleObjectIds: scene.nodes.map((node) => node.objectId),
        position: { x: 0, y: 0 },
      },
      base,
    );
  }, [base, scene, effectiveView, selectedDomainId, selectedTableId]);
  useEffect(() => {
    if (!reviewFocus) return;
    const view = reviewCanvasView(base, reviewFocus);
    const point = pinPosition(base, reviewFocus);
    if (effectiveView !== view) {
      navigateView(view);
      return;
    }
    setCamera({ viewId: view, x: 120 - point.x, y: 120 - point.y, zoom: 1 });
  }, [reviewFocus?.nonce, effectiveView]);
  return (
    <section className="native-erd" aria-label={t('Native ERD')}>
      <NativeCanvasToolbar
        exportControl={
          <MemoNativeCanvasPngExport
            snapshot={snapshot}
            {...(userId ? { userId } : {})}
            viewId={effectiveView}
            mode={mode}
            sceneFor={nativeCanvasScene}
            {...(personal ? { personal } : {})}
            personalBusy={personalBusy}
            writerState={privateQueueState}
          />
        }
        viewId={effectiveView}
        views={toolbarViews}
        onView={navigateView}
        domains={base.domains}
        filter={domainFilter}
        onFilter={applyDomainFilter}
        onCreate={onCreate}
        onNote={addNoteFromToolbar}
        onTools={onOpenTools}
        editable={editable}
        noteEditable={placementEditable}
        disabled={personalBusy || !!draft}
        mode={mode}
        onMode={onModeChange}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
      />
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
        className={`native-erd-surface${tool === 'hand' ? ' hand-tool' : ''}${pinMode ? ' pin-mode' : ''}`}
        onPointerDownCapture={(event) => {
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
          if (!(tool === 'hand' || spacePan.current || event.button === 1)) return;
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
          if (panGesture.current?.pointerId !== event.pointerId) return;
          event.stopPropagation();
          panGesture.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          panGesture.current = null;
          spacePan.current = false;
        }}
        onLostPointerCapture={() => {
          panGesture.current = null;
        }}
        onClickCapture={(event) => {
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
          className="native-erd-world"
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
              selectedTableId={selectedTableId}
              selectedDomainId={selectedDomainId}
              selectedDomainRelation={selectedDomainRelation}
              selectedRelationId={selectedRelationId}
              onSelectRelation={selectRoute}
              draftObjectId={draftObjectId}
              setSelectedNode={setSelectedNode}
              setSelectedDomainRelation={setSelectedDomainRelation}
              onSelect={onSelect}
              onSelectDomain={onSelectDomain}
              gesture={gesture}
              actions={sceneActions}
              onOpenDomain={navigateView}
              onEdit={userId && editable ? openInline : undefined}
            />
          </div>
        </div>
        {inlineTarget && userId && (
          <NativeCanvasInlineEditor
            key={`${userId}:${snapshot.project.id}`}
            document={sharedSource}
            target={inlineTarget}
            context={inlineContext}
            onClose={closeInline}
          />
        )}
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
        <div className="native-canvas-hint">
          {t(tool === 'hand' ? '손 도구 · 드래그로 화면 이동' : '커서 도구 · 객체 선택과 이동')}
        </div>
        <NativeCameraControls
          tool={tool}
          onTool={setTool}
          zoom={camera.zoom}
          onZoom={(factor) => setCamera({ ...camera, zoom: zoomLimit(camera.zoom * factor) })}
          onReset={() => setCamera({ ...camera, zoom: 1 })}
          onFit={() => {
            const x = drawn.nodes.length ? Math.min(...drawn.nodes.map((node) => node.x)) : 0;
            const y = drawn.nodes.length ? Math.min(...drawn.nodes.map((node) => node.y)) : 0;
            setCamera({ viewId: effectiveView, x: limit(24 - x), y: limit(24 - y), zoom: 1 });
          }}
        />
        {!drawn.nodes.length && (
          <p className="native-erd-empty">{t('이 화면에 표시할 노드가 없습니다.')}</p>
        )}
      </div>
      {inspectorHost === undefined
        ? auxiliary
        : inspectorHost
          ? createPortal(auxiliary, inspectorHost)
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
      <summary>
        {t('공유 캔버스')} / {t('개인 화면')}
      </summary>
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

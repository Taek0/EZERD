import { createFrameQueue } from './frame-queue.js';
import { initialCanvasView, visibleCanvasTable } from './canvas-view.js';
import {
  copyTables,
  acknowledgeSystemTableClipboard,
  localTablePasteFallback,
  parseTableClipboard,
  pasteTables,
  readLocalTableClipboard,
  rememberTableClipboard,
} from './table-clipboard.js';
import {
  canvasToolShortcut,
  toolShortcutInputSelector,
  toolShortcutOverlaySelector,
  type CanvasTool,
} from './canvas-tool-shortcuts.js';
import { prepareTableRelations } from '../relations/prepare-table-relations.js';
import { translate as tr, useI18n } from '../../shared/i18n/index.js';
import './translations.js';
import { createPortal } from 'react-dom';
import {
  domainCanvasTarget,
  domainFilterOwner,
  domainFilterNames,
  matchesDomainFilter,
  type DomainFilter,
} from '../domains/domain-view.js';
import {
  selectionRect,
  intersectingObjects,
  translateSelectedNodes,
  type SelectionPoint,
} from './canvas-selection.js';
import './canvas-tools.css';
import { wheelCamera, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM } from './canvas-wheel.js';
import {
  applyDomainRelationPatch,
  type DomainRelationPatch,
} from '../domains/domain-relation-edit.js';
import { DialogTrigger, Dialog } from 'react-aria-components';
import { UntitledPopover } from '../../components/ui/untitled.js';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type PointerEvent,
  type SetStateAction,
} from 'react';
import {
  type DesignDocument,
  type Table,
  TABLES_VIEW_ID,
  upsertTableRelation,
  removeTableRelation,
  removeTable,
  isVisibleInView,
  autoLayoutView,
  addTable,
  addDomain,
  updateDomain,
  removeDomain,
  upsertDomainRelation,
  removeDomainRelation,
  addNote,
  updateNote,
  removeNote,
  updateNodeLayout as modelUpdateNodeLayout,
} from '@ezerd/model';
import {
  inspectorBounds,
  clampInspectorWidth,
  readInspectorWidth,
  shouldStackInspector,
} from './inspector-state.js';
import { tableCardSize } from '../tables/table-geometry.js';
import type { LegacyDatabaseEditorContext } from '../tables/legacy-database-editor-policy.js';
import { exportCanvasPng } from './canvas-export.js';
import { layoutDomainRelations } from '../domains/domain-relations.js';
import { DomainDescription } from '../domains/DomainDescription.js';
import { DomainColorPicker } from '../domains/DomainColorPicker.js';
import { useConfirm } from '../../components/ui/ConfirmProvider.js';
import { cardSize, connectedRelations } from './canvas-state.js';
import {
  TableNodeContent,
  TableInspector,
  RelationEditor,
  TableWorkspaceTools,
  TableRelationsSvg,
  ForeignKeyDialog,
  EnumDialog,
  emptyMetadata,
} from '../tables/TableEditor.js';
import { clampLayoutPatch, message, newId } from '../../shared/api/client.js';
import {
  Button,
  Checkbox,
  ContextMenu,
  Dropdown,
  IconButton,
  Input,
  Select,
  TabButton,
  Textarea,
} from '../../components/ui/index.js';
import { PanelList, PanelNote, PanelRow, PanelSection } from '../../shared/editor/panel.js';
import { syncLayoutPolicy } from '../collaboration/sync-layout-policy.js';
import '../domains/domain-workflow.css';
export type CanvasContext = {
  viewId: string;
  selectedObjectId: string | null;
  visibleObjectIds?: string[];
  position: { x: number; y: number };
};
type Props = LegacyDatabaseEditorContext & {
  toolbarHost?: HTMLElement | null;
  pathHost?: HTMLElement | null;
  panelToggle?: ReactNode;
  onExportProject?: () => Promise<void>;
  onExportDDL?: () => Promise<void>;
  onCreatePin?: (context: CanvasContext) => void;
  onContextChange?: (context: CanvasContext) => void;
  focusTarget?: {
    viewId: string;
    objectId: string | null;
    threadId?: string;
    x: number;
    y: number;
    nonce: number;
  };
  pins?: ReactNode;
  document: DesignDocument;
  onChange: (document: DesignDocument) => void;
  onPreviewChange?: (document: DesignDocument) => void;
  readOnly: boolean;
  personalReadOnly?: boolean;
};
export function Canvas({
  document: doc,
  onChange,
  onPreviewChange,
  readOnly,
  onContextChange,
  focusTarget,
  pins,
  onCreatePin,
  toolbarHost,
  pathHost,
  panelToggle,
  onExportProject,
  onExportDDL,
  databaseKind,
  onRequestNativeUpgrade,
}: Props) {
  useI18n();
  const confirm = useConfirm();
  const latestDeletion = useRef({ doc, onChange, readOnly });
  latestDeletion.current = { doc, onChange, readOnly };
  const deletionPending = useRef(false);
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
  const [domainFilter, setDomainFilter] = useState<DomainFilter>(null);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [selectAllDomains, setSelectAllDomains] = useState(true);
  const selectedDomainSet = new Set(selectedDomains);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [clipboardError, setClipboardError] = useState('');
  const pasteCount = useRef(0);
  const clipboardActive = useRef(true);
  useEffect(() => {
    clipboardActive.current = true;
    return () => {
      clipboardActive.current = false;
    };
  }, []);
  const viewMode = 'physical' as const;
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try {
      return localStorage.getItem('ezerd.inspector') !== 'hidden';
    } catch {
      return true;
    }
  });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(1100);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      return readInspectorWidth(localStorage.getItem('ezerd.inspectorWidth'));
    } catch {
      return 320;
    }
  });
  const [resizingInspector, setResizingInspector] = useState(false);
  const inspectorDrag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWorkspaceWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('ezerd.inspectorWidth', String(inspectorWidth));
    } catch {
      /* Optional preference. */
    }
  }, [inspectorWidth]);
  const panelWidth = clampInspectorWidth(inspectorWidth, workspaceWidth);
  const panelBounds = inspectorBounds(workspaceWidth);
  const stackedInspector = shouldStackInspector(workspaceWidth);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [connectedOpen, setConnectedOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<'properties' | 'outline'>('properties');
  const [enumOpen, setEnumOpen] = useState(false);
  const [domainName, setDomainName] = useState('');
  const [relationSearch, setRelationSearch] = useState('');
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectPointer, setConnectPointer] = useState<{ x: number; y: number } | null>(null);
  const [fkSource, setFkSource] = useState<string | null>(null);
  const [fkTarget, setFkTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ source: string | null; x: number; y: number } | null>(null);
  const menuPointer = useRef({ x: 0, y: 0 });
  const blankPosition = useRef<{ viewId: string; x: number; y: number } | null>(null);
  const contextCallback = useRef(onContextChange);
  contextCallback.current = onContextChange;
  useEffect(() => {
    try {
      localStorage.setItem('ezerd.inspector', inspectorOpen ? 'visible' : 'hidden');
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }, [inspectorOpen]);
  const [requestedViewId, setViewId] = useState(() => initialCanvasView(doc)),
    [selected, setSelectedState] = useState<string | null>(null),
    [relationId, setRelationId] = useState('');
  const [tool, setTool] = useState<CanvasTool>('select');
  const [multiSelection, setMultiSelection] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<ReturnType<typeof selectionRect> | null>(null);
  function setSelected(value: SetStateAction<string | null>) {
    setMultiSelection([]);
    setSelectedState(value);
  }
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [relationName, setRelationName] = useState(''),
    [direction, setDirection] = useState<'forward' | 'both'>('forward'),
    [relationDescription, setRelationDescription] = useState('');
  const [relationNameDraft, setRelationNameDraft] = useState<{
    id: string;
    base: string;
    value: string;
  } | null>(null);
  const editingDomainRelation = doc.domainRelations.find((relation) => relation.id === relationId);
  const displayedRelationName = editingDomainRelation
    ? relationNameDraft?.id === relationId && relationNameDraft.base === editingDomainRelation.name
      ? relationNameDraft.value
      : editingDomainRelation.name
    : relationName;
  const viewId = requestedViewId === 'overview' ? 'overview' : TABLES_VIEW_ID;
  const fullCanvas = viewId === TABLES_VIEW_ID;
  const creationOwner = fullCanvas ? domainFilterOwner(doc, domainFilter) : undefined;
  const [localViewports, setLocalViewports] = useState<
    Record<
      string,
      {
        viewId: string;
        x: number;
        y: number;
        zoom: number;
      }
    >
  >({});
  const surface = useRef<HTMLDivElement>(null),
    live = useRef(doc);
  live.current = doc;
  const drag = useRef<{
    id: string | null;
    resize: boolean;
    pending: boolean;
    captureTarget: HTMLDivElement;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    boxStart?: SelectionPoint;
    boxEnd?: SelectionPoint;
    members?: { id: string; x: number; y: number }[];
    zoom?: number;
  } | null>(null);
  const viewport = localViewports[viewId] ??
    doc.layout.viewports.find((v) => v.viewId === viewId) ?? { viewId, x: 40, y: 40, zoom: 1 };
  const [previewFrame] = useState(() => createFrameQueue());
  const [cameraFrame] = useState(() => createFrameQueue());
  const pendingCamera = useRef<typeof viewport | null>(null);
  const cameraCurrent = useRef(viewport);
  cameraCurrent.current = viewport;
  const gestureContext = useRef({ viewId, readOnly });
  gestureContext.current = { viewId, readOnly };
  const previewLatest = useRef(preview);
  previewLatest.current = preview;
  const finishLatest = useRef(finish);
  finishLatest.current = finish;
  const switchToolLatest = useRef(switchTool);
  switchToolLatest.current = switchTool;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const nextTool = canvasToolShortcut(event, {
        editing: !!target?.closest(toolShortcutInputSelector),
        overlayOpen: !!document.querySelector(toolShortcutOverlaySelector),
        dragging: !!drag.current || !!inspectorDrag.current,
      });
      if (!nextTool) return;
      event.preventDefault();
      switchToolLatest.current(nextTool);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useLayoutEffect(() => {
    setMarquee(null);
    return () => {
      previewFrame.cancel();
      cameraFrame.cancel();
      pendingCamera.current = null;
      const active = drag.current;
      drag.current = null;
      if (active?.captureTarget.hasPointerCapture(active.pointerId))
        active.captureTarget.releasePointerCapture(active.pointerId);
    };
  }, [viewId, domainFilter, readOnly, previewFrame, cameraFrame]);
  useEffect(() => {
    const finishInput = () => finishLatest.current();
    const hidden = () => {
      if (document.hidden) finishInput();
    };
    window.addEventListener('blur', finishInput);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', finishInput);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  const layoutPolicy = syncLayoutPolicy(readOnly, false);
  const noteReadOnly = readOnly;
  // Camera state does not change document-space geometry. Any new document invalidates it.
  const nodes = useMemo(
    () =>
      doc.layout.nodes
        .filter((n) => {
          const table = (doc.tables ?? []).find((t) => t.id === n.objectId);
          return (
            n.viewId === viewId &&
            (!table || visibleCanvasTable(doc, table, viewId, viewMode, domainFilter))
          );
        })
        .map((node) => {
          const kind = doc.domains.some((d) => d.id === node.objectId)
            ? 'domain'
            : (doc.tables ?? []).some((t) => t.id === node.objectId)
              ? 'table'
              : 'note';
          return {
            ...node,
            ...(kind === 'table'
              ? tableCardSize(doc, node.objectId, node.width, node.height)
              : cardSize(kind, node.width, node.height)),
          };
        }),
    [doc, viewId, viewMode, domainFilter],
  );
  const visibleNodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);
  // Context updates rerender the parent. Keep IDs stable even if it supplies a new document wrapper.
  const visibleObjectKey = JSON.stringify(nodes.map((node) => node.objectId));
  const visibleObjectIds = useMemo(
    () => JSON.parse(visibleObjectKey) as string[],
    [visibleObjectKey],
  );
  const domainRoutes = useMemo(
    () => layoutDomainRelations(doc.domainRelations, nodes),
    [doc.domainRelations, nodes],
  );
  const tableRelations = useMemo(
    () =>
      viewId === 'overview' ? [] : prepareTableRelations(doc, viewId, viewMode, visibleNodeIds),
    [doc, viewId, viewMode, visibleNodeIds],
  );
  const selectedNode = nodes.find((n) => n.objectId === selected),
    domain = selectedNode && doc.domains.find((d) => d.id === selected),
    note = selectedNode && doc.notes.find((n) => n.id === selected);
  const selectedObjects = multiSelection.filter((id) => nodes.some((n) => n.objectId === id));
  const selectedTableIds = (
    selectedObjects.length ? selectedObjects : selectedNode && selected ? [selected] : []
  ).filter((id) => doc.tables?.some((t) => t.id === id));
  const tableMenu = !!menu?.source && !!doc.tables?.some((t) => t.id === menu.source);
  function clipboardTarget(target: EventTarget | null) {
    return (
      target instanceof Element &&
      surface.current?.contains(target) &&
      !target.closest(toolShortcutInputSelector) &&
      !document.querySelector(toolShortcutOverlaySelector) &&
      tool === 'select' &&
      !drag.current
    );
  }
  function copySelection(cut: boolean, transfer?: DataTransfer) {
    if (!selectedTableIds.length || (cut && readOnly)) return;
    try {
      const text = copyTables(doc, selectedTableIds, nodes);
      if (!parseTableClipboard(text)) throw new Error();
      if (transfer) transfer.setData('text/plain', text);
      rememberTableClipboard(text, !transfer);
      pasteCount.current = 0;
      if (!transfer)
        void navigator.clipboard
          ?.writeText(text)
          .then(() => acknowledgeSystemTableClipboard(text))
          .catch(() => {
            // LAN / denied clipboard access: preserve the complete in-tab snapshot.
          });
      if (cut) {
        change(selectedTableIds.reduce((next, id) => removeTable(next, id), doc));
        setSelected(null);
      }
      setClipboardError('');
      surface.current?.focus({ preventScroll: true });
    } catch {
      setClipboardError(tr('테이블을 클립보드에 보관하지 못했습니다.'));
    }
  }
  function pasteSelection(text: string, atPointer = false) {
    if (readOnly || creationOwner === undefined) return;
    const fragment = parseTableClipboard(text);
    if (!fragment) {
      setClipboardError(tr('복사한 테이블이 없습니다.'));
      return;
    }
    try {
      const camera = cameraCurrent.current;
      const offset = 32 * (pasteCount.current + 1);
      const point =
        atPointer && blankPosition.current?.viewId === viewId
          ? blankPosition.current
          : { x: -camera.x / camera.zoom + offset, y: -camera.y / camera.zoom + offset };
      const result = pasteTables(doc, fragment, creationOwner, point, newId);
      change(result.document);
      setSelectedState(result.ids[0] ?? null);
      setMultiSelection(result.ids);
      pasteCount.current++;
      setClipboardError('');
      surface.current?.focus({ preventScroll: true });
    } catch {
      setClipboardError(tr('테이블을 붙여넣지 못했습니다. 문서 크기와 내용을 확인해 주세요.'));
    }
  }
  async function pasteFromMenu() {
    const original = doc;
    let text = readLocalTableClipboard();
    try {
      if (navigator.clipboard?.readText && !localTablePasteFallback())
        text = await navigator.clipboard.readText();
    } catch {
      // Retain the local copy when system clipboard access is unavailable.
    }
    if (
      !clipboardActive.current ||
      latestDeletion.current.doc !== original ||
      latestDeletion.current.readOnly ||
      gestureContext.current.viewId !== viewId
    )
      return;
    pasteSelection(text, true);
  }
  useEffect(() => {
    if (source && !doc.domains.some((d) => d.id === source)) setSource('');
    if (target && !doc.domains.some((d) => d.id === target)) setTarget('');
    if (relationId && !doc.domainRelations.some((r) => r.id === relationId)) {
      setRelationId('');
      setRelationName('');
      setRelationDescription('');
    }
  }, [doc.domains, doc.domainRelations, source, target, relationId]);
  const table = selectedNode && (doc.tables ?? []).find((t) => t.id === selected);
  const selectedTableRelation = tableRelations.find(
    (item) => item?.relation.id === selected,
  )?.relation;
  const visibleSelection =
    selectedNode ||
    selectedTableRelation ||
    (viewId === 'overview' && doc.domainRelations.some((relation) => relation.id === selected));
  useEffect(() => {
    if (selected && !visibleSelection) setSelected(null);
    setMultiSelection((ids) => {
      const visible = ids.filter((id) => nodes.some((node) => node.objectId === id));
      return visible.length === ids.length ? ids : visible;
    });
    if (menu?.source && !nodes.some((node) => node.objectId === menu.source)) setMenu(null);
    if (
      fkSource &&
      !doc.columns?.some(
        (column) => column.id === fkSource && viewTables.some((item) => item.id === column.tableId),
      )
    ) {
      setFkSource(null);
      setFkTarget(null);
    }
  }, [doc, viewId, nodes, selected, visibleSelection, menu?.source, fkSource]);
  useEffect(() => {
    setMenu(null);
    setViewPickerOpen(false);
    setConnectSource(null);
    setConnectPointer(null);
    setFkSource(null);
    setFkTarget(null);
    resetRelation();
  }, [viewId, readOnly]);
  useEffect(() => {
    contextCallback.current?.({
      viewId,
      selectedObjectId: visibleSelection ? selected : null,
      visibleObjectIds,
      position: selectedNode
        ? {
            x: selectedNode.x + selectedNode.width / 2,
            y: selectedNode.y + selectedNode.height / 2,
          }
        : blankPosition.current?.viewId === viewId
          ? blankPosition.current
          : position(),
    });
  }, [
    viewId,
    selected,
    !!visibleSelection,
    visibleObjectIds,
    selectedNode?.x,
    selectedNode?.y,
    selectedNode?.width,
    selectedNode?.height,
  ]);
  useEffect(() => {
    if (!focusTarget) return;
    finish();
    const destination = domainCanvasTarget(doc, focusTarget.viewId);
    const destinationView = destination.viewId;
    let filter = destination.filter;
    const focusedTable = doc.tables?.find((item) => item.id === focusTarget.objectId);
    if (focusedTable && !matchesDomainFilter(focusedTable, filter))
      filter = {
        domainIds: focusedTable.domainId ? [focusedTable.domainId] : [],
        unassigned: focusedTable.domainId === null,
      };
    setDomainFilter(filter);
    setViewId(destinationView);
    const node = doc.layout.nodes.find(
      (n) => n.viewId === destinationView && n.objectId === focusTarget.objectId,
    );
    setSelected(node ? focusTarget.objectId : null);
    const rect = surface.current?.getBoundingClientRect();
    const next = clampLayoutPatch({
      viewId: destinationView,
      zoom: 1,
      x: (rect?.width ?? 800) / 2 - (node?.x ?? 0) - focusTarget.x,
      y: (rect?.height ?? 600) / 2 - (node?.y ?? 0) - focusTarget.y,
    });
    setLocalViewports((value) => ({ ...value, [next.viewId]: next }));
  }, [focusTarget?.nonce]);
  const filteredRelations = doc.domainRelations.filter((r) =>
    [
      r.name,
      r.description,
      doc.domains.find((d) => d.id === r.sourceDomainId)?.name,
      doc.domains.find((d) => d.id === r.targetDomainId)?.name,
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(relationSearch.toLocaleLowerCase()),
  );
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const active = drag.current;
        if (active?.boxStart) {
          drag.current = null;
          setMarquee(null);
          setMultiSelection([]);
          if (active.captureTarget.hasPointerCapture(active.pointerId))
            active.captureTarget.releasePointerCapture(active.pointerId);
        }
        setConnectSource(null);
        setConnectPointer(null);
        setFkSource(null);
        setFkTarget(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => {
    if (connectSource && !doc.domains.some((d) => d.id === connectSource)) setConnectSource(null);
  }, [doc.domains, connectSource]);
  const query = relationSearch.trim().toLocaleLowerCase();
  const matches = (...values: (string | undefined | null)[]) =>
    !query || values.filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
  const viewTables = (doc.tables ?? []).filter(
    (t) => isVisibleInView(t.scope, viewMode) && nodes.some((n) => n.objectId === t.id),
  );
  const viewRelations = (doc.tableRelations ?? []).filter(
    (r) =>
      isVisibleInView(r.scope, viewMode) &&
      !!r.physical &&
      viewTables.some((t) => t.id === r.sourceTableId) &&
      viewTables.some((t) => t.id === r.targetTableId),
  );
  const tableLabel = (t: Table) => t.physical.name || t.logical.name || tr('이름 없는 테이블');
  const outlineCount = viewId === 'overview' ? doc.domains.length : viewTables.length;
  const selectionKind = selectedTableRelation
    ? tr('테이블 관계')
    : table
      ? tr('테이블')
      : domain
        ? tr('도메인')
        : note
          ? tr('메모')
          : '';
  const selectionName = selectedTableRelation
    ? `${tableLabel(doc.tables!.find((t) => t.id === selectedTableRelation.targetTableId)!)} → ${tableLabel(doc.tables!.find((t) => t.id === selectedTableRelation.sourceTableId)!)}`
    : table
      ? tableLabel(table)
      : domain
        ? domain.name
        : note
          ? note.text.slice(0, 40) || tr('메모')
          : '';
  function pinAt(clientX: number, clientY: number) {
    const rect = surface.current?.getBoundingClientRect();
    onCreatePin?.({
      viewId,
      selectedObjectId: null,
      position: {
        x: (clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
        y: (clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom,
      },
    });
    setMenu(null);
  }
  function arrangeVisibleNodes() {
    if (!layoutPolicy.autoLayout) return;
    const layoutSource =
      viewId === 'overview'
        ? doc
        : {
            ...doc,
            tables: viewTables,
            tableRelations: (doc.tableRelations ?? []).filter((r) =>
              viewRelations.some((visible) => visible.id === r.id),
            ),
          };
    const sized = {
      ...layoutSource,
      layout: {
        ...layoutSource.layout,
        nodes: layoutSource.layout.nodes.map(
          (n) => nodes.find((visible) => visible.id === n.id) ?? n,
        ),
      },
    };
    const arranged = autoLayoutView(sized, viewId);
    change({ ...doc, layout: arranged.layout });
  }
  function change(next: DesignDocument) {
    if (!readOnly) onChange(next);
  }
  function preview(next: DesignDocument) {
    if (!readOnly) {
      live.current = next;
      (onPreviewChange ?? onChange)(next);
    }
  }
  function updateNodeLayout(
    document: DesignDocument,
    id: string,
    patch: Parameters<typeof modelUpdateNodeLayout>[2],
  ) {
    const node = document.layout.nodes.find((n) => n.id === id);
    if (node && (patch.width !== undefined || patch.height !== undefined)) {
      const kind = document.domains.some((d) => d.id === node.objectId)
        ? 'domain'
        : (document.tables ?? []).some((t) => t.id === node.objectId)
          ? 'table'
          : 'note';
      patch = {
        ...patch,
        ...(kind === 'table'
          ? tableCardSize(
              document,
              node.objectId,
              patch.width ?? node.width,
              patch.height ?? node.height,
            )
          : cardSize(kind, patch.width ?? node.width, patch.height ?? node.height)),
      };
    }
    return modelUpdateNodeLayout(document, id, clampLayoutPatch(patch));
  }
  function moveViewport(next: typeof viewport) {
    pendingCamera.current = clampLayoutPatch(next);
    cameraFrame.enqueue(applyCameraFrame);
  }
  function applyCameraFrame() {
    const latest = pendingCamera.current;
    pendingCamera.current = null;
    if (!latest || latest.viewId !== gestureContext.current.viewId) return;
    cameraCurrent.current = latest;
    setLocalViewports((value) => ({ ...value, [latest.viewId]: latest }));
  }
  function navigate(id: string) {
    finish();
    setMenu(null);
    setConnectSource(null);
    setConnectPointer(null);
    setFkSource(null);
    setFkTarget(null);
    const destination = domainCanvasTarget(doc, id);
    if (destination.viewId === TABLES_VIEW_ID) setDomainFilter(destination.filter);
    setViewId(destination.viewId);
    setSelected(null);
  }
  function position() {
    const rect = surface.current?.getBoundingClientRect();
    return clampLayoutPatch({
      x: ((rect?.width ?? 800) / 2 - viewport.x) / viewport.zoom - 120,
      y: ((rect?.height ?? 600) / 2 - viewport.y) / viewport.zoom - 70,
    });
  }
  function newDomain(name = '새 도메인', at?: { x: number; y: number }) {
    if (readOnly) return;
    const id = newId();
    change(addDomain(doc, { id, name, description: '', color: '#8993a3' }, at ?? position()));
    setSelected(id);
    setInspectorOpen(true);
    setPanelTab('properties');
    setDomainName('');
    setMenu(null);
  }
  function newNote() {
    if (noteReadOnly) return;
    const id = newId();
    change(addNote(doc, { id, viewId, text: '업무 설명을 입력하세요.' }, position()));
    pick(id);
  }
  function newTable(name = '', at?: { x: number; y: number }) {
    if (readOnly || creationOwner === undefined) return;
    const id = newId();
    change(
      addTable(
        doc,
        {
          id,
          domainId: creationOwner,
          scope: 'physical',
          logical: { name: '새 테이블', definition: '' },
          physical: { name, schema: 'public', comment: '' },
          customProperties: emptyMetadata(),
        },
        at ?? position(),
        TABLES_VIEW_ID,
      ),
    );
    pick(id);
  }
  function pick(id: string) {
    setSelected(id);
    setInspectorOpen(true);
    setPanelTab('properties');
  }
  function zoom(value: number) {
    const camera = pendingCamera.current ?? cameraCurrent.current;
    const next = Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, value));
    const rect = surface.current?.getBoundingClientRect();
    const cx = (rect?.width ?? 800) / 2,
      cy = (rect?.height ?? 600) / 2;
    moveViewport({
      viewId,
      zoom: next,
      x: cx - ((cx - camera.x) * next) / camera.zoom,
      y: cy - ((cy - camera.y) * next) / camera.zoom,
    });
  }
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (drag.current) {
        event.preventDefault();
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],[role="listbox"],[role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      moveViewport({
        ...wheelCamera(
          pendingCamera.current ?? cameraCurrent.current,
          event,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          rect.height,
        ),
        viewId,
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [doc, readOnly, viewId, viewport.x, viewport.y, viewport.zoom]);
  function begin(e: PointerEvent<HTMLDivElement>, id: string | null, resize = false) {
    if (e.button !== 0 && e.button !== 1) return;
    cameraFrame.flush();
    const camera = cameraCurrent.current;
    if (tool === 'hand' || e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      drag.current = {
        id: null,
        resize: false,
        pending: false,
        captureTarget: e.currentTarget,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: camera.x,
        y: camera.y,
        width: 0,
        height: 0,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const node = nodes.find((n) => n.id === id);
    if (!readOnly && node && connectSource) {
      e.stopPropagation();
      const destination = doc.domains.find((d) => d.id === node.objectId);
      const origin = doc.domains.find((d) => d.id === connectSource);
      if (origin && destination && origin.id !== destination.id) {
        const relation = {
          id: newId(),
          sourceDomainId: origin.id,
          targetDomainId: destination.id,
          name: (origin.name + ' → ' + destination.name).slice(0, 120),
          direction: 'forward' as const,
          description: '',
        };
        change(upsertDomainRelation(doc, relation));
        setConnectSource(null);
        setConnectPointer(null);
        setSelected(destination.id);
        setConnectedOpen(true);
        setInspectorOpen(true);
      }
      return;
    }
    if (
      !readOnly &&
      node &&
      fkSource &&
      !fkTarget &&
      (doc.tables ?? []).some((t) => t.id === node.objectId)
    ) {
      e.stopPropagation();
      setFkTarget(node.objectId);
      return;
    }
    if (node) {
      if (!(selectedObjects.length > 1 && selectedObjects.includes(node.objectId)))
        setSelected(node.objectId);
      if (doc.domains.some((d) => d.id === node.objectId)) {
        setInspectorOpen(true);
        setConnectedOpen(true);
      }
    } else setSelected(null);
    setMenu(null);
    if (
      node &&
      !resize &&
      (e.target as HTMLElement).closest('input,textarea,select,button,[data-inline-edit]')
    ) {
      e.stopPropagation();
      return;
    }
    if (readOnly && id) {
      e.stopPropagation();
      return;
    }
    if (!layoutPolicy.moveNodes && node) {
      e.stopPropagation();
      return;
    }
    if (!node) {
      const rect = surface.current?.getBoundingClientRect();
      blankPosition.current = {
        viewId,
        x: (e.clientX - (rect?.left ?? 0) - camera.x) / camera.zoom,
        y: (e.clientY - (rect?.top ?? 0) - camera.y) / camera.zoom,
      };
      contextCallback.current?.({
        viewId,
        selectedObjectId: null,
        position: blankPosition.current,
      });
      setMarquee(selectionRect(blankPosition.current, blankPosition.current));
      drag.current = {
        id: null,
        resize: false,
        pending: false,
        captureTarget: e.currentTarget,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: camera.x,
        y: camera.y,
        width: 0,
        height: 0,
        boxStart: { x: blankPosition.current.x, y: blankPosition.current.y },
        boxEnd: { x: blankPosition.current.x, y: blankPosition.current.y },
        zoom: camera.zoom,
      };
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      e.stopPropagation();
      return;
    }
    const pending = !!node && !resize && !!(e.target as HTMLElement).closest('.table-inline');
    drag.current = {
      id,
      resize,
      pending,
      captureTarget: e.currentTarget,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: node?.x ?? camera.x,
      y: node?.y ?? camera.y,
      width: node?.width ?? 0,
      height: node?.height ?? 0,
      ...(!resize && node && selectedObjects.includes(node.objectId) && selectedObjects.length > 1
        ? {
            members: nodes
              .filter((n) => selectedObjects.includes(n.objectId))
              .map((n) => ({ id: n.id, x: n.x, y: n.y })),
          }
        : {}),
      zoom: camera.zoom,
    };
    if (!pending) e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (connectSource || (fkSource && !fkTarget)) {
      const rect = surface.current?.getBoundingClientRect();
      setConnectPointer({
        x: (e.clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
        y: (e.clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom,
      });
    }
    const start = drag.current;
    if (!start) return;
    const dx = e.clientX - start.startX,
      dy = e.clientY - start.startY;
    if (e.buttons === 0) {
      finish();
      return;
    }
    if (start.boxStart) {
      start.boxEnd = {
        x: start.boxStart.x + dx / (start.zoom ?? viewport.zoom),
        y: start.boxStart.y + dy / (start.zoom ?? viewport.zoom),
      };
      const rect = selectionRect(start.boxStart, start.boxEnd);
      setMarquee(rect);
      setMultiSelection(intersectingObjects(rect, nodes));
      return;
    }
    if (start.pending) {
      // Preserve the original click target so stationary double-clicks enter editing.
      if (Math.hypot(dx, dy) < 5) return;
      start.pending = false;
      start.captureTarget.setPointerCapture(start.pointerId);
    }
    if (start.id) {
      // Keep only the last absolute delta, but apply it to the freshest document.
      previewFrame.enqueue(() => {
        if (
          drag.current !== start ||
          gestureContext.current.viewId !== viewId ||
          gestureContext.current.readOnly
        )
          return;
        const zoom = start.zoom ?? cameraCurrent.current.zoom;
        const next = start.members
          ? translateSelectedNodes(live.current, start.members, dx / zoom, dy / zoom)
          : updateNodeLayout(
              live.current,
              start.id!,
              start.resize
                ? {
                    width: Math.max(160, start.width + dx / zoom),
                    height: Math.max(110, start.height + dy / zoom),
                  }
                : { x: start.x + dx / zoom, y: start.y + dy / zoom },
            );
        previewLatest.current(next);
      });
    } else moveViewport({ ...cameraCurrent.current, x: start.x + dx, y: start.y + dy });
  }
  function finish() {
    previewFrame.flush();
    cameraFrame.flush();
    const active = drag.current;
    drag.current = null;
    setMarquee(null);
    if (active?.captureTarget.hasPointerCapture(active.pointerId))
      active.captureTarget.releasePointerCapture(active.pointerId);
    if (active?.id && !active.pending) change(live.current);
    if (active?.boxStart && active.boxEnd) {
      const ids = intersectingObjects(selectionRect(active.boxStart, active.boxEnd), nodes);
      if (ids.length === 1) setSelected(ids[0]!);
      else {
        setSelectedState(null);
        setMultiSelection(ids);
      }
    }
  }
  function switchTool(nextTool: CanvasTool) {
    finish();
    setTool(nextTool);
    if (nextTool === 'hand') setSelected(null);
    setConnectSource(null);
    setConnectPointer(null);
    setFkSource(null);
    setFkTarget(null);
  }
  function editRelation(id: string) {
    const relation = doc.domainRelations.find((r) => r.id === id);
    if (!relation) return;
    setInspectorOpen(true);
    setPanelTab('properties');
    setRelationsOpen(true);
    setRelationId(id);
    setRelationNameDraft(null);
    setSource(relation.sourceDomainId);
    setTarget(relation.targetDomainId);
    setRelationName(relation.name);
    setDirection(relation.direction);
    setRelationDescription(relation.description);
    setSelected(null);
  }
  function resetRelation() {
    setRelationNameDraft(null);
    setRelationId('');
    setRelationName('');
    setRelationDescription('');
  }
  function editDomainRelation(patch: DomainRelationPatch) {
    if (readOnly || !relationId) return;
    const next = applyDomainRelationPatch(live.current, relationId, patch);
    if (next !== live.current) change(next);
  }
  function startRelation(sourceId: string, targetId: string) {
    resetRelation();
    setSource(sourceId);
    setTarget(targetId);
    setDirection('forward');
    setSelected(null);
    setMenu(null);
    setInspectorOpen(true);
    setPanelTab('properties');
    setRelationsOpen(true);
    requestAnimationFrame(() =>
      globalThis.document.querySelector<HTMLInputElement>('[data-relation-name-input]')?.focus(),
    );
  }
  const filterNames = domainFilterNames(doc, domainFilter);
  if (domainFilter?.unassigned) filterNames.push(tr('미지정'));
  const filterLabel =
    domainFilter === null ? tr('전체') : filterNames.join(' · ') || tr('선택 없음');
  const currentViewName = fullCanvas
    ? domainFilter === null
      ? tr('전체 테이블')
      : `${tr('전체 테이블')} · ${filterLabel}`
    : tr('도메인 맵');
  const pathTrail = (
    <nav className="editor-path" aria-label={tr('현재 위치')}>
      <span className="path-sep" aria-hidden="true">
        /
      </span>
      <strong className="path-current" title={currentViewName}>
        {currentViewName}
      </strong>
    </nav>
  );
  const toolbar = (
    <div className="canvas-toolbar">
      <div className="actions">
        <div className="toolbar-group toolbar-create" role="group" aria-label={tr('편집 도구')}>
          {viewId === 'overview' ? (
            <Button disabled={readOnly} onClick={() => newDomain()}>
              {tr('＋ 도메인')}
            </Button>
          ) : (
            <Button disabled={readOnly || creationOwner === undefined} onClick={() => newTable()}>
              {tr('＋ 테이블')}
            </Button>
          )}
          <Button disabled={noteReadOnly} onClick={newNote}>
            {tr('＋ 메모')}
          </Button>
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="toolbar-group" role="group" aria-label={tr('보기와 내보내기')}>
          <Button aria-pressed={fullCanvas} onClick={() => navigate(TABLES_VIEW_ID)}>
            {tr('전체 테이블')}
          </Button>
          <Button aria-pressed={viewId === 'overview'} onClick={() => navigate('overview')}>
            {tr('도메인 맵')}
          </Button>
          {fullCanvas && (
            <DialogTrigger
              isOpen={viewPickerOpen}
              onOpenChange={(open) => {
                setViewPickerOpen(open);
                if (open) {
                  setSelectedDomains(domainFilter?.domainIds ?? doc.domains.map((d) => d.id));
                  setIncludeUnassigned(domainFilter?.unassigned ?? true);
                  setSelectAllDomains(domainFilter === null);
                }
              }}
            >
              <Button
                className={domainFilter ? 'domain-view-trigger is-active' : 'domain-view-trigger'}
                title={filterLabel}
              >
                {tr('도메인 필터')}
              </Button>
              <UntitledPopover
                className="domain-view-popover"
                placement="bottom start"
                shouldFlip={false}
                offset={8}
              >
                <Dialog aria-label={tr('도메인 필터')} className="combined-view-picker">
                  <strong>{tr('도메인 필터')}</strong>
                  <p className="panel-note">
                    {tr(
                      '필터는 내 화면에만 적용됩니다. 테이블 위치와 편집 내용은 모두 공유됩니다.',
                    )}
                  </p>
                  <div className="combined-domain-options">
                    <label className="combined-select-all">
                      <Checkbox
                        aria-label={tr('전체 테이블 표시')}
                        checked={selectAllDomains}
                        onChange={(event) => {
                          setSelectAllDomains(event.target.checked);
                          setSelectedDomains(
                            event.target.checked ? doc.domains.map((d) => d.id) : [],
                          );
                          setIncludeUnassigned(event.target.checked);
                        }}
                      />
                      {tr('전체')}
                    </label>
                    {doc.domains.map((d) => (
                      <label key={d.id}>
                        <Checkbox
                          aria-label={d.name}
                          checked={selectedDomainSet.has(d.id)}
                          onChange={(e) => {
                            setSelectAllDomains(false);
                            setSelectedDomains((value) =>
                              e.target.checked
                                ? [...value, d.id]
                                : value.filter((id) => id !== d.id),
                            );
                          }}
                        />
                        <span style={{ color: d.color ?? '#8993a3' }}>●</span>
                        {d.name}
                      </label>
                    ))}
                    <label>
                      <Checkbox
                        aria-label={tr('미지정')}
                        checked={includeUnassigned}
                        onChange={(e) => {
                          setSelectAllDomains(false);
                          setIncludeUnassigned(e.target.checked);
                        }}
                      />
                      {tr('미지정')}
                    </label>
                  </div>
                  <div className="actions">
                    <Button
                      onClick={() => {
                        finish();
                        setDomainFilter(
                          selectAllDomains
                            ? null
                            : { domainIds: selectedDomains, unassigned: includeUnassigned },
                        );
                        setMenu(null);
                        setConnectSource(null);
                        setConnectPointer(null);
                        setFkSource(null);
                        setFkTarget(null);
                        setViewPickerOpen(false);
                      }}
                    >
                      {tr('적용')}
                    </Button>
                    <Button onClick={() => setViewPickerOpen(false)}>{tr('닫기')}</Button>
                  </div>
                </Dialog>
              </UntitledPopover>
            </DialogTrigger>
          )}
          {fullCanvas && domainFilter !== null && (
            <Button onClick={() => navigate(TABLES_VIEW_ID)}>{tr('필터 해제')}</Button>
          )}
          <Button onClick={() => setEnumOpen(true)}>ENUM</Button>
          <Dropdown
            label={tr('공유')}
            trigger={
              <IconButton
                aria-label={tr('공유')}
                title={exporting ? tr('내보내는 중…') : tr('공유')}
                aria-busy={exporting}
                disabled={exporting}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
                </svg>
              </IconButton>
            }
            items={[
              {
                id: 'project-export',
                label: tr('프로젝트 내보내기'),
                disabled: exporting || !onExportProject,
                onAction: async () => {
                  setExporting(true);
                  setExportError('');
                  try {
                    await onExportProject?.();
                  } catch (cause) {
                    setExportError(message(cause));
                  } finally {
                    setExporting(false);
                  }
                },
              },
              {
                id: 'ddl-export',
                label: tr('DDL 내보내기'),
                disabled: exporting || !onExportDDL,
                onAction: async () => {
                  setExporting(true);
                  setExportError('');
                  try {
                    await onExportDDL?.();
                  } catch (cause) {
                    setExportError(message(cause));
                  } finally {
                    setExporting(false);
                  }
                },
              },
              {
                id: 'png-export',
                label: tr('고화질 PNG'),
                disabled: exporting || !nodes.length,
                onAction: async () => {
                  const world = surface.current?.querySelector<HTMLElement>('.canvas-world');
                  if (!world) return;
                  setExporting(true);
                  setExportError('');
                  try {
                    await exportCanvasPng(world, nodes, currentViewName);
                  } catch {
                    setExportError(tr('이미지를 만들지 못했습니다. 다시 시도해 주세요.'));
                  } finally {
                    setExporting(false);
                  }
                },
              },
            ]}
          />
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div
          className="toolbar-group panel-toggles"
          role="group"
          aria-label={tr('협업과 속성 패널')}
        >
          {panelToggle}
          <IconButton
            className="inspector-toggle panel-toggle"
            aria-label={inspectorOpen ? tr('속성 패널 숨기기') : tr('속성 패널 열기')}
            title={inspectorOpen ? tr('속성 패널 숨기기') : tr('속성 패널 열기')}
            aria-pressed={inspectorOpen}
            aria-expanded={inspectorOpen}
            aria-controls="canvas-inspector"
            onClick={() => setInspectorOpen((value) => !value)}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="14" height="12" rx="3" />
              <path className="sidebar-icon-divider" d="M12 4.5v11" />
              <path className="sidebar-icon-fill" d="M13 5h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1z" />
            </svg>
          </IconButton>
        </div>
      </div>
    </div>
  );
  return (
    <div
      ref={workspaceRef}
      onCopy={(event) => {
        if (!clipboardTarget(event.target) || !selectedTableIds.length) return;
        event.preventDefault();
        event.stopPropagation();
        copySelection(false, event.clipboardData);
      }}
      onCut={(event) => {
        if (!clipboardTarget(event.target) || !selectedTableIds.length || readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        copySelection(true, event.clipboardData);
      }}
      onPaste={(event) => {
        if (!clipboardTarget(event.target) || readOnly || creationOwner === undefined) return;
        const text = event.clipboardData.getData('text/plain');
        if (!parseTableClipboard(text)) return;
        event.preventDefault();
        event.stopPropagation();
        pasteSelection(text);
      }}
      onKeyDown={async (event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.shiftKey &&
          !event.repeat &&
          !event.nativeEvent.isComposing &&
          event.key.toLowerCase() === 'v' &&
          !readOnly &&
          creationOwner !== undefined &&
          clipboardTarget(event.target) &&
          localTablePasteFallback()
        ) {
          event.preventDefault();
          event.stopPropagation();
          pasteSelection(localTablePasteFallback());
          return;
        }
        if (
          event.key !== 'Delete' ||
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          readOnly ||
          deletionPending.current ||
          tool === 'hand' ||
          (!selectedNode && !selectedObjects.length) ||
          (!domain && !table && !note && !selectedObjects.length) ||
          !(event.target instanceof Element) ||
          !event.currentTarget.contains(event.target) ||
          !!event.target.closest('.canvas-toolbar') ||
          event.target.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"],dialog',
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const ids = selectedObjects.length ? selectedObjects : [selectedNode!.objectId];
        const kind = domain ? 'domain' : note ? 'note' : 'table';
        deletionPending.current = true;
        try {
          if (
            !(await confirm({
              title:
                ids.length > 1
                  ? tr('선택한 객체 {count}개 삭제', { count: ids.length })
                  : kind === 'domain'
                    ? tr('도메인 삭제')
                    : kind === 'note'
                      ? tr('메모 삭제')
                      : tr('테이블 삭제'),
              description:
                ids.length > 1
                  ? tr('선택한 객체와 소유 데이터·연결 관계를 삭제할까요?')
                  : kind === 'domain'
                    ? tr('도메인과 연결된 업무 관계·내부 테이블·텍스트를 삭제할까요?')
                    : kind === 'note'
                      ? tr('이 메모를 삭제할까요?')
                      : tr('테이블과 소유 컬럼, 키, 관계 및 모든 외부 참조를 삭제할까요?'),
              confirmLabel: tr('삭제'),
              destructive: true,
            }))
          )
            return;
          const latest = latestDeletion.current;
          if (latest.readOnly) return;
          let next = latest.doc;
          for (const id of ids) {
            if (next.domains.some((item) => item.id === id)) next = removeDomain(next, id);
            else if (next.tables?.some((item) => item.id === id)) next = removeTable(next, id);
            else if (next.notes.some((item) => item.id === id)) next = removeNote(next, id);
          }
          if (next !== latest.doc) latest.onChange(next);
          setSelected(null);
        } finally {
          deletionPending.current = false;
        }
      }}
      style={{ '--inspector-width': `${panelWidth}px` } as CSSProperties}
      className={`workspace ${inspectorOpen ? '' : 'inspector-hidden'} ${resizingInspector ? 'inspector-resizing' : ''} ${stackedInspector ? 'inspector-stacked' : ''}`}
    >
      <div className="canvas-column" key={viewId}>
        {pathHost ? createPortal(pathTrail, pathHost) : pathTrail}
        {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
        {exportError && <p role="alert">{exportError}</p>}
        {clipboardError && <p role="alert">{clipboardError}</p>}

        <div
          ref={surface}
          tabIndex={0}
          data-tool={tool}
          onPointerDownCapture={(event) => {
            if (
              (tool === 'hand' || event.button === 1) &&
              !(event.target as Element).closest('.zoom-controls')
            )
              begin(event, null);
          }}
          onDoubleClickCapture={(event) => {
            if (tool === 'hand') {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onAuxClick={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
          className={`canvas-surface ${connectSource || fkSource ? 'connection-target-mode' : ''}`}
          onContextMenu={(e) => {
            if (
              (e.target as HTMLElement).closest(
                '.canvas-node, .relation, .table-relation-line, .zoom-controls',
              )
            )
              return;
            e.preventDefault();
            if (readOnly && !onCreatePin) return;
            menuPointer.current = { x: e.clientX, y: e.clientY };
            const rect = e.currentTarget.getBoundingClientRect();
            blankPosition.current = {
              viewId,
              x: (e.clientX - rect.left - viewport.x) / viewport.zoom,
              y: (e.clientY - rect.top - viewport.y) / viewport.zoom,
            };
            setSelected(null);
            setMenu({
              source: null,
              x: Math.max(8, Math.min(e.clientX, window.innerWidth - 290)),
              y: Math.max(8, Math.min(e.clientY, window.innerHeight - 220)),
            });
          }}
          aria-label={
            viewId === 'overview'
              ? tr('도메인 맵 캔버스')
              : fullCanvas
                ? tr('전체 테이블 캔버스')
                : tr('{name} 내부 캔버스', { name: currentViewName })
          }
          onPointerDown={(e) => begin(e, null)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onPointerLeave={() => {
            if (drag.current?.pending) finish();
          }}
          style={{
            backgroundSize: `${40 * viewport.zoom}px ${40 * viewport.zoom}px`,
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            backgroundImage: `radial-gradient(circle, var(--erd-grid-dot-color) ${1.05 * viewport.zoom}px, transparent ${1.15 * viewport.zoom}px)`,
          }}
        >
          <div
            className="canvas-world"
            inert={tool === 'hand'}
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            }}
          >
            {viewId === 'overview' && (
              <svg className="relations" aria-label={tr('도메인 관계')}>
                <defs>
                  <marker
                    id="arrow-end"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {doc.domainRelations.map((r) => {
                  const route = domainRoutes.get(r.id);
                  if (!route) return null;
                  return (
                    <g
                      key={r.id}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => editRelation(r.id)}
                      className={`relation ${relationId === r.id ? 'selected' : ''}`}
                    >
                      <path
                        d={route.path}
                        markerEnd="url(#arrow-end)"
                        markerStart={r.direction === 'both' ? 'url(#arrow-end)' : undefined}
                      />
                      {route.labelAnchor && (
                        <path
                          className="domain-label-leader"
                          d={`M ${route.labelAnchor.x} ${route.labelAnchor.y} L ${route.label.x} ${route.label.y + 4}`}
                        />
                      )}
                      <text x={route.label.x} y={route.label.y} textAnchor="middle">
                        {r.name}
                      </text>
                    </g>
                  );
                })}
                {connectSource &&
                  connectPointer &&
                  (() => {
                    const origin = nodes.find((n) => n.objectId === connectSource);
                    return origin ? (
                      <path
                        className="domain-connection-preview"
                        d={`M ${origin.x + origin.width / 2} ${origin.y + origin.height / 2} L ${connectPointer.x} ${connectPointer.y}`}
                        markerEnd="url(#arrow-end)"
                      />
                    ) : null;
                  })()}
              </svg>
            )}
            {viewId !== 'overview' && (
              <>
                <svg
                  className="relations"
                  aria-label={tr('테이블 관계')}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <TableRelationsSvg
                    hideControls
                    selectedId={selected}
                    document={doc}
                    visibleNodeIds={visibleNodeIds}
                    sharedRelations={tableRelations}
                    viewId={viewId}
                    viewMode={viewMode}
                    onChange={change}
                    onPreviewChange={preview}
                    readOnly={readOnly}
                    layoutReadOnly={!layoutPolicy.editRoutes}
                    onSelect={(id: string) => {
                      setSelected(id);
                      setInspectorOpen(true);
                      setPanelTab('properties');
                    }}
                  />
                </svg>
                <svg
                  className="relations table-route-overlay"
                  data-export-hidden="true"
                  aria-label={tr('관계 선 조절')}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <TableRelationsSvg
                    controlsOnly
                    selectedId={selected}
                    document={doc}
                    visibleNodeIds={visibleNodeIds}
                    sharedRelations={tableRelations}
                    viewId={viewId}
                    viewMode={viewMode}
                    onChange={change}
                    onPreviewChange={preview}
                    readOnly={readOnly}
                    layoutReadOnly={!layoutPolicy.editRoutes}
                    onSelect={(id: string) => {
                      setSelected(id);
                      setInspectorOpen(true);
                      setPanelTab('properties');
                    }}
                  />
                </svg>
              </>
            )}
            {fkSource && !fkTarget && connectPointer && (
              <svg className="relations connection-preview-layer" aria-hidden="true">
                {(() => {
                  const column = doc.columns?.find((c) => c.id === fkSource);
                  const origin = nodes.find((n) => n.objectId === column?.tableId);
                  if (!origin) return null;
                  const x = origin.x + origin.width,
                    y = origin.y + origin.height / 2,
                    middle = (x + connectPointer.x) / 2;
                  return (
                    <path
                      className="domain-connection-preview"
                      d={`M ${x} ${y} H ${middle} V ${connectPointer.y} H ${connectPointer.x}`}
                    />
                  );
                })()}
              </svg>
            )}
            {nodes.map((node) => {
              const d = doc.domains.find((v) => v.id === node.objectId),
                n = doc.notes.find((v) => v.id === node.objectId);
              const t = (doc.tables ?? []).find((v) => v.id === node.objectId);
              if (!d && !n && !t) return null;
              return (
                <div
                  key={node.id}
                  className={`canvas-node ${d ? 'domain-node' : t ? 'table-node' : 'note-node'} ${selected === node.objectId || selectedObjects.includes(node.objectId) ? 'selected' : ''} ${d && connectSource === d.id ? 'connection-source' : ''}`}
                  style={
                    {
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      height: node.height,
                      ...(d ? { '--domain-color': d.color ?? '#8993a3' } : {}),
                      ...(n ? { '--note-color': n.color ?? '#fff3c4' } : {}),
                    } as CSSProperties
                  }
                  onPointerDown={(e) => begin(e, node.id)}
                  onContextMenuCapture={(e) => {
                    if (
                      !t ||
                      selectedObjects.length < 2 ||
                      !selectedObjects.includes(t.id) ||
                      (e.target as Element).closest('input,textarea,[contenteditable="true"]')
                    )
                      return;
                    e.preventDefault();
                    e.stopPropagation();
                    menuPointer.current = { x: e.clientX, y: e.clientY };
                    e.currentTarget.focus();
                    setMenu({ source: t.id, x: e.clientX, y: e.clientY });
                  }}
                  onContextMenu={(e) => {
                    if ((e.target as Element).closest('input,textarea,[contenteditable="true"]'))
                      return;
                    e.preventDefault();
                    if ((!d && !t) || (d && readOnly && !onCreatePin)) return;
                    menuPointer.current = { x: e.clientX, y: e.clientY };
                    e.stopPropagation();
                    e.currentTarget.focus();
                    if (!selectedObjects.includes(node.objectId)) setSelected(node.objectId);
                    setMenu({
                      source: node.objectId,
                      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 290)),
                      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 320)),
                    });
                  }}
                  onDoubleClick={() => d && navigate(d.id)}
                  tabIndex={0}
                  role="group"
                  aria-label={d?.name ?? (t ? tableLabel(t) : tr('메모'))}
                  onFocus={(e) => {
                    if (e.target === e.currentTarget && !selectedObjects.includes(node.objectId))
                      setSelected(node.objectId);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' && d) {
                      navigate(d.id);
                      return;
                    }
                    if ((d || t) && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenu({
                        source: node.objectId,
                        x: Math.max(8, Math.min(rect.left, window.innerWidth - 290)),
                        y: Math.max(8, Math.min(rect.top + 40, window.innerHeight - 320)),
                      });
                      return;
                    }
                    if (!layoutPolicy.moveNodes) return;
                    const delta = e.shiftKey ? 10 : 1;
                    const offsets: Record<string, [number, number]> = {
                      ArrowLeft: [-delta, 0],
                      ArrowRight: [delta, 0],
                      ArrowUp: [0, -delta],
                      ArrowDown: [0, delta],
                    };
                    const offset = offsets[e.key];
                    if (offset) {
                      e.preventDefault();
                      if (selectedObjects.length > 1 && selectedObjects.includes(node.objectId)) {
                        change(
                          translateSelectedNodes(
                            doc,
                            nodes.filter((n) => selectedObjects.includes(n.objectId)),
                            offset[0]!,
                            offset[1]!,
                          ),
                        );
                        return;
                      }
                      change(
                        updateNodeLayout(doc, node.id, {
                          x: node.x + offset[0],
                          y: node.y + offset[1],
                        }),
                      );
                    }
                  }}
                >
                  {d ? (
                    <>
                      <span className="node-overline">DOMAIN</span>
                      <h2>{d.name}</h2>
                      <DomainDescription
                        value={d.description}
                        name={d.name}
                        readOnly={readOnly}
                        onCommit={(description) =>
                          change(updateDomain(live.current, d.id, { description }))
                        }
                      />
                      <Button
                        className="enter-domain"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => navigate(d.id)}
                        aria-label={tr('{name} 도메인 열기', { name: d.name })}
                      >
                        {tr('도메인 열기 ↗')}
                      </Button>
                    </>
                  ) : t ? (
                    <TableNodeContent
                      databaseKind={databaseKind}
                      onRequestNativeUpgrade={onRequestNativeUpgrade}
                      {...(onCreatePin
                        ? {
                            onCreatePin: (point: { clientX: number; clientY: number }) =>
                              pinAt(point.clientX, point.clientY),
                          }
                        : {})}
                      document={doc}
                      tableId={t.id}
                      viewMode={viewMode}
                      viewId={viewId}
                      onChange={change}
                      readOnly={readOnly}
                      onStartForeignKey={(columnId) => {
                        setFkSource(columnId);
                        setFkTarget(null);
                        setMenu(null);
                      }}
                    />
                  ) : (
                    <DomainDescription
                      memo
                      name={tr('메모')}
                      value={n?.text ?? ''}
                      readOnly={noteReadOnly}
                      onCommit={(text) => n && change(updateNote(doc, n.id, text))}
                    />
                  )}
                  {layoutPolicy.resizeNodes && (
                    <div
                      className="resize-handle"
                      title={tr('크기 조절')}
                      onPointerDown={(e) => begin(e, node.id, true)}
                    />
                  )}
                </div>
              );
            })}
            {pins}
            {marquee && (
              <div
                className="canvas-selection-box"
                data-export-hidden
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.width,
                  height: marquee.height,
                  borderWidth: 1 / viewport.zoom,
                }}
              />
            )}
          </div>
          {!nodes.length && (
            <div className="canvas-empty">
              <span className="empty-symbol" aria-hidden="true">
                {viewId === 'overview' ? '◇' : '▦'}
              </span>
              <h2>
                {viewId === 'overview'
                  ? tr('큰 그림부터 시작하세요')
                  : fullCanvas
                    ? domainFilter
                      ? tr('필터에 해당하는 테이블이 없습니다')
                      : tr('테이블부터 시작하세요')
                    : tr('이 도메인의 구조를 준비하세요')}
              </h2>
              <p>
                {viewId === 'overview'
                  ? tr('도메인을 만들고 업무의 흐름을 연결해 보세요.')
                  : tr('테이블을 추가하고 컬럼과 관계를 설계하세요.')}
              </p>

              {viewId === 'overview' && (
                <Button
                  variant="primary"
                  className="primary"
                  disabled={readOnly}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => newDomain()}
                >
                  {tr('첫 도메인 만들기')}
                </Button>
              )}
              {fullCanvas && (
                <Button
                  variant="primary"
                  disabled={readOnly}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => newTable()}
                >
                  {tr('첫 테이블 만들기')}
                </Button>
              )}
            </div>
          )}
          <div className="canvas-hint" role={connectSource || fkSource ? 'status' : undefined}>
            {connectSource
              ? tr('연결할 도메인을 클릭하세요 · Escape 취소')
              : fkSource
                ? tr('PK를 받을 테이블을 클릭하세요 · FK 컬럼 자동 추가 · Escape 취소')
                : selectedObjects.length > 1
                  ? tr('{count}개 선택됨 · 함께 드래그하여 이동', { count: selectedObjects.length })
                  : tool === 'hand'
                    ? tr('손 도구 · 드래그로 화면 이동')
                    : tr('커서 도구 · 빈 공간 드래그로 여러 객체 선택')}
          </div>
          <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
            <div className="canvas-tool-picker" role="group" aria-label={tr('캔버스 도구')}>
              <IconButton
                aria-label={tr('커서 도구')}
                title={`${tr('커서 · 드래그로 여러 객체 선택')} (V)`}
                tooltip={`${tr('커서 · 드래그로 여러 객체 선택')} (V)`}
                aria-keyshortcuts="V"
                aria-pressed={tool === 'select'}
                onClick={() => switchTool('select')}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="m4 2 12 8-6 1-3 6-3-15Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                aria-label={tr('손 도구')}
                title={`${tr('손 · 화면 이동만')} (H)`}
                tooltip={`${tr('손 · 화면 이동만')} (H)`}
                aria-keyshortcuts="H"
                aria-pressed={tool === 'hand'}
                onClick={() => switchTool('hand')}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M6 10V5a1.3 1.3 0 0 1 2.6 0v4-6a1.3 1.3 0 0 1 2.6 0v6-5a1.3 1.3 0 0 1 2.6 0v5-3a1.3 1.3 0 0 1 2.6 0v6c0 4-2 6-5.5 6H9c-2 0-3-1-4-3L2 11c-1-2 1-3 2-1l2 2"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <IconButton
              aria-label={tr('축소')}
              onClick={() => zoom((pendingCamera.current ?? cameraCurrent.current).zoom - 0.1)}
            >
              −
            </IconButton>
            <Button onClick={() => zoom(1)} aria-label={tr('배율 100%로 초기화')}>
              {Math.round(viewport.zoom * 100)}%
            </Button>
            <IconButton
              aria-label={tr('확대')}
              onClick={() => zoom((pendingCamera.current ?? cameraCurrent.current).zoom + 0.1)}
            >
              ＋
            </IconButton>
          </div>
        </div>
      </div>
      {fkSource && fkTarget && (
        <ForeignKeyDialog
          document={doc}
          sourceColumnId={fkSource}
          targetTableId={fkTarget}
          onChange={change}
          onClose={() => {
            setFkSource(null);
            setFkTarget(null);
          }}
        />
      )}
      <ContextMenu
        position={menu ? { x: menu.x, y: menu.y } : null}
        label={
          tableMenu ? tr('테이블 메뉴') : menu?.source ? tr('도메인 관계 설정') : tr('캔버스 메뉴')
        }
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                ...(tableMenu
                  ? [
                      {
                        id: 'cut-tables',
                        label: tr('오려두기'),
                        disabled: readOnly || !selectedTableIds.length,
                        onAction: () => copySelection(true),
                      },
                      {
                        id: 'copy-tables',
                        label: tr('복사하기'),
                        disabled: !selectedTableIds.length,
                        onAction: () => copySelection(false),
                      },
                    ]
                  : []),
                ...(!readOnly && !menu.source && viewId !== 'overview'
                  ? [
                      {
                        id: 'paste-tables',
                        label: tr('붙여넣기'),
                        disabled: creationOwner === undefined,
                        onAction: () => void pasteFromMenu(),
                      },
                    ]
                  : []),
                ...(onCreatePin
                  ? [
                      {
                        id: 'create-pin',
                        label: tr('이 위치에 핀 남기기'),
                        onAction: () => pinAt(menuPointer.current.x, menuPointer.current.y),
                      },
                    ]
                  : []),
                ...(!readOnly && !tableMenu
                  ? menu.source
                    ? [
                        {
                          id: 'panel-relation',
                          label: tr('새 도메인 관계'),
                          onAction: () => startRelation(menu.source!, ''),
                        },
                        {
                          id: 'direct-relation',
                          label: tr('도메인 직접 연결'),
                          disabled: doc.domains.length < 2,
                          onAction: () => {
                            setConnectSource(menu.source);
                            setConnectPointer(null);
                            setMenu(null);
                          },
                        },
                      ]
                    : [
                        ...(viewId === 'overview'
                          ? [
                              {
                                id: 'new-domain',
                                label: tr('새 도메인 생성'),
                                onAction: () =>
                                  newDomain(
                                    '새 도메인',
                                    blankPosition.current?.viewId === viewId
                                      ? blankPosition.current
                                      : undefined,
                                  ),
                              },
                              {
                                id: 'new-relation',
                                label: tr('새 도메인 관계'),
                                onAction: () => startRelation('', ''),
                              },
                            ]
                          : [
                              {
                                id: 'new-table',
                                label: tr('새 테이블 생성'),
                                disabled: creationOwner === undefined,
                                onAction: () =>
                                  newTable(
                                    '',
                                    blankPosition.current?.viewId === viewId
                                      ? clampLayoutPatch(blankPosition.current)
                                      : undefined,
                                  ),
                              },
                            ]),
                        {
                          id: 'auto-layout',
                          label: tr('자동 배치'),
                          disabled: !nodes.length || !layoutPolicy.autoLayout,
                          onAction: () => {
                            arrangeVisibleNodes();
                            setMenu(null);
                          },
                        },
                      ]
                  : []),
              ]
            : []
        }
      />
      {enumOpen && (
        <EnumDialog
          databaseKind={databaseKind}
          onRequestNativeUpgrade={onRequestNativeUpgrade}
          document={doc}
          onChange={change}
          readOnly={readOnly}
          onClose={() => setEnumOpen(false)}
        />
      )}
      <div className="inspector-shell" inert={!inspectorOpen} aria-hidden={!inspectorOpen}>
        <div
          className="inspector-resizer"
          role="separator"
          aria-label={tr('속성 패널 너비 조절')}
          aria-orientation="vertical"
          aria-valuemin={panelBounds.min}
          aria-valuemax={panelBounds.max}
          aria-valuenow={Math.round(panelWidth)}
          tabIndex={inspectorOpen && !stackedInspector ? 0 : -1}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            inspectorDrag.current = { x: e.clientX, width: panelWidth };
            setResizingInspector(true);
          }}
          onPointerMove={(e) => {
            const current = inspectorDrag.current;
            if (current)
              setInspectorWidth(
                clampInspectorWidth(current.width + current.x - e.clientX, workspaceWidth),
              );
          }}
          onPointerUp={(e) => {
            inspectorDrag.current = null;
            setResizingInspector(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            inspectorDrag.current = null;
            setResizingInspector(false);
          }}
          onLostPointerCapture={() => {
            inspectorDrag.current = null;
            setResizingInspector(false);
          }}
          onKeyDown={(e) => {
            const next =
              e.key === 'Home'
                ? panelBounds.min
                : e.key === 'End'
                  ? panelBounds.max
                  : e.key === 'ArrowLeft'
                    ? panelWidth + (e.shiftKey ? 40 : 10)
                    : e.key === 'ArrowRight'
                      ? panelWidth - (e.shiftKey ? 40 : 10)
                      : null;
            if (next !== null) {
              e.preventDefault();
              setInspectorWidth(clampInspectorWidth(next, workspaceWidth));
            }
          }}
        />
        <aside id="canvas-inspector" className="inspector" data-panel-tab={panelTab}>
          <div className="inspector-topbar">
            <div className="inspector-place">
              <span>{viewId === 'overview' || fullCanvas ? 'VIEW' : 'DOMAIN'}</span>
              <strong title={currentViewName}>{currentViewName}</strong>
            </div>
            {selectionName && (
              <div className="inspector-selection">
                <span className="selection-kind">{selectionKind}</span>
                <strong title={selectionName}>{selectionName}</strong>
                <IconButton aria-label={tr('선택 해제')} onClick={() => setSelected(null)}>
                  ×
                </IconButton>
              </div>
            )}
            <div className="inspector-tabs" role="group" aria-label={tr('패널 보기 전환')}>
              <TabButton
                selected={panelTab === 'properties'}
                onClick={() => setPanelTab('properties')}
              >
                {tr('속성')}
              </TabButton>
              <TabButton selected={panelTab === 'outline'} onClick={() => setPanelTab('outline')}>
                {tr('목록 ')}
                <span className="panel-count">{outlineCount}</span>
              </TabButton>
            </div>
          </div>
          <div className="inspector-body">
            {panelTab === 'outline' ? (
              <>
                <div className="panel-search">
                  <Input
                    aria-label={tr('현재 화면 검색')}
                    placeholder={
                      viewId === 'overview' ? tr('도메인·관계 검색') : tr('테이블·관계 검색')
                    }
                    value={relationSearch}
                    onChange={(e) => setRelationSearch(e.target.value)}
                  />
                </div>
                {viewId === 'overview' ? (
                  <>
                    <PanelSection title={tr('도메인')} count={doc.domains.length} defaultOpen>
                      <PanelList empty={tr('표시할 도메인이 없습니다.')}>
                        {doc.domains
                          .filter((d) => matches(d.name, d.description))
                          .map((d) => (
                            <PanelRow
                              key={d.id}
                              accent={d.color ?? '#8993a3'}
                              active={selected === d.id}
                              title={d.name}
                              meta={tr('관계 {count}개', {
                                count: connectedRelations(doc.domainRelations, d.id).length,
                              })}
                              onSelect={() => pick(d.id)}
                              action={<Button onClick={() => navigate(d.id)}>{tr('열기')}</Button>}
                            />
                          ))}
                      </PanelList>
                    </PanelSection>
                    <PanelSection
                      title={tr('도메인 관계')}
                      count={filteredRelations.length}
                      defaultOpen
                    >
                      <PanelList empty={tr('표시할 관계가 없습니다.')}>
                        {filteredRelations.map((r) => (
                          <PanelRow
                            key={r.id}
                            active={relationId === r.id}
                            title={r.name}
                            meta={
                              (doc.domains.find((d) => d.id === r.sourceDomainId)?.name ?? '') +
                              (r.direction === 'both' ? ' ↔ ' : ' → ') +
                              (doc.domains.find((d) => d.id === r.targetDomainId)?.name ?? '')
                            }
                            onSelect={() => editRelation(r.id)}
                          />
                        ))}
                      </PanelList>
                    </PanelSection>
                  </>
                ) : (
                  <>
                    <PanelSection
                      title={tr('이 화면의 테이블')}
                      count={viewTables.length}
                      defaultOpen
                    >
                      <PanelList
                        empty={tr('이 화면에 테이블이 없습니다. 툴바의 ＋ 테이블로 추가하세요.')}
                      >
                        {viewTables
                          .filter((t) => matches(t.physical.name, t.logical.name))
                          .map((t) => (
                            <PanelRow
                              key={t.id}
                              active={selected === t.id}
                              title={tableLabel(t)}
                              meta={tr('컬럼 {count}개', {
                                count: (doc.columns ?? []).filter(
                                  (c) => c.tableId === t.id && isVisibleInView(c.scope, viewMode),
                                ).length,
                              })}
                              badge={
                                fullCanvas
                                  ? (doc.domains.find((domain) => domain.id === t.domainId)?.name ??
                                    tr('미지정'))
                                  : t.domainId === viewId
                                    ? undefined
                                    : tr('참조')
                              }
                              onSelect={() => pick(t.id)}
                            />
                          ))}
                      </PanelList>
                    </PanelSection>
                    <PanelSection title={tr('테이블 관계')} count={viewRelations.length}>
                      <PanelList empty={tr('이 화면에 표시할 테이블 관계가 없습니다.')}>
                        {viewRelations
                          .filter((r) => matches(r.logical.name, r.physical?.name))
                          .map((r) => (
                            <PanelRow
                              key={r.id}
                              title={
                                ((doc.tables ?? []).find((t) => t.id === r.targetTableId)?.physical
                                  .name || '?') +
                                ' (PK) → ' +
                                ((doc.tables ?? []).find((t) => t.id === r.sourceTableId)?.physical
                                  .name || '?') +
                                ' (FK)'
                              }
                              meta={r.physical?.name || 'FK'}
                              badge={r.physical ? 'FK' : undefined}
                              onSelect={() => {
                                setSelected(r.id);
                                setInspectorOpen(true);
                                setPanelTab('properties');
                              }}
                            />
                          ))}
                      </PanelList>
                    </PanelSection>
                  </>
                )}
              </>
            ) : selectedTableRelation ? (
              <section className="table-inspector">
                <fieldset disabled={readOnly}>
                  <RelationEditor
                    defaultOpen
                    document={doc}
                    item={selectedTableRelation}
                    onChange={(next) => change(upsertTableRelation(doc, next))}
                    onDelete={() => {
                      change(removeTableRelation(doc, selectedTableRelation.id));
                      setSelected(null);
                    }}
                  />
                </fieldset>
              </section>
            ) : table ? (
              <>
                <TableInspector
                  databaseKind={databaseKind}
                  onRequestNativeUpgrade={onRequestNativeUpgrade}
                  key={table.id}
                  document={doc}
                  tableId={table.id}
                  viewId={viewId}
                  onChange={change}
                  readOnly={readOnly}
                  onStartForeignKey={(columnId) => {
                    setFkSource(columnId);
                    setFkTarget(null);
                  }}
                />
              </>
            ) : selectedNode && (domain || note) ? (
              <>
                <div className="inspector-fields">
                  {domain ? (
                    <>
                      <label>
                        {tr('도메인 이름')}
                        <Input
                          value={domain.name}
                          maxLength={120}
                          disabled={readOnly}
                          onChange={(e) =>
                            change(updateDomain(doc, domain.id, { name: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        {tr('업무 설명')}
                        <Textarea
                          maxLength={10000}
                          value={domain.description}
                          disabled={readOnly}
                          onChange={(e) =>
                            change(updateDomain(doc, domain.id, { description: e.target.value }))
                          }
                        />
                      </label>
                      <DomainColorPicker
                        value={domain.color ?? '#8993a3'}
                        disabled={readOnly}
                        onChange={(color) => change(updateDomain(doc, domain.id, { color }))}
                      />
                      <div className="panel-actions">
                        <Button onClick={() => navigate(domain.id)}>{tr('도메인 열기 →')}</Button>
                        <Button disabled={readOnly} onClick={() => startRelation(domain.id, '')}>
                          {tr('＋ 관계')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <DomainColorPicker
                        label={tr('메모 색상')}
                        value={note?.color ?? '#fff3c4'}
                        disabled={noteReadOnly}
                        onChange={(color) => note && change(updateNote(doc, note.id, { color }))}
                      />
                      <label>
                        {tr('메모')}
                        <Textarea
                          maxLength={20000}
                          value={note?.text ?? ''}
                          disabled={noteReadOnly}
                          onChange={(e) => note && change(updateNote(doc, note.id, e.target.value))}
                        />
                      </label>
                    </>
                  )}
                </div>
                {domain && (
                  <PanelSection
                    title={tr('연결된 도메인 관계')}
                    count={connectedRelations(doc.domainRelations, domain.id).length}
                    open={connectedOpen}
                    onOpenChange={setConnectedOpen}
                  >
                    <PanelList
                      empty={tr(
                        '연결된 관계가 없습니다. 카드를 우클릭하거나 위의 ＋ 관계로 연결하세요.',
                      )}
                    >
                      {connectedRelations(doc.domainRelations, domain.id).map((r) => (
                        <PanelRow
                          key={r.id}
                          active={relationId === r.id}
                          title={r.name}
                          meta={
                            (doc.domains.find((d) => d.id === r.sourceDomainId)?.name ?? '') +
                            (r.direction === 'both' ? ' ↔ ' : ' → ') +
                            (doc.domains.find((d) => d.id === r.targetDomainId)?.name ?? '')
                          }
                          onSelect={() => editRelation(r.id)}
                        />
                      ))}
                    </PanelList>
                  </PanelSection>
                )}
                <PanelSection title={tr('위치와 크기')}>
                  <div className="dimensions">
                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                      <label key={key}>
                        {{ x: 'X', y: 'Y', width: tr('너비'), height: tr('높이') }[key]}
                        <Input
                          type="number"
                          min={
                            key === 'x' || key === 'y'
                              ? -10000000
                              : cardSize(domain ? 'domain' : 'note', 0, 0)[key]
                          }
                          max={key === 'x' || key === 'y' ? 10000000 : 10000}
                          value={Math.round(selectedNode[key])}
                          disabled={domain ? readOnly : noteReadOnly}
                          onChange={(e) => {
                            const number = Number(e.target.value);
                            if (
                              Number.isFinite(number) &&
                              (key === 'x' || key === 'y' || number >= 40)
                            )
                              change(updateNodeLayout(doc, selectedNode.id, { [key]: number }));
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </PanelSection>
                <div className="panel-danger">
                  <Button
                    variant="danger"
                    className="danger"
                    disabled={domain ? readOnly : noteReadOnly}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: domain ? tr('도메인 삭제') : tr('메모 삭제'),
                          description: domain
                            ? tr('도메인과 연결된 업무 관계·내부 테이블·텍스트를 삭제할까요?')
                            : tr('이 텍스트를 삭제할까요?'),
                          confirmLabel: tr('삭제'),
                          destructive: true,
                        }))
                      )
                        return;
                      change(domain ? removeDomain(doc, domain.id) : removeNote(doc, note!.id));
                      setSelected(null);
                    }}
                  >
                    {domain ? tr('도메인 삭제') : tr('메모 삭제')}
                  </Button>
                </div>
              </>
            ) : viewId === 'overview' ? (
              <>
                <div className="panel-empty">
                  <strong>{tr('도메인 맵')}</strong>
                  <p>{tr('카드를 선택하면 이름·설명·색상과 연결된 관계를 여기에서 편집합니다.')}</p>
                </div>
                <div className="panel-summary">
                  <span>
                    {tr('도메인 ')}
                    <b>{doc.domains.length}</b>
                  </span>
                  <span>
                    {tr('관계 ')}
                    <b>{doc.domainRelations.length}</b>
                  </span>
                </div>
                <PanelSection title={tr('새 도메인 만들기')}>
                  <form
                    className="inspector-fields"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (domainName.trim()) newDomain(domainName.trim());
                    }}
                  >
                    <label>
                      {tr('도메인 이름')}
                      <Input
                        value={domainName}
                        onChange={(e) => setDomainName(e.target.value)}
                        maxLength={120}
                        disabled={readOnly}
                        required
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="primary"
                      className="primary"
                      disabled={readOnly || !domainName.trim()}
                    >
                      {tr('도메인 생성')}
                    </Button>
                  </form>
                </PanelSection>
                <PanelSection
                  title={relationId ? tr('도메인 관계 수정') : tr('새 도메인 관계')}
                  open={relationsOpen}
                  onOpenChange={setRelationsOpen}
                >
                  <form
                    className="inspector-fields relation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        readOnly ||
                        relationId ||
                        !relationName.trim() ||
                        !doc.domains.some((d) => d.id === source) ||
                        !doc.domains.some((d) => d.id === target) ||
                        source === target
                      )
                        return;
                      change(
                        upsertDomainRelation(doc, {
                          id: relationId || newId(),
                          sourceDomainId: source,
                          targetDomainId: target,
                          name: relationName.trim(),
                          direction,
                          description: relationDescription,
                        }),
                      );
                      resetRelation();
                    }}
                  >
                    <p className="field-help">{tr('도메인 사이의 업무 흐름을 연결합니다.')}</p>
                    <div className="relation-endpoints">
                      <label>
                        {tr('출발 도메인')}
                        <Select
                          aria-label={tr('출발 도메인')}
                          required
                          value={editingDomainRelation?.sourceDomainId ?? source}
                          disabled={readOnly}
                          onValueChange={(value) =>
                            relationId
                              ? editDomainRelation({ sourceDomainId: value })
                              : setSource(value)
                          }
                        >
                          <option value="">{tr('도메인 선택')}</option>
                          {doc.domains.map((d) => (
                            <option
                              key={d.id}
                              value={d.id}
                              disabled={
                                !!editingDomainRelation &&
                                d.id === editingDomainRelation.targetDomainId
                              }
                            >
                              {d.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label>
                        {tr('도착 도메인')}
                        <Select
                          aria-label={tr('도착 도메인')}
                          required
                          value={editingDomainRelation?.targetDomainId ?? target}
                          disabled={readOnly}
                          onValueChange={(value) =>
                            relationId
                              ? editDomainRelation({ targetDomainId: value })
                              : setTarget(value)
                          }
                        >
                          <option value="">{tr('도메인 선택')}</option>
                          {doc.domains.map((d) => (
                            <option
                              key={d.id}
                              value={d.id}
                              disabled={
                                !!editingDomainRelation &&
                                d.id === editingDomainRelation.sourceDomainId
                              }
                            >
                              {d.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>
                    <label>
                      {tr('관계 이름')}
                      <Input
                        data-relation-name-input
                        aria-label={tr('관계 이름')}
                        required
                        maxLength={120}
                        value={displayedRelationName}
                        placeholder={tr('예: 결제 요청')}
                        disabled={readOnly}
                        aria-invalid={!displayedRelationName.trim()}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (!editingDomainRelation) {
                            setRelationName(value);
                            return;
                          }
                          setRelationNameDraft({
                            id: relationId,
                            base: editingDomainRelation.name,
                            value,
                          });
                          editDomainRelation({ name: value });
                        }}
                      />
                      {editingDomainRelation && !displayedRelationName.trim() && (
                        <span className="field-help" role="status">
                          {tr('관계 이름을 입력하면 저장됩니다. 기존 이름은 유지됩니다.')}
                        </span>
                      )}
                    </label>
                    <label>
                      {tr('방향')}
                      <Select
                        aria-label={tr('방향')}
                        value={editingDomainRelation?.direction ?? direction}
                        disabled={readOnly}
                        onValueChange={(value) =>
                          relationId
                            ? editDomainRelation({ direction: value as 'forward' | 'both' })
                            : setDirection(value as 'forward' | 'both')
                        }
                      >
                        <option value="forward">{tr('출발 → 도착')}</option>
                        <option value="both">{tr('출발 ↔ 도착')}</option>
                      </Select>
                    </label>
                    <label>
                      {tr('설명')}
                      <Textarea
                        maxLength={10000}
                        value={editingDomainRelation?.description ?? relationDescription}
                        disabled={readOnly}
                        onChange={(e) =>
                          relationId
                            ? editDomainRelation({ description: e.target.value })
                            : setRelationDescription(e.target.value)
                        }
                      />
                    </label>
                    {!relationId && (
                      <Button
                        type="submit"
                        variant="primary"
                        className="primary"
                        disabled={
                          readOnly ||
                          !source ||
                          !target ||
                          source === target ||
                          !relationName.trim()
                        }
                      >
                        {tr('관계 연결')}
                      </Button>
                    )}
                    {relationId && (
                      <div className="actions">
                        <Button
                          type="button"
                          variant="danger"
                          className="danger"
                          disabled={readOnly}
                          onClick={() => {
                            change(removeDomainRelation(doc, relationId));
                            resetRelation();
                          }}
                        >
                          {tr('관계 삭제')}
                        </Button>
                        <Button type="button" onClick={resetRelation}>
                          {tr('편집 닫기')}
                        </Button>
                      </div>
                    )}
                  </form>
                </PanelSection>
                <PanelNote>
                  {tr('빈 캔버스를 우클릭하면 자동 배치와 생성 명령을 바로 사용할 수 있습니다.')}
                </PanelNote>
              </>
            ) : (
              <>
                <div className="panel-empty">
                  <strong>{currentViewName}</strong>
                  <p>{tr('테이블을 선택하면 컬럼·키·관계를 여기에서 편집합니다.')}</p>
                </div>
                <div className="panel-summary">
                  <span>
                    {tr('테이블 ')}
                    <b>{viewTables.length}</b>
                  </span>
                  <span>
                    {tr('관계 ')}
                    <b>{viewRelations.length}</b>
                  </span>
                  <span>
                    ENUM <b>{(doc.enums ?? []).length}</b>
                  </span>
                </div>
                <PanelSection title={tr('새 테이블 만들기')} defaultOpen>
                  <TableWorkspaceTools
                    hideViewMode
                    document={doc}
                    viewId={viewId}
                    creationOwner={creationOwner ?? null}
                    viewMode={viewMode}
                    onViewModeChange={() => {}}
                    onChange={change}
                    readOnly={readOnly}
                    position={position()}
                    onSelect={pick}
                  />
                </PanelSection>
                <PanelNote>
                  {fullCanvas
                    ? tr(
                        '전체 테이블의 컬럼·키·관계를 설계하고 속성에서 도메인과 색상을 지정할 수 있습니다.',
                      )
                    : tr(
                        '목록 탭에서 테이블과 다른 도메인의 참조 관계를 확인할 수 있습니다. 빈 캔버스 우클릭으로 자동 배치를 실행합니다.',
                      )}
                </PanelNote>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** External tables must have a physical key relation in a saved view containing this domain. */
export function referencedDomainTables(doc: DesignDocument, domainId: string): Table[] {
  const tables = (doc.tables ?? []).filter((t) => isVisibleInView(t.scope, 'physical'));
  const ownIds = new Set(tables.filter((t) => t.domainId === domainId).map((t) => t.id));
  const sharedDomains = new Set(
    (doc.views ?? []).filter((v) => v.domainIds.includes(domainId)).flatMap((v) => v.domainIds),
  );
  const referencedIds = new Set(
    (doc.tableRelations ?? [])
      .filter((r) => r.physical && isVisibleInView(r.scope, 'physical'))
      .flatMap((r) =>
        ownIds.has(r.sourceTableId)
          ? [r.targetTableId]
          : ownIds.has(r.targetTableId)
            ? [r.sourceTableId]
            : [],
      ),
  );
  return tables.filter(
    (t) =>
      t.domainId !== null &&
      t.domainId !== domainId &&
      sharedDomains.has(t.domainId) &&
      referencedIds.has(t.id),
  );
}

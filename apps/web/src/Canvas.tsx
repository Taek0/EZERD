import { applyDomainSelection } from './domain-view.js';
import { applyDomainRelationPatch, type DomainRelationPatch } from './domain-relation-edit.js';
import { DialogTrigger, Dialog } from 'react-aria-components';
import { UntitledPopover } from './components/ui/untitled.js';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import {
  type DesignDocument,
  type Table,
  upsertTableRelation,
  removeTableRelation,
  removeTable,
  isVisibleInView,
  autoLayoutView,
  removeTableReference,
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
import { inspectorBounds, clampInspectorWidth, readInspectorWidth } from './inspector-state.js';
import { tableCardSize } from './table-geometry.js';
import { exportCanvasPng } from './canvas-export.js';
import { layoutDomainRelations } from './domain-relations.js';
import { DomainDescription } from './DomainDescription.js';
import { DomainColorPicker } from './DomainColorPicker.js';
import { useConfirm } from './components/ui/ConfirmProvider.js';
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
} from './TableEditor.js';
import { clampLayoutPatch, newId, validViewId } from './client.js';
import {
  Button,
  Checkbox,
  ContextMenu,
  IconButton,
  Input,
  Select,
  TabButton,
  Textarea,
} from './components/ui/index.js';
import { PanelList, PanelNote, PanelRow, PanelSection } from './panel.js';
import { syncLayoutPolicy } from './sync-layout-policy.js';
import './domain-workflow.css';
export type CanvasContext = {
  viewId: string;
  selectedObjectId: string | null;
  position: { x: number; y: number };
};
type Props = {
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
}: Props) {
  const confirm = useConfirm();
  const latestDeletion = useRef({ doc, onChange, readOnly });
  latestDeletion.current = { doc, onChange, readOnly };
  const deletionPending = useRef(false);
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
  const [viewDraftId, setViewDraftId] = useState<string | null>(null);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [combinedName, setCombinedName] = useState('함께 보기');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
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
  const stackedInspector = workspaceWidth < 620;
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
  const [requestedViewId, setViewId] = useState('overview'),
    [selected, setSelected] = useState<string | null>(null),
    [relationId, setRelationId] = useState('');
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
  const viewId = validViewId(requestedViewId, [
    ...doc.domains.map((d) => d.id),
    ...(doc.views ?? []).map((v) => v.id),
  ]);
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
  } | null>(null);
  const viewport = localViewports[viewId] ??
    doc.layout.viewports.find((v) => v.viewId === viewId) ?? { viewId, x: 40, y: 40, zoom: 1 };
  const activeCombined = doc.views?.find((v) => v.id === viewId);
  const layoutPolicy = syncLayoutPolicy(readOnly, !!activeCombined);
  const nodes = doc.layout.nodes
    .filter((n) => {
      const table = (doc.tables ?? []).find((t) => t.id === n.objectId);
      return (
        n.viewId === viewId &&
        (!table ||
          (isVisibleInView(table.scope, viewMode) &&
            (!activeCombined || activeCombined.domainIds.includes(table.domainId))))
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
    });
  const domainRoutes = layoutDomainRelations(doc.domainRelations, nodes);
  const selectedNode = nodes.find((n) => n.objectId === selected),
    domain = doc.domains.find((d) => d.id === selected),
    note = doc.notes.find((n) => n.id === selected);
  useEffect(() => {
    if (source && !doc.domains.some((d) => d.id === source)) setSource('');
    if (target && !doc.domains.some((d) => d.id === target)) setTarget('');
    if (relationId && !doc.domainRelations.some((r) => r.id === relationId)) {
      setRelationId('');
      setRelationName('');
      setRelationDescription('');
    }
  }, [doc.domains, doc.domainRelations, source, target, relationId]);
  const table = (doc.tables ?? []).find((t) => t.id === selected);
  const selectedTableRelation = (doc.tableRelations ?? []).find((r) => r.id === selected);
  useEffect(() => {
    contextCallback.current?.({
      viewId,
      selectedObjectId: selected,
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
    selectedNode?.x,
    selectedNode?.y,
    selectedNode?.width,
    selectedNode?.height,
  ]);
  useEffect(() => {
    if (!focusTarget) return;
    const destinationView = validViewId(focusTarget.viewId, [
      ...doc.domains.map((d) => d.id),
      ...(doc.views ?? []).map((v) => v.id),
    ]);
    setViewId(destinationView);
    setSelected(destinationView === focusTarget.viewId ? focusTarget.objectId : null);
    const node = doc.layout.nodes.find(
      (n) => n.viewId === focusTarget.viewId && n.objectId === focusTarget.objectId,
    );
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
  const activeDomain = doc.domains.find((d) => d.id === viewId);
  const query = relationSearch.trim().toLocaleLowerCase();
  const matches = (...values: (string | undefined | null)[]) =>
    !query || values.filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
  const viewTables = (doc.tables ?? []).filter(
    (t) => isVisibleInView(t.scope, viewMode) && nodes.some((n) => n.objectId === t.id),
  );
  const otherTables = referencedDomainTables(doc, viewId);
  const viewRelations = (doc.tableRelations ?? []).filter(
    (r) =>
      isVisibleInView(r.scope, viewMode) &&
      !!r.physical &&
      viewTables.some((t) => t.id === r.sourceTableId) &&
      viewTables.some((t) => t.id === r.targetTableId),
  );
  const tableLabel = (t: Table) => t.physical.name || t.logical.name || '이름 없는 테이블';
  const outlineCount = viewId === 'overview' ? doc.domains.length : viewTables.length;
  const selectionKind = selectedTableRelation
    ? '테이블 관계'
    : table
      ? '테이블'
      : domain
        ? '도메인'
        : note
          ? '텍스트'
          : '';
  const selectionName = selectedTableRelation
    ? `${tableLabel(doc.tables!.find((t) => t.id === selectedTableRelation.targetTableId)!)} → ${tableLabel(doc.tables!.find((t) => t.id === selectedTableRelation.sourceTableId)!)}`
    : table
      ? tableLabel(table)
      : domain
        ? domain.name
        : note
          ? note.text.slice(0, 40) || '자유 텍스트'
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
            tables: (doc.tables ?? []).filter((t) => isVisibleInView(t.scope, viewMode)),
            tableRelations: (doc.tableRelations ?? []).filter(
              (r) => isVisibleInView(r.scope, viewMode) && !!r.physical,
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
    if (!readOnly) (onPreviewChange ?? onChange)(next);
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
    next = clampLayoutPatch(next);
    setLocalViewports((value) => ({ ...value, [viewId]: next }));
  }
  function navigate(id: string) {
    setMenu(null);
    setConnectSource(null);
    setConnectPointer(null);
    setFkSource(null);
    setFkTarget(null);
    setViewId(id);
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
    if (readOnly) return;
    const id = newId();
    change(addNote(doc, { id, viewId, text: '업무 설명을 입력하세요.' }, position()));
    pick(id);
  }
  function newTable(name = '', at?: { x: number; y: number }) {
    if (readOnly || viewId === 'overview' || activeCombined) return;
    const id = newId();
    change(
      addTable(
        doc,
        {
          id,
          domainId: viewId,
          scope: 'physical',
          logical: { name: '새 테이블', definition: '' },
          physical: { name, schema: 'public', comment: '' },
          customProperties: emptyMetadata(),
        },
        at ?? position(),
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
    const next = Math.max(0.25, Math.min(2, value));
    const rect = surface.current?.getBoundingClientRect();
    const cx = (rect?.width ?? 800) / 2,
      cy = (rect?.height ?? 600) / 2;
    moveViewport({
      viewId,
      zoom: next,
      x: cx - ((cx - viewport.x) * next) / viewport.zoom,
      y: cy - ((cy - viewport.y) * next) / viewport.zoom,
    });
  }
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoom(viewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [doc, readOnly, viewId, viewport.x, viewport.y, viewport.zoom]);
  function begin(e: PointerEvent<HTMLDivElement>, id: string | null, resize = false) {
    if (e.button !== 0) return;
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
        x: (e.clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
        y: (e.clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom,
      };
      contextCallback.current?.({
        viewId,
        selectedObjectId: null,
        position: blankPosition.current,
      });
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
      x: node?.x ?? viewport.x,
      y: node?.y ?? viewport.y,
      width: node?.width ?? 0,
      height: node?.height ?? 0,
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
    if (start.pending) {
      // Preserve the original click target so stationary double-clicks enter editing.
      if (Math.hypot(dx, dy) < 5) return;
      start.pending = false;
      start.captureTarget.setPointerCapture(start.pointerId);
    }
    if (start.id) {
      preview(
        updateNodeLayout(
          live.current,
          start.id,
          start.resize
            ? {
                width: Math.max(160, start.width + dx / viewport.zoom),
                height: Math.max(110, start.height + dy / viewport.zoom),
              }
            : { x: start.x + dx / viewport.zoom, y: start.y + dy / viewport.zoom },
        ),
      );
    } else moveViewport({ ...viewport, x: start.x + dx, y: start.y + dy });
  }
  function finish() {
    const active = drag.current;
    drag.current = null;
    if (active?.captureTarget.hasPointerCapture(active.pointerId))
      active.captureTarget.releasePointerCapture(active.pointerId);
    if (active?.id && !active.pending) change(live.current);
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
      globalThis.document.querySelector<HTMLInputElement>('[aria-label="관계 이름"]')?.focus(),
    );
  }
  return (
    <div
      ref={workspaceRef}
      onKeyDown={async (event) => {
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
          !selectedNode ||
          (!domain && !table) ||
          !(event.target instanceof Element) ||
          event.target.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"],dialog',
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const id = selectedNode.objectId;
        const kind = domain ? 'domain' : 'table';
        deletionPending.current = true;
        try {
          if (
            !(await confirm({
              title: kind === 'domain' ? '도메인 삭제' : '테이블 삭제',
              description:
                kind === 'domain'
                  ? '도메인과 연결된 업무 관계·내부 테이블·텍스트를 삭제할까요?'
                  : '테이블과 소유 컬럼, 키, 관계 및 모든 외부 참조를 삭제할까요?',
              confirmLabel: '삭제',
              destructive: true,
            }))
          )
            return;
          const latest = latestDeletion.current;
          if (latest.readOnly) return;
          if (
            kind === 'domain'
              ? !latest.doc.domains.some((item) => item.id === id)
              : !latest.doc.tables?.some((item) => item.id === id)
          )
            return;
          latest.onChange(
            kind === 'domain' ? removeDomain(latest.doc, id) : removeTable(latest.doc, id),
          );
          setSelected((current) => (current === id ? null : current));
        } finally {
          deletionPending.current = false;
        }
      }}
      style={{ '--inspector-width': `${panelWidth}px` } as CSSProperties}
      className={`workspace ${inspectorOpen ? '' : 'inspector-hidden'} ${resizingInspector ? 'inspector-resizing' : ''} ${stackedInspector ? 'inspector-stacked' : ''}`}
    >
      <div className="canvas-column" key={viewId}>
        <div className="canvas-toolbar">
          <div className="breadcrumbs">
            {viewId !== 'overview' && (
              <Button className="domain-map-return" onClick={() => navigate('overview')}>
                ← 도메인 맵으로
              </Button>
            )}
            {activeCombined && <strong>{activeCombined.name}</strong>}
            {activeDomain && (
              <>
                <span aria-hidden="true">/</span>
                <strong title={activeDomain.name}>{activeDomain.name}</strong>
              </>
            )}
          </div>
          <div className="actions">
            {viewId === 'overview' ? (
              <Button disabled={readOnly} onClick={() => newDomain()}>
                ＋ 도메인
              </Button>
            ) : (
              <Button disabled={readOnly || !!activeCombined} onClick={() => newTable()}>
                ＋ 테이블
              </Button>
            )}
            <DialogTrigger
              isOpen={viewPickerOpen}
              onOpenChange={(open) => {
                setViewPickerOpen(open);
                if (open) {
                  setSelectedDomains(
                    activeCombined?.domainIds ??
                      (activeDomain ? [activeDomain.id] : (doc.views?.[0]?.domainIds ?? [])),
                  );
                }
              }}
            >
              <Button className="domain-view-trigger">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M3 5h14M3 10h14M3 15h14"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                도메인 뷰
              </Button>
              <UntitledPopover
                className="domain-view-popover"
                placement="bottom start"
                shouldFlip={false}
                offset={8}
              >
                <Dialog aria-label="도메인 뷰" className="combined-view-picker">
                  <strong>도메인 선택</strong>
                  <p className="panel-note">
                    함께 볼 도메인을 선택하세요. 각 도메인의 테이블 배치를 유지해 나란히 표시합니다.
                  </p>
                  <div className="combined-domain-options">
                    {doc.domains.map((d) => (
                      <label key={d.id}>
                        <Checkbox
                          aria-label={d.name}
                          checked={selectedDomains.includes(d.id)}
                          onChange={(e) =>
                            setSelectedDomains((value) =>
                              e.target.checked
                                ? [...value, d.id]
                                : value.filter((id) => id !== d.id),
                            )
                          }
                        />
                        <span style={{ color: d.color ?? '#8993a3' }}>●</span>
                        {d.name}
                      </label>
                    ))}
                  </div>
                  <div className="actions">
                    <Button
                      disabled={readOnly || !selectedDomains.length}
                      onClick={() => {
                        const result = applyDomainSelection(
                          doc,
                          selectedDomains,
                          activeCombined?.id ?? null,
                          newId,
                        );
                        change(result.document);
                        navigate(result.viewId);
                        setViewPickerOpen(false);
                      }}
                    >
                      적용
                    </Button>
                    <Button onClick={() => setViewPickerOpen(false)}>닫기</Button>
                  </div>
                </Dialog>
              </UntitledPopover>
            </DialogTrigger>
            <Button
              disabled={exporting || !nodes.length}
              onClick={async () => {
                const world = surface.current?.querySelector<HTMLElement>('.canvas-world');
                if (!world) return;
                setExporting(true);
                setExportError('');
                try {
                  await exportCanvasPng(
                    world,
                    nodes,
                    activeCombined?.name ??
                      activeCombined?.name ??
                      activeDomain?.name ??
                      '도메인 맵',
                  );
                } catch {
                  setExportError('이미지를 만들지 못했습니다. 다시 시도해 주세요.');
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? '이미지 생성 중…' : '고화질 PNG'}
            </Button>
            <Button disabled={readOnly} onClick={newNote}>
              ＋ 텍스트
            </Button>
            {viewId !== 'overview' && <Button onClick={() => setEnumOpen(true)}>ENUM</Button>}
            <span className="toolbar-divider" aria-hidden="true" />
            <IconButton
              className="inspector-toggle"
              aria-label={inspectorOpen ? '속성 패널 숨기기' : '속성 패널 열기'}
              title={inspectorOpen ? '속성 패널 숨기기' : '속성 패널 열기'}
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
        {exportError && <p role="alert">{exportError}</p>}

        <div
          ref={surface}
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
              ? '도메인 맵 캔버스'
              : `${activeCombined?.name ?? activeDomain?.name} 내부 캔버스`
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
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            }}
          >
            {viewId === 'overview' && (
              <svg className="relations" aria-label="도메인 관계">
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
                  aria-label="테이블 관계"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <TableRelationsSvg
                    hideControls
                    selectedId={selected}
                    document={doc}
                    visibleNodeIds={nodes.map((node) => node.id)}
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
                  aria-label="관계 선 조절"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <TableRelationsSvg
                    controlsOnly
                    selectedId={selected}
                    document={doc}
                    visibleNodeIds={nodes.map((node) => node.id)}
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
                  className={`canvas-node ${d ? 'domain-node' : t ? 'table-node' : 'note-node'} ${selected === node.objectId ? 'selected' : ''} ${d && connectSource === d.id ? 'connection-source' : ''}`}
                  style={
                    {
                      left: node.x,
                      top: node.y,
                      ...(t
                        ? tableCardSize(doc, t.id, node.width, node.height)
                        : cardSize(d ? 'domain' : 'note', node.width, node.height)),
                      ...(d ? { '--domain-color': d.color ?? '#8993a3' } : {}),
                    } as CSSProperties
                  }
                  onPointerDown={(e) => begin(e, node.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!d || (readOnly && !onCreatePin)) return;
                    menuPointer.current = { x: e.clientX, y: e.clientY };
                    e.stopPropagation();
                    e.currentTarget.focus();
                    setSelected(d.id);
                    setMenu({
                      source: d.id,
                      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 290)),
                      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 320)),
                    });
                  }}
                  onDoubleClick={() => d && navigate(d.id)}
                  tabIndex={0}
                  role="group"
                  aria-label={d?.name ?? (t ? tableLabel(t) : '자유 텍스트')}
                  onFocus={(e) => {
                    if (e.target === e.currentTarget) setSelected(node.objectId);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' && d) {
                      navigate(d.id);
                      return;
                    }
                    if (!layoutPolicy.moveNodes) return;
                    if (d && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenu({
                        source: d.id,
                        x: Math.max(8, Math.min(rect.left, window.innerWidth - 290)),
                        y: Math.max(8, Math.min(rect.top + 40, window.innerHeight - 320)),
                      });
                      return;
                    }
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
                        aria-label={`${d.name} 도메인 열기`}
                      >
                        도메인 열기 ↗
                      </Button>
                    </>
                  ) : t ? (
                    <TableNodeContent
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
                    <p className="note-content">{n?.text}</p>
                  )}
                  {layoutPolicy.resizeNodes && (
                    <div
                      className="resize-handle"
                      title="크기 조절"
                      onPointerDown={(e) => begin(e, node.id, true)}
                    />
                  )}
                </div>
              );
            })}
            {pins}
          </div>
          {!nodes.length && (
            <div className="canvas-empty">
              <span className="empty-symbol" aria-hidden="true">
                {viewId === 'overview' ? '◇' : '▦'}
              </span>
              <h2>
                {viewId === 'overview' ? '큰 그림부터 시작하세요' : '이 도메인의 구조를 준비하세요'}
              </h2>
              <p>
                {viewId === 'overview'
                  ? '도메인을 만들고 업무의 흐름을 연결해 보세요.'
                  : '테이블을 추가하고 컬럼과 관계를 설계하세요.'}
              </p>

              {viewId === 'overview' && (
                <Button
                  variant="primary"
                  className="primary"
                  disabled={readOnly}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => newDomain()}
                >
                  첫 도메인 만들기
                </Button>
              )}
            </div>
          )}
          <div className="canvas-hint" role={connectSource || fkSource ? 'status' : undefined}>
            {connectSource
              ? '연결할 도메인을 클릭하세요 · Escape 취소'
              : fkSource
                ? 'PK를 받을 테이블을 클릭하세요 · FK 컬럼 자동 추가 · Escape 취소'
                : '드래그로 이동 · 우클릭으로 자동 배치'}
          </div>
          <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
            <IconButton aria-label="축소" onClick={() => zoom(viewport.zoom - 0.1)}>
              −
            </IconButton>
            <Button onClick={() => zoom(1)} aria-label="배율 100%로 초기화">
              {Math.round(viewport.zoom * 100)}%
            </Button>
            <IconButton aria-label="확대" onClick={() => zoom(viewport.zoom + 0.1)}>
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
        label={menu?.source ? '도메인 관계 설정' : '캔버스 메뉴'}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                ...(onCreatePin
                  ? [
                      {
                        id: 'create-pin',
                        label: '이 위치에 핀 남기기',
                        onAction: () => pinAt(menuPointer.current.x, menuPointer.current.y),
                      },
                    ]
                  : []),
                ...(!readOnly
                  ? menu.source
                    ? [
                        {
                          id: 'panel-relation',
                          label: '새 도메인 관계',
                          onAction: () => startRelation(menu.source!, ''),
                        },
                        {
                          id: 'direct-relation',
                          label: '도메인 직접 연결',
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
                                label: '새 도메인 생성',
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
                                label: '새 도메인 관계',
                                onAction: () => startRelation('', ''),
                              },
                            ]
                          : [
                              {
                                id: 'new-table',
                                label: activeCombined
                                  ? '새 테이블은 소유 도메인 화면에서 생성하세요'
                                  : '새 테이블 생성',
                                disabled: !!activeCombined || !activeDomain,
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
                          label: '자동 배치',
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
          aria-label="속성 패널 너비 조절"
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
        <aside id="canvas-inspector" className="inspector">
          <div className="inspector-topbar">
            <div className="inspector-place">
              <span>{viewId === 'overview' ? 'VIEW' : 'DOMAIN'}</span>
              <strong title={activeCombined?.name ?? activeDomain?.name ?? '도메인 맵'}>
                {activeCombined?.name ?? activeDomain?.name ?? '도메인 맵'}
              </strong>
            </div>
            {selectionName && (
              <div className="inspector-selection">
                <span className="selection-kind">{selectionKind}</span>
                <strong title={selectionName}>{selectionName}</strong>
                <IconButton aria-label="선택 해제" onClick={() => setSelected(null)}>
                  ×
                </IconButton>
              </div>
            )}
            <div className="inspector-tabs" role="group" aria-label="패널 보기 전환">
              <TabButton
                selected={panelTab === 'properties'}
                onClick={() => setPanelTab('properties')}
              >
                속성
              </TabButton>
              <TabButton selected={panelTab === 'outline'} onClick={() => setPanelTab('outline')}>
                목록 <span className="panel-count">{outlineCount}</span>
              </TabButton>
            </div>
          </div>
          <div className="inspector-body">
            {panelTab === 'outline' ? (
              <>
                <div className="panel-search">
                  <Input
                    aria-label="현재 화면 검색"
                    placeholder={viewId === 'overview' ? '도메인·관계 검색' : '테이블·관계 검색'}
                    value={relationSearch}
                    onChange={(e) => setRelationSearch(e.target.value)}
                  />
                </div>
                {viewId === 'overview' ? (
                  <>
                    <PanelSection title="도메인" count={doc.domains.length} defaultOpen>
                      <PanelList empty="표시할 도메인이 없습니다.">
                        {doc.domains
                          .filter((d) => matches(d.name, d.description))
                          .map((d) => (
                            <PanelRow
                              key={d.id}
                              accent={d.color ?? '#8993a3'}
                              active={selected === d.id}
                              title={d.name}
                              meta={
                                '관계 ' +
                                connectedRelations(doc.domainRelations, d.id).length +
                                '개'
                              }
                              onSelect={() => pick(d.id)}
                              action={<Button onClick={() => navigate(d.id)}>열기</Button>}
                            />
                          ))}
                      </PanelList>
                    </PanelSection>
                    <PanelSection title="도메인 관계" count={filteredRelations.length} defaultOpen>
                      <PanelList empty="표시할 관계가 없습니다.">
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
                    <PanelSection title="이 화면의 테이블" count={viewTables.length} defaultOpen>
                      <PanelList empty="이 도메인에 테이블이 없습니다. 툴바의 ＋ 테이블로 추가하세요.">
                        {viewTables
                          .filter((t) => matches(t.physical.name, t.logical.name))
                          .map((t) => (
                            <PanelRow
                              key={t.id}
                              active={selected === t.id}
                              title={tableLabel(t)}
                              meta={
                                '컬럼 ' +
                                (doc.columns ?? []).filter(
                                  (c) => c.tableId === t.id && isVisibleInView(c.scope, viewMode),
                                ).length +
                                '개'
                              }
                              badge={t.domainId === viewId ? undefined : '참조'}
                              onSelect={() => pick(t.id)}
                            />
                          ))}
                      </PanelList>
                    </PanelSection>
                    <PanelSection title="테이블 관계" count={viewRelations.length}>
                      <PanelList empty="이 화면에 표시할 테이블 관계가 없습니다.">
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
                    {!activeCombined && (
                      <PanelSection title="다른 도메인 테이블" count={otherTables.length}>
                        <PanelNote>
                          도메인 뷰에서 현재 도메인과 키 관계로 연결된 참조 테이블입니다.
                        </PanelNote>
                        <PanelList empty="도메인 뷰에서 참조 관계를 설정한 다른 도메인 테이블이 없습니다.">
                          {otherTables
                            .filter((t) => matches(t.physical.name, t.logical.name))
                            .map((t) => (
                              <li key={t.id} className="panel-row">
                                <div className="panel-row-main reference-table-row">
                                  <span className="panel-row-text">
                                    <span className="panel-row-title">{tableLabel(t)}</span>
                                    <small>
                                      {doc.domains.find((d) => d.id === t.domainId)?.name}
                                    </small>
                                  </span>
                                  <span className="panel-row-badge">참조</span>
                                </div>
                              </li>
                            ))}
                        </PanelList>
                      </PanelSection>
                    )}
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
                {selectedNode && !activeCombined && table.domainId !== viewId && (
                  <Button
                    variant="danger"
                    className="danger"
                    disabled={readOnly}
                    onClick={() => {
                      change(removeTableReference(doc, selectedNode.id));
                      setSelected(null);
                    }}
                  >
                    이 화면의 참조 제거
                  </Button>
                )}
                <TableInspector
                  key={table.id}
                  document={doc}
                  tableId={table.id}
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
                        도메인 이름
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
                        업무 설명
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
                        <Button onClick={() => navigate(domain.id)}>도메인 열기 →</Button>
                        <Button disabled={readOnly} onClick={() => startRelation(domain.id, '')}>
                          ＋ 관계
                        </Button>
                      </div>
                    </>
                  ) : (
                    <label>
                      자유 텍스트
                      <Textarea
                        maxLength={20000}
                        value={note?.text ?? ''}
                        disabled={readOnly}
                        onChange={(e) => note && change(updateNote(doc, note.id, e.target.value))}
                      />
                    </label>
                  )}
                </div>
                {domain && (
                  <PanelSection
                    title="연결된 도메인 관계"
                    count={connectedRelations(doc.domainRelations, domain.id).length}
                    open={connectedOpen}
                    onOpenChange={setConnectedOpen}
                  >
                    <PanelList empty="연결된 관계가 없습니다. 카드를 우클릭하거나 위의 ＋ 관계로 연결하세요.">
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
                <PanelSection title="위치와 크기">
                  <div className="dimensions">
                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                      <label key={key}>
                        {{ x: 'X', y: 'Y', width: '너비', height: '높이' }[key]}
                        <Input
                          type="number"
                          min={
                            key === 'x' || key === 'y'
                              ? -10000000
                              : cardSize(domain ? 'domain' : 'note', 0, 0)[key]
                          }
                          max={key === 'x' || key === 'y' ? 10000000 : 10000}
                          value={Math.round(selectedNode[key])}
                          disabled={readOnly}
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
                    disabled={readOnly}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: domain ? '도메인 삭제' : '텍스트 삭제',
                          description: domain
                            ? '도메인과 연결된 업무 관계·내부 테이블·텍스트를 삭제할까요?'
                            : '이 텍스트를 삭제할까요?',
                          confirmLabel: '삭제',
                          destructive: true,
                        }))
                      )
                        return;
                      change(domain ? removeDomain(doc, domain.id) : removeNote(doc, note!.id));
                      setSelected(null);
                    }}
                  >
                    {domain ? '도메인 삭제' : '텍스트 삭제'}
                  </Button>
                </div>
              </>
            ) : viewId === 'overview' ? (
              <>
                <div className="panel-empty">
                  <strong>도메인 맵</strong>
                  <p>카드를 선택하면 이름·설명·색상과 연결된 관계를 여기에서 편집합니다.</p>
                </div>
                <div className="panel-summary">
                  <span>
                    도메인 <b>{doc.domains.length}</b>
                  </span>
                  <span>
                    관계 <b>{doc.domainRelations.length}</b>
                  </span>
                </div>
                <PanelSection title="새 도메인 만들기">
                  <form
                    className="inspector-fields"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (domainName.trim()) newDomain(domainName.trim());
                    }}
                  >
                    <label>
                      도메인 이름
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
                      도메인 생성
                    </Button>
                  </form>
                </PanelSection>
                <PanelSection
                  title={relationId ? '도메인 관계 수정' : '새 도메인 관계'}
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
                    <p className="field-help">도메인 사이의 업무 흐름을 연결합니다.</p>
                    <div className="relation-endpoints">
                      <label>
                        출발 도메인
                        <Select
                          aria-label="출발 도메인"
                          required
                          value={editingDomainRelation?.sourceDomainId ?? source}
                          disabled={readOnly}
                          onValueChange={(value) =>
                            relationId
                              ? editDomainRelation({ sourceDomainId: value })
                              : setSource(value)
                          }
                        >
                          <option value="">도메인 선택</option>
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
                        도착 도메인
                        <Select
                          aria-label="도착 도메인"
                          required
                          value={editingDomainRelation?.targetDomainId ?? target}
                          disabled={readOnly}
                          onValueChange={(value) =>
                            relationId
                              ? editDomainRelation({ targetDomainId: value })
                              : setTarget(value)
                          }
                        >
                          <option value="">도메인 선택</option>
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
                      관계 이름
                      <Input
                        aria-label="관계 이름"
                        required
                        maxLength={120}
                        value={displayedRelationName}
                        placeholder="예: 결제 요청"
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
                          관계 이름을 입력하면 저장됩니다. 기존 이름은 유지됩니다.
                        </span>
                      )}
                    </label>
                    <label>
                      방향
                      <Select
                        aria-label="방향"
                        value={editingDomainRelation?.direction ?? direction}
                        disabled={readOnly}
                        onValueChange={(value) =>
                          relationId
                            ? editDomainRelation({ direction: value as 'forward' | 'both' })
                            : setDirection(value as 'forward' | 'both')
                        }
                      >
                        <option value="forward">출발 → 도착</option>
                        <option value="both">출발 ↔ 도착</option>
                      </Select>
                    </label>
                    <label>
                      설명
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
                        관계 연결
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
                          관계 삭제
                        </Button>
                        <Button type="button" onClick={resetRelation}>
                          편집 닫기
                        </Button>
                      </div>
                    )}
                  </form>
                </PanelSection>
                <PanelNote>
                  빈 캔버스를 우클릭하면 자동 배치와 생성 명령을 바로 사용할 수 있습니다.
                </PanelNote>
              </>
            ) : (
              <>
                <div className="panel-empty">
                  <strong>{activeCombined?.name ?? activeDomain?.name ?? '도메인'}</strong>
                  <p>테이블을 선택하면 컬럼·키·관계를 여기에서 편집합니다.</p>
                </div>
                <div className="panel-summary">
                  <span>
                    테이블 <b>{viewTables.length}</b>
                  </span>
                  <span>
                    관계 <b>{viewRelations.length}</b>
                  </span>
                  <span>
                    ENUM <b>{(doc.enums ?? []).length}</b>
                  </span>
                </div>
                {!activeCombined && (
                  <PanelSection title="새 테이블 만들기" defaultOpen>
                    <TableWorkspaceTools
                      hideViewMode
                      document={doc}
                      viewId={viewId}
                      viewMode={viewMode}
                      onViewModeChange={() => {}}
                      onChange={change}
                      readOnly={readOnly}
                      position={position()}
                      onSelect={pick}
                    />
                  </PanelSection>
                )}
                <PanelNote>
                  목록 탭에서 테이블과 다른 도메인의 참조 관계를 확인할 수 있습니다. 빈 캔버스
                  우클릭으로 자동 배치를 실행합니다.
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
    (t) => t.domainId !== domainId && sharedDomains.has(t.domainId) && referencedIds.has(t.id),
  );
}

import { useEffect, useRef, useState, type ReactNode, type CSSProperties, type PointerEvent } from 'react';
import { type DesignDocument, isVisibleInView, autoLayoutView, removeTableReference, addDomain, updateDomain, removeDomain, upsertDomainRelation, removeDomainRelation, addNote, updateNote, removeNote, updateNodeLayout as modelUpdateNodeLayout, setViewport, diagnoseDocument } from '@ezerd/model';
import { inspectorBounds, clampInspectorWidth, readInspectorWidth } from './inspector-state.js';
import { cardSize, connectedRelations } from './canvas-state.js';
import { TableNodeContent, TableInspector, TableWorkspaceTools, TableRelationsSvg, ForeignKeyDialog } from './TableEditor.js';
import { clampLayoutPatch, newId, validViewId, viewportDestination } from './client.js';
import { Accordion, Button, Collapse, ContextMenu, DisclosureButton, IconButton, Input, Select, Textarea } from './components/ui/index.js';
import './domain-workflow.css';
export type CanvasContext = { viewId: string; selectedObjectId: string | null; position: { x: number; y: number } };
type Props = {
  onContextChange?: (context: CanvasContext) => void;
  focusTarget?: { viewId: string; objectId: string | null; threadId?: string; x: number; y: number; nonce: number };
  pins?: ReactNode;
  document: DesignDocument;
  onChange: (document: DesignDocument) => void;
  readOnly: boolean;
};
export function Canvas({ document: doc, onChange, readOnly, onContextChange, focusTarget, pins }: Props) {
  const [viewMode, setViewMode] = useState<'logical' | 'physical' | 'both'>('both');
  const [inspectorOpen, setInspectorOpen] = useState(() => { try { return localStorage.getItem('ezerd.inspector') !== 'hidden'; } catch { return true; } });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(1100);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try { return readInspectorWidth(localStorage.getItem('ezerd.inspectorWidth')); } catch { return 320; }
  });
  const [resizingInspector, setResizingInspector] = useState(false);
  const inspectorDrag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWorkspaceWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem('ezerd.inspectorWidth', String(inspectorWidth)); } catch { /* Optional preference. */ }
  }, [inspectorWidth]);
  const panelWidth = clampInspectorWidth(inspectorWidth, workspaceWidth);
  const panelBounds = inspectorBounds(workspaceWidth);
  const stackedInspector = workspaceWidth < 620;
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [connectedOpen, setConnectedOpen] = useState(true);
  const [domainName, setDomainName] = useState('');
  const [filterDomain, setFilterDomain] = useState('');
  const [relationSearch, setRelationSearch] = useState('');
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectPointer, setConnectPointer] = useState<{x:number; y:number} | null>(null);
  const [fkSource, setFkSource] = useState<string | null>(null);
  const [fkTarget, setFkTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ source: string | null; x: number; y: number } | null>(null);
  const blankPosition = useRef<{viewId:string; x:number; y:number} | null>(null);
  const contextCallback = useRef(onContextChange);
  contextCallback.current = onContextChange;
  useEffect(() => { try { localStorage.setItem('ezerd.inspector', inspectorOpen ? 'visible' : 'hidden'); } catch { /* Storage can be unavailable in private browsing. */ } }, [inspectorOpen]);
  const [requestedViewId, setViewId] = useState('overview'),
    [selected, setSelected] = useState<string | null>(null),
    [relationId, setRelationId] = useState('');
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [relationName, setRelationName] = useState(''),
    [direction, setDirection] = useState<'forward' | 'both'>('forward'),
    [relationDescription, setRelationDescription] = useState('');
  const viewId = validViewId(requestedViewId, doc.domains.map(d => d.id));
  const [localViewports, setLocalViewports] = useState<Record<string, {
    viewId: string;
    x: number;
    y: number;
    zoom: number;
  }>>({});
  const surface = useRef<HTMLDivElement>(null),
    live = useRef(doc);
  live.current = doc;
  const drag = useRef<{
    id: string | null;
    resize: boolean;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const viewport = (readOnly ? localViewports[viewId] : undefined) ?? doc.layout.viewports.find(v => v.viewId === viewId) ?? { viewId, x: 40, y: 40, zoom: 1 };
  const nodes = doc.layout.nodes.filter(n => {
    const table = (doc.tables ?? []).find(t => t.id === n.objectId);
    return n.viewId === viewId && (!table || isVisibleInView(table.scope,viewMode));
  }).map(node => {
    const kind = doc.domains.some(d => d.id === node.objectId) ? 'domain' : (doc.tables ?? []).some(t => t.id === node.objectId) ? 'table' : 'note';
    return {...node, ...cardSize(kind, node.width, node.height)};
  });
  const selectedNode = nodes.find(n => n.objectId === selected),
    domain = doc.domains.find(d => d.id === selected),
    note = doc.notes.find(n => n.id === selected);
  useEffect(() => {
    if (source && !doc.domains.some(d => d.id === source))
      setSource('');
    if (target && !doc.domains.some(d => d.id === target))
      setTarget('');
    if (relationId && !doc.domainRelations.some(r => r.id === relationId)) {
      setRelationId('');
      setRelationName('');
      setRelationDescription('');
    }
  }, [doc.domains, doc.domainRelations, source, target, relationId]);
  const table = (doc.tables ?? []).find(t => t.id === selected);
  useEffect(() => {
    contextCallback.current?.({viewId, selectedObjectId: selected, position: selectedNode ? {x:selectedNode.x+selectedNode.width/2, y:selectedNode.y+selectedNode.height/2} : blankPosition.current?.viewId === viewId ? blankPosition.current : position()});
  }, [viewId, selected, selectedNode?.x, selectedNode?.y, selectedNode?.width, selectedNode?.height]);
  useEffect(() => {
    if (!focusTarget) return;
    const destinationView = validViewId(focusTarget.viewId, doc.domains.map(d => d.id));
    setViewId(destinationView);
    setViewMode('both');
    setSelected(destinationView === focusTarget.viewId ? focusTarget.objectId : null);
    const node = doc.layout.nodes.find(n => n.viewId === focusTarget.viewId && n.objectId === focusTarget.objectId);
    const rect = surface.current?.getBoundingClientRect();
    const next = clampLayoutPatch({viewId:destinationView, zoom:1, x:(rect?.width ?? 800)/2 - (node?.x ?? 0) - focusTarget.x, y:(rect?.height ?? 600)/2 - (node?.y ?? 0) - focusTarget.y});
    if (readOnly) setLocalViewports(value => ({...value, [next.viewId]:next}));
    else change(setViewport(live.current, next));
  }, [focusTarget?.nonce]);
  const relatedIds = new Set(filterDomain ? [filterDomain, ...connectedRelations(doc.domainRelations, filterDomain).flatMap(r => [r.sourceDomainId, r.targetDomainId])] : doc.domains.map(d => d.id));
  const filteredRelations = doc.domainRelations.filter(r => (!filterDomain || r.sourceDomainId === filterDomain || r.targetDomainId === filterDomain) && [r.name, r.description, doc.domains.find(d => d.id === r.sourceDomainId)?.name, doc.domains.find(d => d.id === r.targetDomainId)?.name].join(' ').toLocaleLowerCase().includes(relationSearch.toLocaleLowerCase()));
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { setConnectSource(null); setConnectPointer(null); setFkSource(null); setFkTarget(null); } };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => {
    if (filterDomain && !doc.domains.some(d => d.id === filterDomain)) setFilterDomain('');
    if (connectSource && !doc.domains.some(d => d.id === connectSource)) setConnectSource(null);
  }, [doc.domains, filterDomain, connectSource]);
  const diagnostics = diagnoseDocument(doc);
  const activeDomain = doc.domains.find(d => d.id === viewId);
  function change(next: DesignDocument) {
    if (!readOnly)
      onChange(next);
  }
  function updateNodeLayout(document: DesignDocument, id: string, patch: Parameters<typeof modelUpdateNodeLayout>[2]) {
    const node = document.layout.nodes.find(n => n.id === id);
    if (node && (patch.width !== undefined || patch.height !== undefined)) {
      const kind = document.domains.some(d => d.id === node.objectId) ? 'domain' : (document.tables ?? []).some(t => t.id === node.objectId) ? 'table' : 'note';
      patch = {...patch, ...cardSize(kind, patch.width ?? node.width, patch.height ?? node.height)};
    }
    return modelUpdateNodeLayout(document, id, clampLayoutPatch(patch));
  }
  function moveViewport(next: typeof viewport) {
    next = clampLayoutPatch(next);
    if (viewportDestination(readOnly) === 'local')
      setLocalViewports(value => ({ ...value, [viewId]: next }));
    else
      change(setViewport(live.current, next));
  }
  function navigate(id: string) {
    setMenu(null);
    setConnectSource(null); setConnectPointer(null); setFkSource(null); setFkTarget(null);
    setViewId(id);
    setSelected(null);
  }
  function position() {
    const rect = surface.current?.getBoundingClientRect();
    return clampLayoutPatch({ x: ((rect?.width ?? 800) / 2 - viewport.x) / viewport.zoom - 120, y: ((rect?.height ?? 600) / 2 - viewport.y) / viewport.zoom - 70 });
  }
  function newDomain(name = '새 도메인', at?: {x:number; y:number}) {
    if (readOnly) return;
    const id = newId();
    change(addDomain(doc, { id, name, description: '', color: '#8993a3' }, at ?? position()));
    setSelected(id); setInspectorOpen(true); setDomainName(''); setMenu(null);
  }
  function newNote() {
    const id = newId();
    change(addNote(doc, { id, viewId, text: '업무 설명을 입력하세요.' }, position()));
    setSelected(id);
  }
  function zoom(value: number) {
    const next = Math.max(.25, Math.min(2, value));
    const rect = surface.current?.getBoundingClientRect();
    const cx = (rect?.width ?? 800) / 2,
      cy = (rect?.height ?? 600) / 2;
    moveViewport({ viewId, zoom: next, x: cx - (cx - viewport.x) * next / viewport.zoom, y: cy - (cy - viewport.y) * next / viewport.zoom });
  }
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoom(viewport.zoom * (event.deltaY > 0 ? .9 : 1.1));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [doc, readOnly, viewId, viewport.x, viewport.y, viewport.zoom]);
  function begin(e: PointerEvent<HTMLDivElement>, id: string | null, resize = false) {
    if (e.button !== 0)
      return;
    const node = nodes.find(n => n.id === id);
    if (!readOnly && node && connectSource) {
      e.stopPropagation();
      const destination = doc.domains.find(d => d.id === node.objectId);
      const origin = doc.domains.find(d => d.id === connectSource);
      if (origin && destination && origin.id !== destination.id) {
        const relation = {id:newId(), sourceDomainId:origin.id, targetDomainId:destination.id, name:(origin.name + ' → ' + destination.name).slice(0,120), direction:'forward' as const, description:''};
        change(upsertDomainRelation(doc, relation));
        setConnectSource(null); setConnectPointer(null); setSelected(destination.id); setConnectedOpen(true); setInspectorOpen(true);
      }
      return;
    }
    if (!readOnly && node && fkSource && !fkTarget && (doc.tables ?? []).some(t => t.id === node.objectId)) {
      e.stopPropagation(); setFkTarget(node.objectId); return;
    }
    if (node) {
      setSelected(node.objectId); if (doc.domains.some(d => d.id === node.objectId)) { setInspectorOpen(true); setConnectedOpen(true); }
    }
    else
      setSelected(null);
    setMenu(null);
    if (node && !resize && (e.target as HTMLElement).closest('.table-inline,[data-inline-edit]')) { e.stopPropagation(); return; }
    if (readOnly && id) { e.stopPropagation(); return; }
    if (!node) {
      const rect = surface.current?.getBoundingClientRect();
      blankPosition.current = {viewId, x:(e.clientX-(rect?.left ?? 0)-viewport.x)/viewport.zoom, y:(e.clientY-(rect?.top ?? 0)-viewport.y)/viewport.zoom};
      contextCallback.current?.({viewId, selectedObjectId:null, position:blankPosition.current});
    }
    drag.current = { id, resize, startX: e.clientX, startY: e.clientY, x: node?.x ?? viewport.x, y: node?.y ?? viewport.y, width: node?.width ?? 0, height: node?.height ?? 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (connectSource) {
      const rect = surface.current?.getBoundingClientRect();
      setConnectPointer({x:(e.clientX-(rect?.left ?? 0)-viewport.x)/viewport.zoom,y:(e.clientY-(rect?.top ?? 0)-viewport.y)/viewport.zoom});
    }
    const start = drag.current;
    if (!start)
      return;
    const dx = e.clientX - start.startX,
      dy = e.clientY - start.startY;
    if (start.id) {
      change(updateNodeLayout(live.current, start.id, start.resize ? { width: Math.max(160, start.width + dx / viewport.zoom), height: Math.max(110, start.height + dy / viewport.zoom) } : { x: start.x + dx / viewport.zoom, y: start.y + dy / viewport.zoom }));
    }
    else
      moveViewport({ ...viewport, x: start.x + dx, y: start.y + dy });
  }
  function finish() {
    drag.current = null;
  }
  function editRelation(id: string) {
    const relation = doc.domainRelations.find(r => r.id === id);
    if (!relation)
      return;
    setInspectorOpen(true);
    setRelationsOpen(true);
    setRelationId(id);
    setSource(relation.sourceDomainId);
    setTarget(relation.targetDomainId);
    setRelationName(relation.name);
    setDirection(relation.direction);
    setRelationDescription(relation.description);
    setSelected(null);
  }
  function resetRelation() {
    setRelationId('');
    setRelationName('');
    setRelationDescription('');
  }
  function startRelation(sourceId: string, targetId: string) {
    resetRelation();
    setSource(sourceId);
    setTarget(targetId);
    setDirection('forward');
    setSelected(null);
    setMenu(null);
    setInspectorOpen(true);
    setRelationsOpen(true);
    requestAnimationFrame(() => globalThis.document.querySelector<HTMLInputElement>('[aria-label="관계 이름"]')?.focus());
  }
  return <div ref={workspaceRef} style={{'--inspector-width': `${panelWidth}px`} as CSSProperties} className={`workspace ${inspectorOpen ? '' : 'inspector-hidden'} ${resizingInspector ? 'inspector-resizing' : ''} ${stackedInspector ? 'inspector-stacked' : ''}`}>
    <div className="canvas-column" key={viewId}>
      <div className="canvas-toolbar">
        <div className="breadcrumbs">
          <Button className={viewId === 'overview' ? 'current' : ''} onClick={() => navigate('overview')}>도메인 맵</Button>
          {activeDomain && <>
            <span>/</span>
            <strong>
              {activeDomain.name}
            </strong>
          </>}
        </div>
        <div className="actions">
          <IconButton className="inspector-toggle" aria-label={inspectorOpen ? '속성 패널 숨기기' : '속성 패널 열기'} title={inspectorOpen ? '속성 패널 숨기기' : '속성 패널 열기'} aria-expanded={inspectorOpen} aria-controls="canvas-inspector" onClick={() => setInspectorOpen(value => !value)}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="3" /><path className="sidebar-icon-divider" d="M12 4.5v11" /><path className="sidebar-icon-fill" d="M13 5h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1z" /></svg>
          </IconButton>
          {viewId === 'overview' && <Button disabled={readOnly} onClick={() => newDomain()}>＋ 도메인</Button>}
          <Button disabled={readOnly} onClick={newNote}>T 텍스트</Button>
        </div>
      </div>
      {viewId === 'overview' && filterDomain && <div className="domain-filter-status" role="status">{doc.domains.find(d => d.id === filterDomain)?.name} 연결 강조 <Button onClick={() => setFilterDomain('')}>강조 해제</Button></div>}
      {viewId !== 'overview' && <div className="table-view-mode"><label>표시 모드<Select aria-label="표시 모드" value={viewMode} onChange={e => setViewMode(e.target.value as typeof viewMode)}><option value="both">논리 + 물리</option><option value="logical">논리</option><option value="physical">물리</option></Select></label></div>}
      <div
        ref={surface}
        className={`canvas-surface ${connectSource || fkSource ? 'connection-target-mode' : ''}`}
        onContextMenu={e => {
          if ((e.target as HTMLElement).closest('.canvas-node, .relation, .table-relation-line, .zoom-controls')) return;
          e.preventDefault(); if (readOnly) return;
          const rect = e.currentTarget.getBoundingClientRect();
          blankPosition.current = {viewId, x:(e.clientX-rect.left-viewport.x)/viewport.zoom, y:(e.clientY-rect.top-viewport.y)/viewport.zoom};
          setSelected(null); setMenu({source:null,x:Math.max(8,Math.min(e.clientX,window.innerWidth-290)),y:Math.max(8,Math.min(e.clientY,window.innerHeight-220))});
        }}
        aria-label={viewId === 'overview' ? '도메인 맵 캔버스' : `${activeDomain?.name} 내부 캔버스`}
        onPointerDown={e => begin(e, null)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{ backgroundSize: `${40 * viewport.zoom}px ${40 * viewport.zoom}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundImage: `radial-gradient(circle, var(--erd-grid-dot-color) ${.75 * viewport.zoom}px, transparent ${.8 * viewport.zoom}px)` }}>
        <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {viewId === 'overview' && <svg className="relations" aria-label="도메인 관계">
            <defs>
              <marker
                id="arrow-end"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {doc.domainRelations.map(r => {
              const a = nodes.find(n => n.objectId === r.sourceDomainId),
                b = nodes.find(n => n.objectId === r.targetDomainId);
              if (!a || !b)
                return null;
              const ax = a.x + a.width / 2,
                ay = a.y + a.height / 2,
                bx = b.x + b.width / 2,
                by = b.y + b.height / 2,
                dx = bx - ax,
                dy = by - ay;
              const ratioA = Math.min(a.width / 2 / Math.max(Math.abs(dx), .001), a.height / 2 / Math.max(Math.abs(dy), .001)),
                ratioB = Math.min(b.width / 2 / Math.max(Math.abs(dx), .001), b.height / 2 / Math.max(Math.abs(dy), .001));
              const pair = doc.domainRelations.filter(item => [item.sourceDomainId,item.targetDomainId].sort().join('|') === [r.sourceDomainId,r.targetDomainId].sort().join('|'));
              const offset = (pair.findIndex(item => item.id === r.id) - (pair.length-1)/2) * 54;
              const length = Math.max(1, Math.hypot(dx,dy));
              const sign = r.sourceDomainId < r.targetDomainId ? 1 : -1;
              const cx = (ax+bx)/2 - dy/length*offset*sign;
              const cy = (ay+by)/2 + dx/length*offset*sign;
              return <g
                key={r.id}
                onPointerDown={e => e.stopPropagation()}
                onClick={() => editRelation(r.id)}
                className={`relation ${relationId === r.id ? 'selected' : ''} ${filterDomain && r.sourceDomainId !== filterDomain && r.targetDomainId !== filterDomain ? 'domain-dimmed' : ''}`}>
                <path
                  d={`M ${ax+dx*ratioA} ${ay+dy*ratioA} Q ${cx} ${cy} ${bx-dx*ratioB} ${by-dy*ratioB}`}
                  markerEnd="url(#arrow-end)"
                  markerStart={r.direction === 'both' ? 'url(#arrow-end)' : undefined} />
                <text
                  x={(ax+bx)/4+cx/2}
                  y={(ay+by)/4+cy/2-10}
                  textAnchor="middle">
                  {r.name}
                </text>
              </g>;
            })}
            {connectSource && connectPointer && (() => { const origin = nodes.find(n => n.objectId === connectSource); return origin ? <path className="domain-connection-preview" d={`M ${origin.x+origin.width/2} ${origin.y+origin.height/2} L ${connectPointer.x} ${connectPointer.y}`} markerEnd="url(#arrow-end)" /> : null; })()}
          </svg>}
          {viewId !== 'overview' && <svg className="relations" aria-label="테이블 관계" onPointerDown={e => e.stopPropagation()}><TableRelationsSvg document={doc} viewId={viewId} viewMode={viewMode} onChange={change} readOnly={readOnly} onSelect={(id: string) => {setSelected(id); setInspectorOpen(true);}} /></svg>}
          {nodes.map(node => {
            const d = doc.domains.find(v => v.id === node.objectId),
              n = doc.notes.find(v => v.id === node.objectId);
            const t = (doc.tables ?? []).find(v => v.id === node.objectId);
            if (!d && !n && !t)
              return null;
            return <div
              key={node.id}
              className={`canvas-node ${d ? 'domain-node' : t ? 'table-node' : 'note-node'} ${selected === node.objectId ? 'selected' : ''} ${d && filterDomain && !relatedIds.has(d.id) ? 'domain-dimmed' : ''} ${d && connectSource === d.id ? 'connection-source' : ''}`}
              style={{ left: node.x, top: node.y, ...cardSize(d ? 'domain' : t ? 'table' : 'note', node.width, node.height), ...(d ? {'--domain-color':d.color ?? '#8993a3'} : {}) } as CSSProperties}
              onPointerDown={e => begin(e, node.id)}
              onContextMenu={e => { if (!d || readOnly) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); setSelected(d.id); setMenu({source:d.id, x:Math.max(8,Math.min(e.clientX, window.innerWidth-290)), y:Math.max(8,Math.min(e.clientY, window.innerHeight-320))}); }}
              onDoubleClick={() => d && navigate(d.id)}
              tabIndex={0}
              role="group"
              aria-label={d?.name ?? t?.logical.name ?? '자유 텍스트'}
              onFocus={e => { if (e.target === e.currentTarget) setSelected(node.objectId); }}
              onKeyDown={e => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' && d) { navigate(d.id); return; }
                if (readOnly) return;
                if (d && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); setMenu({source:d.id,x:Math.max(8,Math.min(rect.left,window.innerWidth-290)),y:Math.max(8,Math.min(rect.top+40,window.innerHeight-320))}); return; }
                const delta = e.shiftKey ? 10 : 1;
                const offsets: Record<string, [
                  number,
                  number
                ]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
                const offset = offsets[e.key];
                if (offset) {
                  e.preventDefault();
                  change(updateNodeLayout(doc, node.id, { x: node.x + offset[0], y: node.y + offset[1] }));
                }

              }}>
              {d ? <>
                <span className="node-overline">DOMAIN</span>
                <h2>
                  {d.name}
                </h2>
                <p>
                  {d.description || '업무 영역을 설명해 주세요'}
                </p>
                <Button
                  className="enter-domain"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => navigate(d.id)}
                  aria-label={`${d.name} 도메인 열기`}>도메인 열기 ↗</Button>
              </> : t ? <TableNodeContent document={doc} tableId={t.id} viewMode={viewMode} viewId={viewId} onChange={change} readOnly={readOnly} onStartForeignKey={columnId => {setFkSource(columnId); setFkTarget(null); setMenu(null);}} /> : <p className="note-content">
                {n?.text}
              </p>}
              {!readOnly && <div
                className="resize-handle"
                title="크기 조절"
                onPointerDown={e => begin(e, node.id, true)} />}
            </div>;
          })}
          {pins}
        </div>
        {!nodes.length && <div className="canvas-empty">
          <span className="empty-symbol" aria-hidden="true">
            {viewId === 'overview' ? '◇' : '▦'}
          </span>
          <h2>
            {viewId === 'overview' ? '큰 그림부터 시작하세요' : '이 도메인의 구조를 준비하세요'}
          </h2>
          <p>
            {viewId === 'overview' ? '도메인을 만들고 업무의 흐름을 연결해 보세요.' : '테이블을 추가하고 컬럼과 관계를 설계하세요.'}
          </p>

          {viewId === 'overview' && <Button
            variant="primary" className="primary"
            disabled={readOnly}
            onPointerDown={e => e.stopPropagation()}
            onClick={() => newDomain()}>첫 도메인 만들기</Button>}
        </div>}
        <div className="canvas-hint" role={connectSource || fkSource ? 'status' : undefined}>{connectSource ? '연결할 도메인을 클릭하세요 · Escape 취소' : fkSource ? '참조할 테이블을 클릭하세요 · Escape 취소' : '드래그로 이동 · 우클릭으로 자동 배치'}</div>
        <div className="zoom-controls" onPointerDown={e => e.stopPropagation()}>
          <IconButton aria-label="축소" onClick={() => zoom(viewport.zoom - .1)}>−</IconButton>
          <Button onClick={() => zoom(1)} aria-label="배율 100%로 초기화">
            {Math.round(viewport.zoom * 100)}%</Button>
          <IconButton aria-label="확대" onClick={() => zoom(viewport.zoom + .1)}>＋</IconButton>
        </div>
      </div>
    </div>
    {fkSource && fkTarget && <ForeignKeyDialog document={doc} sourceColumnId={fkSource} targetTableId={fkTarget} onChange={change} onClose={() => {setFkSource(null);setFkTarget(null);}} />}
    <ContextMenu position={menu ? {x: menu.x, y: menu.y} : null} label={menu?.source ? '도메인 관계 설정' : '캔버스 메뉴'} onClose={() => setMenu(null)} items={menu ? menu.source ? [
      {id:'panel-relation',label:'새 도메인 관계',onAction:() => startRelation(menu.source!, '')},
      {id:'direct-relation',label:'도메인 직접 연결',disabled:doc.domains.length<2,onAction:() => {setConnectSource(menu.source);setConnectPointer(null);setMenu(null);}},
      {id:'filter',label:'연결된 도메인 강조',onAction:() => {setFilterDomain(menu.source!);setMenu(null);}},
    ] : [
      ...(viewId === 'overview' ? [{id:'new-domain',label:'새 도메인 생성',onAction:() => newDomain('새 도메인', blankPosition.current?.viewId === viewId ? blankPosition.current : undefined)}, {id:'new-relation',label:'새 도메인 관계',onAction:() => startRelation('', '')}] : []),
      {id:'auto-layout',label:'자동 배치',disabled:!nodes.length,onAction:() => {change(autoLayoutView(doc, viewId));setMenu(null);}},
    ] : []} />
    <div className="inspector-shell" inert={!inspectorOpen} aria-hidden={!inspectorOpen}>
      <div className="inspector-resizer" role="separator" aria-label="속성 패널 너비 조절" aria-orientation="vertical" aria-valuemin={panelBounds.min} aria-valuemax={panelBounds.max} aria-valuenow={Math.round(panelWidth)} tabIndex={inspectorOpen && !stackedInspector ? 0 : -1}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          inspectorDrag.current = {x: e.clientX, width: panelWidth};
          setResizingInspector(true);
        }}
        onPointerMove={e => {
          const current = inspectorDrag.current;
          if (current) setInspectorWidth(clampInspectorWidth(current.width + current.x - e.clientX, workspaceWidth));
        }}
        onPointerUp={e => { inspectorDrag.current = null; setResizingInspector(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { inspectorDrag.current = null; setResizingInspector(false); }}
        onLostPointerCapture={() => { inspectorDrag.current = null; setResizingInspector(false); }}
        onKeyDown={e => {
          const next = e.key === 'Home' ? panelBounds.min : e.key === 'End' ? panelBounds.max : e.key === 'ArrowLeft' ? panelWidth + (e.shiftKey ? 40 : 10) : e.key === 'ArrowRight' ? panelWidth - (e.shiftKey ? 40 : 10) : null;
          if (next !== null) { e.preventDefault(); setInspectorWidth(clampInspectorWidth(next, workspaceWidth)); }
        }} />
      <aside id="canvas-inspector" className="inspector">
      {diagnostics.length > 0 && <div className="document-diagnostics" role="status">
        <h3>설계 확인 {diagnostics.length}건</h3>
        <p>저장은 가능하지만 아래 항목을 확인해 주세요.</p>
        <ul>
          {diagnostics.map((item, index) => <li key={`${item.code}-${item.objectId}-${index}`}>
            {item.message}
          </li>)}
        </ul>
      </div>}
      <div className="inspector-heading">
        <span>02 / INSPECTOR</span>
        <h2>
          {selected ? '선택 항목' : viewId === 'overview' ? '도메인 관계' : '속성'}
        </h2>
      </div>
      {table ? <>
        {selectedNode && table.domainId !== viewId && <Button variant="danger" className="danger" disabled={readOnly} onClick={() => {
          change(removeTableReference(doc, selectedNode.id));
          setSelected(null);
        }}>이 화면의 참조 제거</Button>}
        <TableInspector document={doc} tableId={table.id} onChange={change} readOnly={readOnly} onStartForeignKey={columnId => {setFkSource(columnId);setFkTarget(null);}} />
      </> : selectedNode && (domain || note) ? <div className="inspector-fields">
        {domain ? <>
          <label>도메인 이름<Input
            value={domain.name}
            maxLength={120}
            disabled={readOnly}
            onChange={e => change(updateDomain(doc, domain.id, { name: e.target.value }))} />
          </label>
          <label>업무 설명<Textarea
            maxLength={10000}
            value={domain.description}
            disabled={readOnly}
            onChange={e => change(updateDomain(doc, domain.id, { description: e.target.value }))} />
          </label>
        {domain && <div className="relation-list"><DisclosureButton className="relation-disclosure" expanded={connectedOpen} controls="selected-domain-relations" onClick={() => setConnectedOpen(value => !value)}>연결된 도메인 관계 <span className="relation-count">{connectedRelations(doc.domainRelations,domain.id).length}</span></DisclosureButton><Collapse id="selected-domain-relations" open={connectedOpen}>
          {connectedRelations(doc.domainRelations,domain.id).map(r => <Button key={r.id} onClick={() => editRelation(r.id)}>{r.name}<small>{doc.domains.find(d => d.id === r.sourceDomainId)?.name} {r.direction === 'both' ? '↔' : '→'} {doc.domains.find(d => d.id === r.targetDomainId)?.name}</small></Button>)}
          {!connectedRelations(doc.domainRelations,domain.id).length && <p className="field-help">연결된 관계가 없습니다. 카드에서 우클릭해 연결하세요.</p>}
        </Collapse></div>}
          <label>도메인 색상<Input type="color" value={domain.color ?? '#8993a3'} disabled={readOnly} onChange={e => change(updateDomain(doc, domain.id, {color:e.target.value}))} /></label>
          <Button onClick={() => navigate(domain.id)}>도메인 내부 열기 →</Button>
          <Button disabled={readOnly} onClick={() => startRelation(domain.id, '')}>새 도메인 관계</Button>
        </> : <label>자유 텍스트<Textarea
          maxLength={20000}
          value={note?.text ?? ''}
          disabled={readOnly}
          onChange={e => note && change(updateNote(doc, note.id, e.target.value))} />
        </label>}
        <div className="dimensions">
          {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>
            {({ x: 'X', y: 'Y', width: '너비', height: '높이' })[key]}
            <Input
              type="number"
              min={key === 'x' || key === 'y' ? -10000000 : cardSize(domain ? 'domain' : 'note',0,0)[key]}
              max={key === 'x' || key === 'y' ? 10000000 : 10000}
              value={Math.round(selectedNode[key])}
              disabled={readOnly}
              onChange={e => {
                const number = Number(e.target.value);
                if (Number.isFinite(number) && (key === 'x' || key === 'y' || number >= 40))
                  change(updateNodeLayout(doc, selectedNode.id, { [key]: number }));
              }} />
          </label>)}
        </div>
        <Button
          variant="danger" className="danger"
          disabled={readOnly}
          onClick={() => {
            if (!window.confirm(domain ? '도메인과 연결된 업무 관계·내부 테이블·텍스트를 삭제할까요?' : '이 텍스트를 삭제할까요?'))
              return;
            change(domain ? removeDomain(doc, domain.id) : removeNote(doc, note!.id));
            setSelected(null);
          }}>선택 항목 삭제</Button>
        <Button onClick={() => setSelected(null)}>선택 해제</Button>

      </div> : viewId === 'overview' ? <>
        <Accordion title="새 도메인 생성" className="domain-panel-section"><form className="inspector-fields" onSubmit={e => {e.preventDefault(); if (domainName.trim()) newDomain(domainName.trim());}}><label>새 도메인 이름<Input value={domainName} onChange={e => setDomainName(e.target.value)} maxLength={120} disabled={readOnly} required /></label><Button type="submit" variant="primary" disabled={readOnly || !domainName.trim()}>도메인 생성</Button></form></Accordion>
        <DisclosureButton className="relation-disclosure domain-panel-heading" expanded={relationsOpen} controls="business-relations" onClick={() => setRelationsOpen(value => !value)}>{relationId ? '도메인 관계 수정' : '새 도메인 관계 생성'}</DisclosureButton>
        <Collapse id="business-relations" open={relationsOpen}><form className="inspector-fields relation-form" onSubmit={e => {
          e.preventDefault();
          if (!doc.domains.some(d => d.id === source) || !doc.domains.some(d => d.id === target) || source === target)
            return;
          change(upsertDomainRelation(doc, { id: relationId || newId(), sourceDomainId: source, targetDomainId: target, name: relationName.trim(), direction, description: relationDescription }));
          resetRelation();
        }}>
          <p className="field-help">도메인 사이의 업무 흐름을 연결합니다.</p>
          <div className="relation-endpoints"><label>출발 도메인<Select
            aria-label="출발 도메인"
            required
            value={source}
            disabled={readOnly}
            onChange={e => setSource(e.target.value)}>
            <option value="">도메인 선택</option>
            {doc.domains.map(d => <option key={d.id} value={d.id}>
              {d.name}
            </option>)}
          </Select>
          </label>
          <label>도착 도메인<Select
            aria-label="도착 도메인"
            required
            value={target}
            disabled={readOnly}
            onChange={e => setTarget(e.target.value)}>
            <option value="">도메인 선택</option>
            {doc.domains.map(d => <option key={d.id} value={d.id}>
              {d.name}
            </option>)}
          </Select>
          </label>
          </div><label>관계 이름<Input aria-label="관계 이름"
            required
            maxLength={120}
            value={relationName}
            placeholder="예: 결제 요청"
            disabled={readOnly}
            onChange={e => setRelationName(e.target.value)} />
          </label>
          <label>방향<Select
            aria-label="방향"
            value={direction}
            disabled={readOnly}
            onChange={e => setDirection(e.target.value as 'forward' | 'both')}>
            <option value="forward">출발 → 도착</option>
            <option value="both">출발 ↔ 도착</option>
          </Select>
          </label>
          <label>설명<Textarea
            maxLength={10000}
            value={relationDescription}
            disabled={readOnly}
            onChange={e => setRelationDescription(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" className="primary" disabled={readOnly || !source || !target || source === target || !relationName.trim()}>
            {relationId ? '관계 수정' : '관계 연결'}
          </Button>
          {relationId && <div className="actions">
            <Button
              type="button"
              variant="danger" className="danger"
              disabled={readOnly}
              onClick={() => {
                change(removeDomainRelation(doc, relationId));
                resetRelation();
              }}>관계 삭제</Button>
            <Button type="button" onClick={resetRelation}>취소</Button>
          </div>}
        </form>
        </Collapse>
        <Accordion title="연결된 관계 검색" className="domain-panel-section"><div className="inspector-fields"><label>관계 검색<Input placeholder="관계 이름, 도메인, 설명 검색" value={relationSearch} onChange={e => setRelationSearch(e.target.value)} /></label><label>연결된 도메인 강조<Select value={filterDomain} onChange={e => setFilterDomain(e.target.value)}><option value="">모든 도메인</option>{doc.domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></label></div></Accordion>
        <Accordion title={`도메인 관계 목록 (${filteredRelations.length})`} className="domain-panel-section"><div className="relation-list">
          <h3>연결된 관계 <span>
            {doc.domainRelations.length}
          </span>
          </h3>
          {filteredRelations.map(r => <Button key={r.id} onClick={() => editRelation(r.id)}>
            {r.name}
            <small>
              {doc.domains.find(d => d.id === r.sourceDomainId)?.name} {r.direction === 'both' ? '↔' : '→'} {doc.domains.find(d => d.id === r.targetDomainId)?.name}
            </small>
          </Button>)}
          {!filteredRelations.length && <p className="field-help">표시할 관계가 없습니다.</p>}
        </div></Accordion>
      </> : <TableWorkspaceTools hideViewMode document={doc} viewId={viewId} viewMode={viewMode} onViewModeChange={setViewMode} onChange={change} readOnly={readOnly} position={position()} onSelect={setSelected} />}
    </aside></div>
  </div>;
}

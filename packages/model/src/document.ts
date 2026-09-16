export type ModelScope = 'both' | 'logical' | 'physical';
export type ViewMode = ModelScope;
export interface CustomProperties {
  common: Record<string, string>;
  logical: Record<string, string>;
  physical: Record<string, string>;
}
export interface Table {
  canvasDisplay?:
    { showNullable?: boolean | undefined; showComment?: boolean | undefined } | undefined;
  id: string;
  domainId: string;
  scope: ModelScope;
  logical: { name: string; definition: string };
  physical: { name: string; schema: string; comment: string };
  customProperties: CustomProperties;
}
export interface ProjectEnum {
  id: string;
  name: string;
  schema: string;
  values: string[];
}
export interface RelationCardinality {
  min: 0 | 1;
  max: 1 | 'many';
}
export interface Column {
  id: string;
  tableId: string;
  scope: ModelScope;
  logical: { name: string; definition: string; semanticType: string; required: boolean };
  physical: {
    name: string;
    type: {
      name: string;
      enumId?: string | undefined;
      length?: number | undefined;
      precision?: number | undefined;
      scale?: number | undefined;
      isArray: boolean;
    };
    nullable: boolean;
    defaultExpression: string | null;
    comment: string;
  };
  customProperties: CustomProperties;
}
export interface TableKey {
  id: string;
  tableId: string;
  scope: ModelScope;
  kind: 'primary' | 'unique';
  name: string;
  columnIds: string[];
}
export type ReferentialAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
export interface TableRelation {
  id: string;
  sourceTableId: string;
  targetTableId: string;
  scope: ModelScope;
  logical: {
    name: string;
    cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
    required: boolean;
    description?: string | undefined;
    sourceCardinality?: RelationCardinality | undefined;
    targetCardinality?: RelationCardinality | undefined;
  };
  physical: null | {
    name: string;
    sourceColumnIds: string[];
    targetColumnIds: string[];
    onDelete: ReferentialAction;
    onUpdate: ReferentialAction;
  };
}
export interface Domain {
  id: string;
  name: string;
  description: string;
  color?: string | undefined;
}
export interface DomainRelation {
  id: string;
  sourceDomainId: string;
  targetDomainId: string;
  name: string;
  direction: 'forward' | 'both';
  description: string;
}
export interface Note {
  id: string;
  viewId: string;
  text: string;
  color?: string | undefined;
}
export interface Position {
  x: number;
  y: number;
}
export interface NodeLayout extends Position {
  id: string;
  objectId: string;
  viewId: string;
  width: number;
  height: number;
}
export interface Viewport extends Position {
  viewId: string;
  zoom: number;
}
export interface CombinedView {
  id: string;
  name: string;
  domainIds: string[];
}
export interface RelationAnchor {
  side: 'left' | 'right' | 'top' | 'bottom';
  ratio: number;
}
export interface RelationLayout {
  relationId: string;
  viewId: string;
  offset: number;
  bend?: Position | undefined;
  sourceAnchor?: RelationAnchor | undefined;
  targetAnchor?: RelationAnchor | undefined;
  waypoints?: Position[] | undefined;
}
export interface DesignDocument {
  views?: CombinedView[] | undefined;
  schemaVersion: 1;
  domains: Domain[];
  domainRelations: DomainRelation[];
  notes: Note[];
  enums?: ProjectEnum[] | undefined;
  tables?: Table[] | undefined;
  columns?: Column[] | undefined;
  keys?: TableKey[] | undefined;
  tableRelations?: TableRelation[] | undefined;
  layout: { nodes: NodeLayout[]; viewports: Viewport[]; relations?: RelationLayout[] | undefined };
}
export function createEmptyDocument(): DesignDocument {
  return {
    schemaVersion: 1,
    domains: [],
    domainRelations: [],
    notes: [],
    layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
  };
}
function requireObject(found: unknown): asserts found {
  if (!found) throw new Error('대상을 찾을 수 없습니다.');
}
function requireView(doc: DesignDocument, viewId: string) {
  requireObject(
    viewId === 'overview' ||
      doc.domains.some((d) => d.id === viewId) ||
      doc.views?.some((v) => v.id === viewId),
  );
}
function requireNewId(doc: DesignDocument, id: string) {
  if (
    !id.trim() ||
    id.length > 160 ||
    id === 'overview' ||
    [
      ...doc.domains,
      ...(doc.views ?? []),
      ...doc.notes,
      ...doc.domainRelations,
      ...(doc.tables ?? []),
      ...(doc.columns ?? []),
      ...(doc.keys ?? []),
      ...(doc.tableRelations ?? []),
      ...(doc.enums ?? []),
    ].some((o) => o.id === id)
  )
    throw new Error('객체 ID는 고유해야 합니다.');
}
function position(value: Position) {
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    Math.abs(value.x) > 1e7 ||
    Math.abs(value.y) > 1e7
  )
    throw new Error('좌표가 유효하지 않습니다.');
}
function attachNode(
  doc: DesignDocument,
  objectId: string,
  viewId: string,
  point: Position,
  height: number,
): DesignDocument {
  position(point);
  return {
    ...doc,
    layout: {
      ...doc.layout,
      nodes: [
        ...doc.layout.nodes,
        { id: `node:${objectId}`, objectId, viewId, ...point, width: 240, height },
      ],
    },
  };
}
export function addDomain(doc: DesignDocument, domain: Domain, point: Position): DesignDocument {
  requireNewId(doc, domain.id);
  return attachNode(
    { ...doc, domains: [...doc.domains, { ...domain }] },
    domain.id,
    'overview',
    point,
    140,
  );
}
export function updateDomain(
  doc: DesignDocument,
  id: string,
  patch: Partial<Pick<Domain, 'name' | 'description' | 'color'>>,
): DesignDocument {
  requireObject(doc.domains.find((d) => d.id === id));
  return { ...doc, domains: doc.domains.map((d) => (d.id === id ? { ...d, ...patch, id } : d)) };
}
export function removeDomain(doc: DesignDocument, id: string): DesignDocument {
  for (const table of doc.tables ?? []) if (table.domainId === id) doc = removeTable(doc, table.id);
  for (const view of doc.views ?? []) {
    if (!view.domainIds.includes(id)) continue;
    const remaining = view.domainIds.filter((domainId) => domainId !== id);
    doc = remaining.length
      ? upsertCombinedView(doc, { ...view, domainIds: remaining })
      : removeCombinedView(doc, view.id);
  }
  const removedNotes = new Set(doc.notes.filter((n) => n.viewId === id).map((n) => n.id));
  return {
    ...doc,
    domains: doc.domains.filter((d) => d.id !== id),
    domainRelations: doc.domainRelations.filter(
      (r) => r.sourceDomainId !== id && r.targetDomainId !== id,
    ),
    notes: doc.notes.filter((n) => n.viewId !== id),
    layout: {
      ...doc.layout,
      ...(doc.layout.relations && {
        relations: doc.layout.relations.filter((r) => r.viewId !== id),
      }),
      nodes: doc.layout.nodes.filter(
        (n) => n.objectId !== id && n.viewId !== id && !removedNotes.has(n.objectId),
      ),
      viewports: doc.layout.viewports.filter((v) => v.viewId !== id),
    },
  };
}
export function upsertDomainRelation(
  doc: DesignDocument,
  relation: DomainRelation,
): DesignDocument {
  requireObject(doc.domains.find((d) => d.id === relation.sourceDomainId));
  requireObject(doc.domains.find((d) => d.id === relation.targetDomainId));
  const exists = doc.domainRelations.some((r) => r.id === relation.id);
  if (!exists) requireNewId(doc, relation.id);
  return {
    ...doc,
    domainRelations: exists
      ? doc.domainRelations.map((r) => (r.id === relation.id ? { ...relation } : r))
      : [...doc.domainRelations, { ...relation }],
  };
}
export function removeDomainRelation(doc: DesignDocument, id: string): DesignDocument {
  return { ...doc, domainRelations: doc.domainRelations.filter((r) => r.id !== id) };
}
export function addNote(doc: DesignDocument, note: Note, point: Position): DesignDocument {
  requireNewId(doc, note.id);
  requireView(doc, note.viewId);
  return attachNode(
    { ...doc, notes: [...doc.notes, { ...note }] },
    note.id,
    note.viewId,
    point,
    160,
  );
}
export function updateNote(
  doc: DesignDocument,
  id: string,
  value: string | Partial<Pick<Note, 'text' | 'color'>>,
): DesignDocument {
  requireObject(doc.notes.find((n) => n.id === id));
  const patch = typeof value === 'string' ? { text: value } : value;
  if (patch.color !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.color))
    throw new Error('메모 색상을 확인하세요.');
  return { ...doc, notes: doc.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}
export function removeNote(doc: DesignDocument, id: string): DesignDocument {
  return {
    ...doc,
    notes: doc.notes.filter((n) => n.id !== id),
    layout: { ...doc.layout, nodes: doc.layout.nodes.filter((n) => n.objectId !== id) },
  };
}
export function updateNodeLayout(
  doc: DesignDocument,
  id: string,
  patch: Partial<Pick<NodeLayout, 'x' | 'y' | 'width' | 'height'>>,
): DesignDocument {
  const node = doc.layout.nodes.find((n) => n.id === id);
  requireObject(node);
  const next = { ...node, ...patch, id };
  position(next);
  if (![next.width, next.height].every((n) => Number.isFinite(n) && n > 0 && n <= 10000))
    throw new Error('크기가 유효하지 않습니다.');
  return {
    ...doc,
    layout: { ...doc.layout, nodes: doc.layout.nodes.map((n) => (n.id === id ? next : n)) },
  };
}
export function setViewport(doc: DesignDocument, viewport: Viewport): DesignDocument {
  requireView(doc, viewport.viewId);
  position(viewport);
  if (!Number.isFinite(viewport.zoom) || viewport.zoom < 0.1 || viewport.zoom > 4)
    throw new Error('확대율이 유효하지 않습니다.');
  const exists = doc.layout.viewports.some((v) => v.viewId === viewport.viewId);
  return {
    ...doc,
    layout: {
      ...doc.layout,
      viewports: exists
        ? doc.layout.viewports.map((v) => (v.viewId === viewport.viewId ? { ...viewport } : v))
        : [...doc.layout.viewports, { ...viewport }],
    },
  };
}

export interface DocumentDiagnostic {
  code: string;
  objectId: string;
  message: string;
}
/** Incomplete references are persisted as drafts and diagnosed separately. */
export function diagnoseDocument(doc: DesignDocument): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const report = (code: string, objectId: string, message: string) =>
    diagnostics.push({ code, objectId, message });
  const domains = new Set(doc.domains.map((domain) => domain.id));
  const tables = new Map((doc.tables ?? []).map((table) => [table.id, table]));
  const columns = new Map((doc.columns ?? []).map((column) => [column.id, column]));
  const objects = new Map([
    ...doc.domains.map((domain) => [domain.id, 'overview'] as const),
    ...doc.notes.map((note) => [note.id, note.viewId] as const),
    ...(doc.tables ?? []).map((table) => [table.id, table.domainId] as const),
  ]);
  const validView = (id: string) =>
    id === 'overview' || domains.has(id) || !!doc.views?.some((v) => v.id === id);
  for (const view of doc.views ?? [])
    if (!view.domainIds.length || view.domainIds.some((id) => !domains.has(id)))
      report('missing-view-domain', view.id, '함께 보기의 도메인을 찾을 수 없습니다.');
  const scopeConflict = (child: ModelScope, parent: ModelScope) =>
    parent !== 'both' && child !== parent;
  const seen = new Set<string>();
  for (const object of [
    ...doc.domains,
    ...(doc.views ?? []),
    ...doc.notes,
    ...doc.domainRelations,
    ...(doc.tables ?? []),
    ...(doc.columns ?? []),
    ...(doc.keys ?? []),
    ...(doc.tableRelations ?? []),
    ...(doc.enums ?? []),
  ]) {
    if (seen.has(object.id) || !object.id.trim() || object.id === 'overview')
      report('duplicate-id', object.id, '객체 ID가 비어 있거나 중복되었습니다.');
    seen.add(object.id);
  }
  for (const domain of doc.domains) {
    if (domain.color !== undefined && !/^#[0-9a-f]{6}$/i.test(domain.color))
      report('invalid-domain-color', domain.id, '도메인 색상은 #RRGGBB 형식이어야 합니다.');
  }
  for (const relation of doc.domainRelations) {
    if (!domains.has(relation.sourceDomainId) || !domains.has(relation.targetDomainId))
      report('missing-domain', relation.id, '관계의 도메인을 찾을 수 없습니다.');
  }
  for (const note of doc.notes)
    if (!validView(note.viewId))
      report('missing-view', note.id, '텍스트의 화면을 찾을 수 없습니다.');
  const placements = new Set<string>();
  const nodeIds = new Set<string>();
  for (const node of doc.layout.nodes) {
    const pair = JSON.stringify([node.objectId, node.viewId]);
    const tablePlacement =
      tables.has(node.objectId) &&
      (domains.has(node.viewId) ||
        !!doc.views?.some(
          (v) => v.id === node.viewId && v.domainIds.includes(tables.get(node.objectId)!.domainId),
        ));
    if (
      !objects.has(node.objectId) ||
      (!tablePlacement && objects.get(node.objectId) !== node.viewId)
    )
      report('invalid-layout-target', node.objectId, '배치 대상 또는 화면이 일치하지 않습니다.');
    if (placements.has(pair) || nodeIds.has(node.id))
      report('duplicate-layout', node.objectId, '같은 화면에 객체 배치가 중복되었습니다.');
    placements.add(pair);
    nodeIds.add(node.id);
  }
  for (const [id, viewId] of objects) {
    if (!placements.has(JSON.stringify([id, viewId])))
      report('missing-layout', id, '객체의 화면 배치가 없습니다.');
  }
  for (const viewport of doc.layout.viewports)
    if (!validView(viewport.viewId))
      report('missing-viewport-domain', viewport.viewId, '화면 위치의 도메인을 찾을 수 없습니다.');
  for (const table of tables.values()) {
    if (!domains.has(table.domainId))
      report('missing-table-domain', table.id, '테이블의 소유 도메인을 찾을 수 없습니다.');
  }
  for (const column of columns.values()) {
    const table = tables.get(column.tableId);
    if (!table) report('missing-column-table', column.id, '컬럼의 테이블을 찾을 수 없습니다.');
    else if (scopeConflict(column.scope, table.scope))
      report('scope-conflict', column.id, '컬럼의 모델 범위가 테이블 범위를 벗어납니다.');
  }
  for (const column of columns.values()) {
    if (
      column.physical.type.enumId &&
      !doc.enums?.some((item) => item.id === column.physical.type.enumId)
    )
      report('missing-enum', column.id, '컬럼의 ENUM 정의를 찾을 수 없습니다.');
  }
  const primaryTables = new Set<string>();
  for (const key of doc.keys ?? []) {
    const table = tables.get(key.tableId);
    if (!table) report('missing-key-table', key.id, '키의 테이블을 찾을 수 없습니다.');
    else if (scopeConflict(key.scope, table.scope))
      report('scope-conflict', key.id, '키의 모델 범위가 테이블 범위를 벗어납니다.');
    if (!key.columnIds.length) report('empty-key', key.id, '키에 컬럼을 추가해 주세요.');
    if (new Set(key.columnIds).size !== key.columnIds.length)
      report('duplicate-key-column', key.id, '키의 컬럼이 중복되었습니다.');
    if (key.kind === 'primary') {
      if (primaryTables.has(key.tableId))
        report('multiple-primary-keys', key.id, '테이블에는 기본 키를 하나만 설정할 수 있습니다.');
      primaryTables.add(key.tableId);
    }
    for (const id of key.columnIds) {
      const column = columns.get(id);
      if (!column || column.tableId !== key.tableId)
        report('missing-key-column', key.id, '키의 컬럼이 테이블에 존재하지 않습니다.');
      else if (scopeConflict(key.scope, column.scope))
        report('scope-conflict', key.id, '키의 모델 범위가 컬럼 범위를 벗어납니다.');
    }
  }
  for (const relation of doc.tableRelations ?? []) {
    const source = tables.get(relation.sourceTableId);
    const target = tables.get(relation.targetTableId);
    if (!source || !target)
      report('missing-relation-table', relation.id, '관계의 테이블을 찾을 수 없습니다.');
    else if (
      scopeConflict(relation.scope, source.scope) ||
      scopeConflict(relation.scope, target.scope)
    )
      report('scope-conflict', relation.id, '관계의 모델 범위가 연결된 테이블 범위를 벗어납니다.');
    const physical = relation.physical;
    if (!physical) continue;
    if (relation.scope === 'logical')
      report(
        'logical-relation-fk',
        relation.id,
        '논리 전용 관계에는 물리 외래 키를 지정할 수 없습니다.',
      );
    if (
      !physical.sourceColumnIds.length ||
      physical.sourceColumnIds.length !== physical.targetColumnIds.length
    )
      report('invalid-fk-arity', relation.id, '외래 키 양쪽에 같은 수의 컬럼을 지정해 주세요.');
    for (const [ids, tableId] of [
      [physical.sourceColumnIds, relation.sourceTableId],
      [physical.targetColumnIds, relation.targetTableId],
    ] as const) {
      if (new Set(ids).size !== ids.length)
        report('duplicate-fk-column', relation.id, '외래 키 컬럼이 중복되었습니다.');
      for (const id of ids) {
        const column = columns.get(id);
        if (!column || column.tableId !== tableId)
          report(
            'missing-relation-column',
            relation.id,
            '외래 키 컬럼이 연결된 테이블에 존재하지 않습니다.',
          );
        else if (column.scope === 'logical')
          report('scope-conflict', relation.id, '외래 키는 물리 모델의 컬럼만 참조할 수 있습니다.');
      }
    }
    const targetKey = (doc.keys ?? []).some(
      (key) =>
        key.tableId === relation.targetTableId &&
        key.scope !== 'logical' &&
        key.columnIds.length === physical.targetColumnIds.length &&
        key.columnIds.every((id, index) => id === physical.targetColumnIds[index]),
    );
    if (!targetKey)
      report(
        'missing-reference-key',
        relation.id,
        '외래 키의 대상 컬럼에 기본 키 또는 고유 키가 필요합니다.',
      );
  }
  for (const route of doc.layout.relations ?? []) {
    const relation = doc.tableRelations?.find((r) => r.id === route.relationId);
    if (
      !validView(route.viewId) ||
      !relation ||
      ![relation.sourceTableId, relation.targetTableId].every((id) =>
        doc.layout.nodes.some((n) => n.objectId === id && n.viewId === route.viewId),
      )
    )
      report(
        'invalid-relation-layout',
        route.relationId,
        '관계 경로의 화면 또는 테이블을 찾을 수 없습니다.',
      );
  }
  return diagnostics;
}

/** Each placement points to one shared table identity; references never clone its model. */
export function addTableReference(
  doc: DesignDocument,
  tableId: string,
  viewId: string,
  point: Position,
): DesignDocument {
  requireObject(doc.tables?.find((table) => table.id === tableId));
  requireView(doc, viewId);
  if (
    viewId === 'overview' ||
    doc.views?.some(
      (v) =>
        v.id === viewId &&
        !v.domainIds.includes(doc.tables!.find((t) => t.id === tableId)!.domainId),
    )
  )
    throw new Error('이 테이블은 선택한 도메인에 속하지 않습니다.');
  position(point);
  if (doc.layout.nodes.some((node) => node.objectId === tableId && node.viewId === viewId)) {
    throw new Error('이 화면에 이미 배치된 테이블입니다.');
  }
  return {
    ...doc,
    layout: {
      ...doc.layout,
      nodes: [
        ...doc.layout.nodes,
        {
          id: `node:${tableId}:${viewId}`,
          objectId: tableId,
          viewId,
          x: point.x,
          y: point.y,
          width: 320,
          height: 260,
        },
      ],
    },
  };
}

export function removeTableReference(doc: DesignDocument, nodeId: string): DesignDocument {
  const node = doc.layout.nodes.find((item) => item.id === nodeId);
  requireObject(node);
  const table = doc.tables?.find((item) => item.id === node.objectId);
  requireObject(table);
  if (table.domainId === node.viewId)
    throw new Error('소유 화면의 테이블은 테이블 삭제로 제거해 주세요.');
  return {
    ...doc,
    layout: {
      ...doc.layout,
      nodes: doc.layout.nodes.filter((item) => item.id !== nodeId),
      ...(doc.layout.relations && {
        relations: doc.layout.relations.filter(
          (route) =>
            route.viewId !== node.viewId ||
            !doc.tableRelations?.some(
              (relation) =>
                relation.id === route.relationId &&
                (relation.sourceTableId === table.id || relation.targetTableId === table.id),
            ),
        ),
      }),
    },
  };
}

export function addTable(doc: DesignDocument, table: Table, point: Position): DesignDocument {
  requireNewId(doc, table.id);
  requireObject(doc.domains.find((domain) => domain.id === table.domainId));
  let next = addTableReference(
    { ...doc, tables: [...(doc.tables ?? []), cloneModel(table)] },
    table.id,
    table.domainId,
    point,
  );
  for (const view of next.views ?? [])
    if (view.domainIds.includes(table.domainId)) next = upsertCombinedView(next, view);
  return next;
}

export function updateTable(
  doc: DesignDocument,
  id: string,
  patch: Partial<Omit<Table, 'id'>>,
): DesignDocument {
  const current = doc.tables?.find((table) => table.id === id);
  requireObject(current);
  const next = { ...current, ...cloneModel(patch), id };
  requireObject(doc.domains.find((domain) => domain.id === next.domainId));
  let updated = { ...doc, tables: doc.tables!.map((table) => (table.id === id ? next : table)) };
  // Moving ownership preserves existing placements and creates a new owning placement if needed.
  if (!updated.layout.nodes.some((node) => node.objectId === id && node.viewId === next.domainId)) {
    const previous = doc.layout.nodes.find(
      (node) => node.objectId === id && node.viewId === current.domainId,
    );
    updated = addTableReference(
      updated,
      id,
      next.domainId,
      previous ?? { x: 0, y: 0 },
    ) as typeof updated;
  }
  for (const view of updated.views ?? [])
    updated = upsertCombinedView(updated, view) as typeof updated;
  return updated;
}

export function removeTable(doc: DesignDocument, id: string): DesignDocument {
  return {
    ...doc,
    ...(doc.tables && { tables: doc.tables.filter((table) => table.id !== id) }),
    ...(doc.columns && { columns: doc.columns.filter((column) => column.tableId !== id) }),
    ...(doc.keys && { keys: doc.keys.filter((key) => key.tableId !== id) }),
    ...(doc.tableRelations && {
      tableRelations: doc.tableRelations.filter(
        (relation) => relation.sourceTableId !== id && relation.targetTableId !== id,
      ),
    }),
    layout: {
      ...doc.layout,
      nodes: doc.layout.nodes.filter((node) => node.objectId !== id),
      ...(doc.layout.relations && {
        relations: doc.layout.relations.filter(
          (route) =>
            !doc.tableRelations?.some(
              (relation) =>
                relation.id === route.relationId &&
                (relation.sourceTableId === id || relation.targetTableId === id),
            ),
        ),
      }),
    },
  };
}

export function addColumn(doc: DesignDocument, column: Column): DesignDocument {
  requireNewId(doc, column.id);
  requireObject(doc.tables?.find((table) => table.id === column.tableId));
  return { ...doc, columns: [...(doc.columns ?? []), cloneModel(column)] };
}

export function updateColumn(
  doc: DesignDocument,
  id: string,
  patch: Partial<Omit<Column, 'id' | 'tableId'>>,
): DesignDocument {
  const column = doc.columns?.find((item) => item.id === id);
  requireObject(column);
  return {
    ...doc,
    columns: doc.columns!.map((item) =>
      item.id === id ? { ...item, ...cloneModel(patch), id, tableId: column.tableId } : item,
    ),
  };
}

export function removeColumn(doc: DesignDocument, id: string): DesignDocument {
  return {
    ...doc,
    ...(doc.columns && { columns: doc.columns.filter((column) => column.id !== id) }),
    ...(doc.keys && { keys: doc.keys.filter((key) => !key.columnIds.includes(id)) }),
    ...(doc.tableRelations && {
      tableRelations: doc.tableRelations.map((relation) =>
        relation.physical &&
        [...relation.physical.sourceColumnIds, ...relation.physical.targetColumnIds].includes(id)
          ? { ...relation, physical: null }
          : relation,
      ),
    }),
  };
}

export function upsertKey(doc: DesignDocument, key: TableKey): DesignDocument {
  requireObject(doc.tables?.find((table) => table.id === key.tableId));
  const exists = doc.keys?.some((item) => item.id === key.id);
  if (!exists) requireNewId(doc, key.id);
  return {
    ...doc,
    keys: exists
      ? doc.keys!.map((item) => (item.id === key.id ? cloneModel(key) : item))
      : [...(doc.keys ?? []), cloneModel(key)],
  };
}

export function removeKey(doc: DesignDocument, id: string): DesignDocument {
  return { ...doc, ...(doc.keys && { keys: doc.keys.filter((key) => key.id !== id) }) };
}

export function upsertTableRelation(doc: DesignDocument, relation: TableRelation): DesignDocument {
  requireObject(doc.tables?.find((table) => table.id === relation.sourceTableId));
  requireObject(doc.tables?.find((table) => table.id === relation.targetTableId));
  const exists = doc.tableRelations?.some((item) => item.id === relation.id);
  if (!exists) requireNewId(doc, relation.id);
  return {
    ...doc,
    tableRelations: exists
      ? doc.tableRelations!.map((item) => (item.id === relation.id ? cloneModel(relation) : item))
      : [...(doc.tableRelations ?? []), cloneModel(relation)],
  };
}

export function removeTableRelation(doc: DesignDocument, id: string): DesignDocument {
  return {
    ...doc,
    ...(doc.tableRelations && {
      tableRelations: doc.tableRelations.filter((relation) => relation.id !== id),
    }),
    layout: {
      ...doc.layout,
      ...(doc.layout.relations && {
        relations: doc.layout.relations.filter((route) => route.relationId !== id),
      }),
    },
  };
}

/** Document values are JSON data; copy inputs to keep caller mutations out of history. */
function cloneModel<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Stable project-wide types; changing a name does not invalidate column references. */
export function upsertEnum(doc: DesignDocument, item: ProjectEnum): DesignDocument {
  const validName = (value: string) =>
    !!value.trim() && !value.includes('\0') && utf8Length(value) <= 63;
  if (!validName(item.name) || !validName(item.schema || 'public'))
    throw new Error('ENUM 이름과 스키마는 UTF-8 63바이트 이하여야 합니다.');
  if (
    !item.values.length ||
    item.values.length > 1000 ||
    new Set(item.values).size !== item.values.length ||
    item.values.some((value) => value.includes('\0') || utf8Length(value) > 63)
  )
    throw new Error('ENUM 값은 중복 없이 UTF-8 63바이트 이하로 입력해 주세요.');
  const next = { ...item, schema: item.schema || 'public', values: [...item.values] };
  if (
    doc.enums?.some(
      (value) =>
        value.id !== item.id &&
        (value.schema || 'public') === next.schema &&
        value.name === next.name,
    )
  )
    throw new Error('같은 스키마에 ENUM 이름이 중복됩니다.');
  const exists = doc.enums?.some((value) => value.id === item.id);
  if (!exists) requireNewId(doc, item.id);
  return {
    ...doc,
    enums: exists
      ? doc.enums!.map((value) => (value.id === item.id ? next : value))
      : [...(doc.enums ?? []), next],
  };
}
export function removeEnum(doc: DesignDocument, id: string): DesignDocument {
  if (doc.columns?.some((column) => column.physical.type.enumId === id))
    throw new Error('사용 중인 ENUM은 삭제할 수 없습니다. 컬럼 타입을 먼저 변경해 주세요.');
  return { ...doc, ...(doc.enums && { enums: doc.enums.filter((item) => item.id !== id) }) };
}

function utf8Length(value: string): number {
  let count = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    count += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
  }
  return count;
}
/** Copy a complete ordered PK atomically; SQL FK direction remains child to parent. */
export function createForeignKeyFromPrimaryKey(
  doc: DesignDocument,
  input: {
    primaryTableId: string;
    foreignTableId: string;
    primaryKeyId: string;
    relationId: string;
    columnIds: string[];
  },
): DesignDocument {
  const parent = doc.tables?.find((t) => t.id === input.primaryTableId);
  const child = doc.tables?.find((t) => t.id === input.foreignTableId);
  const key = doc.keys?.find(
    (k) =>
      k.id === input.primaryKeyId && k.tableId === input.primaryTableId && k.kind === 'primary',
  );
  requireObject(parent);
  requireObject(child);
  requireObject(key);
  if (parent.scope === 'logical' || child.scope === 'logical' || key.scope === 'logical')
    throw new Error('기본 키와 테이블이 컬럼을 지원해야 합니다.');
  if (
    !key.columnIds.length ||
    key.columnIds.length > 32 ||
    new Set(key.columnIds).size !== key.columnIds.length ||
    input.columnIds.length !== key.columnIds.length
  )
    throw new Error('기본 키 컬럼 수가 올바르지 않습니다.');
  const ids = [input.relationId, ...input.columnIds];
  if (new Set(ids).size !== ids.length) throw new Error('객체 ID는 고유해야 합니다.');
  ids.forEach((id) => requireNewId(doc, id));
  const sources = key.columnIds.map((id) => {
    const column = doc.columns?.find(
      (c) => c.id === id && c.tableId === parent.id && c.scope !== 'logical',
    );
    requireObject(column);
    if (
      column.physical.type.enumId &&
      !doc.enums?.some((e) => e.id === column.physical.type.enumId)
    )
      throw new Error('ENUM 정의를 찾을 수 없습니다.');
    return column;
  });
  const scope: ModelScope =
    parent.scope === 'physical' ||
    child.scope === 'physical' ||
    key.scope === 'physical' ||
    sources.some((c) => c.scope === 'physical')
      ? 'physical'
      : 'both';
  const physicalNames = new Set(
    (doc.columns ?? []).filter((c) => c.tableId === child.id).map((c) => c.physical.name),
  );
  const logicalNames = new Set(
    (doc.columns ?? []).filter((c) => c.tableId === child.id).map((c) => c.logical.name),
  );
  const uniqueName = (name: string, used: Set<string>) => {
    const base = name || 'id';
    let candidate = base.slice(0, 120);
    let n = 2;
    while (used.has(candidate)) {
      const suffix = `_${n++}`;
      candidate = base.slice(0, 120 - suffix.length) + suffix;
    }
    used.add(candidate);
    return candidate;
  };
  const columns = sources.map((source, index): Column => {
    const copy = cloneModel(source);
    const serialTypes: Record<string, string> = {
      smallserial: 'smallint',
      serial2: 'smallint',
      serial: 'integer',
      serial4: 'integer',
      bigserial: 'bigint',
      serial8: 'bigint',
    };
    const type = copy.physical.type;
    if (!type.enumId && serialTypes[type.name.toLowerCase()])
      type.name = serialTypes[type.name.toLowerCase()]!;
    return {
      ...copy,
      id: input.columnIds[index]!,
      tableId: child.id,
      scope,
      logical: {
        ...copy.logical,
        name: uniqueName(copy.logical.name, logicalNames),
        required: false,
      },
      physical: {
        ...copy.physical,
        name: uniqueName(copy.physical.name, physicalNames),
        nullable: false,
        defaultExpression: null,
      },
    };
  });
  const relationNames = new Set(
    (doc.tableRelations ?? [])
      .filter((r) => r.sourceTableId === child.id)
      .map((r) => r.physical?.name ?? ''),
  );
  const constraintName = uniqueName(
    `fk_${child.physical.name}_${parent.physical.name}`,
    relationNames,
  );
  return {
    ...doc,
    columns: [...(doc.columns ?? []), ...columns],
    tableRelations: [
      ...(doc.tableRelations ?? []),
      {
        id: input.relationId,
        sourceTableId: child.id,
        targetTableId: parent.id,
        scope,
        logical: {
          name: '',
          cardinality: 'one-to-many',
          required: false,
          sourceCardinality: { min: 0, max: 'many' },
          targetCardinality: { min: 1, max: 1 },
        },
        physical: {
          name: constraintName,
          sourceColumnIds: [...input.columnIds],
          targetColumnIds: [...key.columnIds],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ],
  };
}

export function removeCombinedView(doc: DesignDocument, id: string): DesignDocument {
  return {
    ...doc,
    views: (doc.views ?? []).filter((v) => v.id !== id),
    notes: doc.notes.filter((n) => n.viewId !== id),
    layout: {
      ...doc.layout,
      nodes: doc.layout.nodes.filter((n) => n.viewId !== id),
      viewports: doc.layout.viewports.filter((v) => v.viewId !== id),
      ...(doc.layout.relations && {
        relations: doc.layout.relations.filter((r) => r.viewId !== id),
      }),
    },
  };
}

/** Combined views contain owner tables, never copies imported into a selected domain. */
export function upsertCombinedView(doc: DesignDocument, view: CombinedView): DesignDocument {
  if (
    !view.domainIds.length ||
    new Set(view.domainIds).size !== view.domainIds.length ||
    view.domainIds.some((id) => !doc.domains.some((d) => d.id === id))
  )
    throw new Error('함께 볼 도메인을 선택해 주세요.');
  if (!doc.views?.some((v) => v.id === view.id)) requireNewId(doc, view.id);
  const tables = (doc.tables ?? []).filter((t) => view.domainIds.includes(t.domainId));
  const tableIds = new Set(tables.map((t) => t.id));
  const nodes = doc.layout.nodes.filter(
    (n) =>
      n.viewId !== view.id ||
      tableIds.has(n.objectId) ||
      doc.notes.some((note) => note.id === n.objectId && note.viewId === view.id),
  );
  let right = 0;
  for (const domainId of view.domainIds) {
    const owned = tables.filter((t) => t.domainId === domainId);
    const originals = owned.flatMap((t) =>
      doc.layout.nodes.filter((n) => n.objectId === t.id && n.viewId === domainId),
    );
    const originX = originals.length ? Math.min(...originals.map((n) => n.x)) : 0;
    const originY = originals.length ? Math.min(...originals.map((n) => n.y)) : 0;
    for (const original of originals)
      if (!nodes.some((n) => n.viewId === view.id && n.objectId === original.objectId))
        nodes.push({
          ...original,
          id: `node:${original.objectId}:${view.id}`,
          viewId: view.id,
          x: original.x - originX + right,
          y: original.y - originY,
        });
    if (originals.length) right += Math.max(...originals.map((n) => n.x - originX + n.width)) + 160;
  }
  return {
    ...doc,
    views: [...(doc.views ?? []).filter((v) => v.id !== view.id), cloneModel(view)],
    layout: {
      ...doc.layout,
      nodes,
      ...(doc.layout.relations && {
        relations: doc.layout.relations.filter(
          (r) =>
            r.viewId !== view.id ||
            doc.tableRelations?.some(
              (t) =>
                t.id === r.relationId &&
                tableIds.has(t.sourceTableId) &&
                tableIds.has(t.targetTableId),
            ),
        ),
      }),
    },
  };
}

export function upsertRelationLayout(doc: DesignDocument, route: RelationLayout): DesignDocument {
  requireView(doc, route.viewId);
  const relation = doc.tableRelations?.find((r) => r.id === route.relationId);
  requireObject(relation);
  if (
    ![relation.sourceTableId, relation.targetTableId].every((id) =>
      doc.layout.nodes.some((n) => n.objectId === id && n.viewId === route.viewId),
    )
  )
    throw new Error('화면에서 관계의 양쪽 테이블을 찾을 수 없습니다.');
  if (!Number.isFinite(route.offset) || Math.abs(route.offset) > 1e7)
    throw new Error('관계 경로 위치가 올바르지 않습니다.');
  if (route.bend) position(route.bend);
  for (const anchor of [route.sourceAnchor, route.targetAnchor])
    if (
      anchor &&
      (!['left', 'right', 'top', 'bottom'].includes(anchor.side) ||
        !Number.isFinite(anchor.ratio) ||
        anchor.ratio < 0 ||
        anchor.ratio > 1)
    )
      throw new Error('관계 접점이 올바르지 않습니다.');
  if (route.waypoints) {
    if (route.waypoints.length > 128) throw new Error('관계 꺾임점은 128개까지 가능합니다.');
    for (const point of route.waypoints) position(point);
  }
  return {
    ...doc,
    layout: {
      ...doc.layout,
      relations: [
        ...(doc.layout.relations ?? []).filter(
          (r) => r.relationId !== route.relationId || r.viewId !== route.viewId,
        ),
        cloneModel(route),
      ],
    },
  };
}

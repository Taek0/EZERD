import {
  TABLES_VIEW_ID,
  updateNodeLayout,
  type Domain,
  type NodeLayout,
  type Position,
} from '../document.js';
import {
  extractPersonalState,
  mergeStoredPersonalState,
  reconcilePersonalState,
} from '../personal.js';
import { requestFingerprint } from '../sync.js';
import { getDatabaseProfile } from './profiles.js';
import { nativeReferenceProblems } from './reference-graph.js';
import { inspectNativeLegacyChanges } from './validation.js';
import { planNativeDeletion, type NativeDeletionPlan } from './deletion.js';
import type { NativeDesignDocument } from './native-document.js';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export interface NativeDomainPatch {
  name?: string;
  description?: string;
  color?: string | null;
}
export type NativeDomainRemovalPolicy =
  | { kind: 'rejectNonempty' }
  | { kind: 'moveTables'; targetDomainId: string | null }
  | { kind: 'deleteTables'; cascadeGeneratedColumns?: boolean };
export interface NativeDomainDeletionPlan {
  document: NativeDesignDocument;
  domainId: string;
  movedTableIds: string[];
  deletion: NativeDeletionPlan | null;
  removedDomainRelationIds: string[];
  removedNoteIds: string[];
  removedViewIds: string[];
  removedNodeIds: string[];
  removedViewportViewIds: string[];
  removedRelationLayouts: { relationId: string; viewId: string }[];
}
function native(document: NativeDesignDocument) {
  if (document.schemaVersion !== 2) throw new Error('document.version-not-supported');
  getDatabaseProfile(document.database);
}
function identity(id: string) {
  if (
    typeof id !== 'string' ||
    !id ||
    id !== id.trim() ||
    id.length > 160 ||
    id === 'overview' ||
    id === TABLES_VIEW_ID
  )
    throw new Error('document.invalid-identity');
}
function objects(document: NativeDesignDocument) {
  return [
    ...document.domains,
    ...document.domainRelations,
    ...document.notes,
    ...(document.views ?? []),
    ...(document.tables ?? []),
    ...(document.columns ?? []),
    ...(document.keys ?? []),
    ...(document.tableRelations ?? []),
    ...(document.enums ?? []),
    ...(document.indexes ?? []),
    ...(document.checks ?? []),
    ...document.layout.nodes,
  ];
}
function metadata(value: object, fields: string[]) {
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new Error('domain.patch-invalid');
  const fieldsValue = value as Record<string, unknown>;
  for (const field of ['name', 'description'])
    if (
      fieldsValue[field] !== undefined &&
      (typeof fieldsValue[field] !== 'string' ||
        fieldsValue[field].length > (field === 'name' ? 120 : 10000))
    )
      throw new Error('domain.metadata-invalid');
  if (
    fieldsValue.color !== undefined &&
    fieldsValue.color !== null &&
    (typeof fieldsValue.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(fieldsValue.color))
  )
    throw new Error('domain.color-invalid');
}
/** Existing causal errors may remain, but grouping must not introduce new reference/legacy errors. */
function finish(
  candidate: NativeDesignDocument,
  previous: NativeDesignDocument,
): NativeDesignDocument {
  const legacy = inspectNativeLegacyChanges(candidate, previous)[0];
  if (legacy) throw new Error(legacy.code);
  const previousProblems = new Set(
    nativeReferenceProblems(previous).map((problem) => requestFingerprint(problem)),
  );
  const introduced = nativeReferenceProblems(candidate).find(
    (problem) => !previousProblems.has(requestFingerprint(problem)),
  );
  if (introduced) throw new Error(introduced.code);
  return candidate;
}
function generatedNodeId(document: NativeDesignDocument, domainId: string): string {
  let prefix = '';
  for (const char of `node:${domainId}:overview`) {
    if ((prefix + char).length > 150) break;
    prefix += char;
  }
  const ids = new Set(objects(document).map((item) => item.id));
  let id = prefix,
    counter = 2;
  while (ids.has(id)) id = `${prefix}:${counter++}`;
  return id;
}
export function addNativeDomain(
  document: NativeDesignDocument,
  domain: Domain,
  point: Position = { x: 0, y: 0 },
  options: { nodeId?: string } = {},
): NativeDesignDocument {
  native(document);
  identity(domain.id);
  metadata(domain, ['id', 'name', 'description', 'color']);
  if (
    typeof domain.name !== 'string' ||
    typeof domain.description !== 'string' ||
    (domain as { color?: unknown }).color === null
  )
    throw new Error('domain.metadata-invalid');
  if (objects(document).some((item) => item.id === domain.id))
    throw new Error('document.duplicate-identities');
  if (
    document.layout.nodes.some((node) => node.objectId === domain.id && node.viewId === 'overview')
  )
    throw new Error('document.duplicate-placement');
  const nodeId = options.nodeId ?? generatedNodeId(document, domain.id);
  identity(nodeId);
  if (nodeId === domain.id || objects(document).some((item) => item.id === nodeId))
    throw new Error('document.duplicate-identities');
  let candidate = clone(document);
  candidate.domains.push(clone(domain));
  candidate.layout.nodes.push({
    id: nodeId,
    objectId: domain.id,
    viewId: 'overview',
    x: 0,
    y: 0,
    width: 240,
    height: 210,
  });
  candidate = updateNodeLayout(candidate, nodeId, { x: point.x, y: point.y });
  return finish(candidate, document);
}
export function updateNativeDomain(
  document: NativeDesignDocument,
  id: string,
  patch: NativeDomainPatch,
): NativeDesignDocument {
  native(document);
  identity(id);
  metadata(patch, ['name', 'description', 'color']);
  const current = document.domains.find((domain) => domain.id === id);
  if (!current) throw new Error('domain.not-found');
  const candidate = clone(document),
    next = candidate.domains.find((domain) => domain.id === id)!;
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.color === null) delete next.color;
  else if (patch.color !== undefined) next.color = patch.color;
  return finish(candidate, document);
}
function prunePersonalAndRoutes(document: NativeDesignDocument): NativeDesignDocument {
  const reconciled = mergeStoredPersonalState(
    document,
    reconcilePersonalState(document, extractPersonalState(document)),
  );
  if (document.views === undefined) delete reconciled.views;
  if (document.layout.relations === undefined) delete reconciled.layout.relations;
  const placements = new Set(
    reconciled.layout.nodes.map((node) => JSON.stringify([node.viewId, node.objectId])),
  );
  if (reconciled.layout.relations)
    reconciled.layout.relations = reconciled.layout.relations.filter((route) => {
      const relation = reconciled.tableRelations?.find(
        (relation) => relation.id === route.relationId,
      );
      return (
        !!relation &&
        [relation.sourceTableId, relation.targetTableId].every((id) =>
          placements.has(JSON.stringify([route.viewId, id])),
        )
      );
    });
  return reconciled;
}
/** Domain grouping is not a column owner or physical namespace change. No private refs are added. */
function moveTableGrouping(
  document: NativeDesignDocument,
  tableId: string,
  targetDomainId: string | null,
): NativeDesignDocument {
  native(document);
  identity(tableId);
  if (targetDomainId !== null) {
    identity(targetDomainId);
    if (!document.domains.some((domain) => domain.id === targetDomainId))
      throw new Error('domain.target-not-found');
  }
  const current = document.tables?.find((table) => table.id === tableId);
  if (!current) throw new Error('document.table-not-found');
  if (current.domainId === targetDomainId) return clone(document);
  let candidate = clone(document);
  candidate.tables!.find((table) => table.id === tableId)!.domainId = targetDomainId;
  const domains = new Set(document.domains.map((domain) => domain.id));
  const canonical = document.layout.nodes.find(
    (node) => node.objectId === tableId && node.viewId === TABLES_VIEW_ID,
  );
  const owner = !canonical
    ? document.layout.nodes.find(
        (node) => node.objectId === tableId && node.viewId === current.domainId,
      )
    : undefined;
  candidate.layout.nodes = candidate.layout.nodes.flatMap((node): NodeLayout[] => {
    if (node.objectId !== tableId) return [node];
    if (owner && node.id === owner.id) return [{ ...node, viewId: TABLES_VIEW_ID }];
    if (domains.has(node.viewId) && node.viewId !== targetDomainId) return [];
    return [node];
  });
  return candidate;
}
export function moveNativeTableDomain(
  document: NativeDesignDocument,
  tableId: string,
  targetDomainId: string | null,
): NativeDesignDocument {
  const candidate = moveTableGrouping(document, tableId, targetDomainId);
  return document.tables?.find((table) => table.id === tableId)?.domainId === targetDomainId
    ? candidate
    : finish(prunePersonalAndRoutes(candidate), document);
}
export function planNativeDomainDeletion(
  document: NativeDesignDocument,
  domainId: string,
  policy: NativeDomainRemovalPolicy = { kind: 'rejectNonempty' },
): NativeDomainDeletionPlan {
  native(document);
  identity(domainId);
  if (!document.domains.some((domain) => domain.id === domainId))
    throw new Error('domain.not-found');
  const owned = (document.tables ?? []).filter((table) => table.domainId === domainId);
  let candidate = clone(document),
    deletion: NativeDeletionPlan | null = null;
  const movedTableIds: string[] = [];
  if (policy.kind === 'rejectNonempty') {
    if (Object.keys(policy).some((key) => key !== 'kind'))
      throw new Error('domain.removal-policy-invalid');
    if (owned.length) throw new Error('domain.not-empty');
  } else if (policy.kind === 'moveTables') {
    if (
      Object.keys(policy).some((key) => !['kind', 'targetDomainId'].includes(key)) ||
      policy.targetDomainId === undefined ||
      policy.targetDomainId === domainId
    )
      throw new Error('domain.removal-policy-invalid');
    if (policy.targetDomainId !== null) {
      identity(policy.targetDomainId);
      if (!document.domains.some((domain) => domain.id === policy.targetDomainId))
        throw new Error('domain.target-not-found');
    }
    for (const table of owned) {
      candidate = moveTableGrouping(candidate, table.id, policy.targetDomainId);
      movedTableIds.push(table.id);
    }
  } else if (policy.kind === 'deleteTables') {
    if (
      Object.keys(policy).some((key) => !['kind', 'cascadeGeneratedColumns'].includes(key)) ||
      (policy.cascadeGeneratedColumns !== undefined &&
        typeof policy.cascadeGeneratedColumns !== 'boolean')
    )
      throw new Error('domain.removal-policy-invalid');
    if (owned.length) {
      deletion = planNativeDeletion(
        candidate,
        owned.map((table) => ({ collection: 'tables', id: table.id })),
        {
          ...(policy.cascadeGeneratedColumns !== undefined
            ? { cascadeGeneratedColumns: policy.cascadeGeneratedColumns }
            : {}),
        },
      );
      if (!deletion.blockers.length) candidate = deletion.document;
    }
  } else throw new Error('domain.removal-policy-invalid');
  // A blocked preview never exposes an applicable partially deleted document.
  if (deletion?.blockers.length)
    return {
      document: clone(document),
      domainId,
      movedTableIds,
      deletion,
      removedDomainRelationIds: [],
      removedNoteIds: [],
      removedViewIds: [],
      removedNodeIds: [],
      removedViewportViewIds: [],
      removedRelationLayouts: [],
    };
  const noteIds = new Set(
    candidate.notes.filter((note) => note.viewId === domainId).map((note) => note.id),
  );
  candidate.domains = candidate.domains.filter((domain) => domain.id !== domainId);
  candidate.domainRelations = candidate.domainRelations.filter(
    (relation) => relation.sourceDomainId !== domainId && relation.targetDomainId !== domainId,
  );
  candidate.notes = candidate.notes.filter((note) => !noteIds.has(note.id));
  candidate.layout.nodes = candidate.layout.nodes.filter(
    (node) => node.objectId !== domainId && node.viewId !== domainId && !noteIds.has(node.objectId),
  );
  candidate.layout.viewports = candidate.layout.viewports.filter(
    (viewport) => viewport.viewId !== domainId,
  );
  if (candidate.layout.relations)
    candidate.layout.relations = candidate.layout.relations.filter(
      (route) => route.viewId !== domainId,
    );
  candidate = finish(prunePersonalAndRoutes(candidate), document);
  const missing = <T extends { id: string }>(before: T[], after: T[]) =>
    before
      .filter((item) => !after.some((current) => current.id === item.id))
      .map((item) => item.id);
  return {
    document: candidate,
    domainId,
    movedTableIds,
    deletion,
    removedDomainRelationIds: missing(document.domainRelations, candidate.domainRelations),
    removedNoteIds: missing(document.notes, candidate.notes),
    removedViewIds: missing(document.views ?? [], candidate.views ?? []),
    removedNodeIds: missing(document.layout.nodes, candidate.layout.nodes),
    removedViewportViewIds: document.layout.viewports
      .filter(
        (viewport) =>
          !candidate.layout.viewports.some((current) => current.viewId === viewport.viewId),
      )
      .map((viewport) => viewport.viewId),
    removedRelationLayouts: (document.layout.relations ?? [])
      .filter(
        (route) =>
          !candidate.layout.relations?.some(
            (current) => current.relationId === route.relationId && current.viewId === route.viewId,
          ),
      )
      .map(({ relationId, viewId }) => ({ relationId, viewId })),
  };
}
export function removeNativeDomain(
  document: NativeDesignDocument,
  domainId: string,
  policy: NativeDomainRemovalPolicy = { kind: 'rejectNonempty' },
): NativeDesignDocument {
  const plan = planNativeDomainDeletion(document, domainId, policy);
  if (plan.deletion?.blockers.length) throw new Error(plan.deletion.blockers[0]!.code);
  return plan.document;
}

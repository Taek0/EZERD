import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { migrateDesignDocumentV1 } from '../../../packages/model/src/database/migration.ts';
import { mergeStoredPersonalState } from '../../../packages/model/src/personal.ts';
import { versionedProjectTransferSchema } from '../../../packages/contracts/src/native-transfer.ts';
import {
  nativeTableCanvasMetrics,
  nativeRelationLabelWidth,
} from '../../../apps/web/src/features/projects/native-canvas-style.ts';
import { nativeCanvasSvg } from '../../../apps/web/src/features/projects/native-canvas-png.ts';
import {
  relationGeometry,
  segmentCrossesBounds,
} from '../../../apps/web/src/features/relations/relation-routing.ts';

const root = 'artifacts/repository-erd/current/';
const saved = JSON.parse(readFileSync(root + 'project-state.json', 'utf8'));
const personal = JSON.parse(readFileSync(root + 'personal-state.json', 'utf8'));
const doc = saved.sourceDocument;
const source = migrateDesignDocumentV1(
  JSON.parse(readFileSync(root + 'ezerd-project.json', 'utf8')).document,
  doc.database,
).document;
const differences = [];
for (const collection of ['tables', 'columns', 'keys', 'enums', 'tableRelations'])
  for (const value of source[collection]) {
    const found = doc[collection].find((v) => v.id === value.id);
    if (
      !found ||
      !isDeepStrictEqual(
        collection === 'columns'
          ? found.physical
          : collection === 'tables'
            ? found.physical
            : found,
        collection === 'columns'
          ? value.physical
          : collection === 'tables'
            ? value.physical
            : value,
      )
    )
      differences.push({ collection, id: value.id });
  }
if (differences.length) throw new Error(JSON.stringify(differences));
const nodes = doc.layout.nodes.filter((n) => n.viewId === '__tables__');
const routes = doc.layout.relations.filter((r) => r.viewId === '__tables__');
let spacingViolations = 0,
  undersized = 0,
  hierarchyViolations = 0;
for (let i = 0; i < nodes.length; i++) {
  const a = nodes[i],
    table = doc.tables.find((t) => t.id === a.objectId),
    m = nativeTableCanvasMetrics(doc, table, 'physical');
  if (a.width < m.width || a.height < m.height) undersized++;
  for (const b of nodes.slice(i + 1))
    if (!(
      a.x + a.width + 40 <= b.x ||
      b.x + b.width + 40 <= a.x ||
      a.y + a.height + 40 <= b.y ||
      b.y + b.height + 40 <= a.y
    ))
      spacingViolations++;
}
const relations = doc.tableRelations.map((relation, i) => {
  const a = nodes.find((n) => n.objectId === relation.sourceTableId),
    b = nodes.find((n) => n.objectId === relation.targetTableId);
  if (b.y + b.height >= a.y) hierarchyViolations++;
  const route = routes.find((r) => r.relationId === relation.id),
    label = relation.physical.name;
  const geometry = relationGeometry(
    a,
    b,
    nativeRelationLabelWidth(label),
    i,
    0,
    undefined,
    nodes.filter((n) => n !== a && n !== b),
    route,
  );
  if (!isDeepStrictEqual(geometry.points.slice(1, -1), route.waypoints))
    throw new Error('Route fallback ' + relation.id);
  return { relation, geometry, label };
});
const segments = (points) => points.slice(1).map((b, i) => [points[i], b]);
let cardIntersections = 0,
  labelIntersections = 0,
  labelLineIntersections = 0;
const labels = relations.map((r) => ({
  x: r.geometry.labelX - nativeRelationLabelWidth(r.label) / 2 - 6,
  y: r.geometry.labelY - 16,
  width: nativeRelationLabelWidth(r.label) + 12,
  height: 32,
}));
for (let i = 0; i < relations.length; i++) {
  for (const [a, b] of segments(relations[i].geometry.points)) {
    if (nodes.some((n) => segmentCrossesBounds(a, b, n))) cardIntersections++;
    for (let j = 0; j < labels.length; j++)
      if (i !== j && segmentCrossesBounds(a, b, labels[j])) labelLineIntersections++;
  }
  for (const b of labels.slice(i + 1)) {
    const a = labels[i];
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
      labelIntersections++;
  }
}
const privateNodes = personal.state.nodes.filter((n) => n.viewId === 'repository-current');
const privateRoutes = personal.state.relations.filter((n) => n.viewId === 'repository-current');
const privateMatches =
  nodes.every((n) =>
    privateNodes.some(
      (p) =>
        p.objectId === n.objectId &&
        p.x === n.x &&
        p.y === n.y &&
        p.width === n.width &&
        p.height === n.height,
    ),
  ) &&
  routes.every((r) => privateRoutes.some((p) => isDeepStrictEqual({ ...p, viewId: r.viewId }, r)));
const scene = { nodes, relations, viewId: '__tables__' };
const preview = nativeCanvasSvg(doc, scene, 'physical');
writeFileSync(root + 'erd-preview.svg', preview.svg);
const routing = JSON.parse(readFileSync(root + 'compact-routes.json', 'utf8'));
const report = {
  tables: doc.tables.length,
  columns: doc.columns.length,
  keys: doc.keys.length,
  foreignKeys: relations.length,
  enums: doc.enums.length,
  schemaDifferences: differences,
  spacingViolations,
  undersized,
  hierarchyViolations,
  cardIntersections,
  labelIntersections,
  labelLineIntersections,
  privateMatches,
  geometry: routing.after,
  canvas: preview.bounds,
  aspectRatio: Number((preview.bounds.width / preview.bounds.height).toFixed(2)),
  nativeIssues: saved.native.issues,
};
if (spacingViolations || undersized || hierarchyViolations || cardIntersections || !privateMatches)
  throw new Error(JSON.stringify(report));
writeFileSync(root + 'verification.json', JSON.stringify(report, null, 2));
const exportDocument = mergeStoredPersonalState(doc, personal.state);
const transfer = versionedProjectTransferSchema.parse({
  format: 'ezerd-project',
  formatVersion: 2,
  exportedAt: new Date().toISOString(),
  project: {
    name: saved.project.name,
    databaseKind: saved.project.databaseKind,
    databaseProfileId: saved.project.databaseProfileId,
  },
  source: {
    projectId: saved.project.id,
    version: saved.project.version,
    sequence: saved.sequence,
    databaseRevision: saved.project.databaseRevision,
  },
  sourceDocument: exportDocument,
  native: { ...saved.native, document: exportDocument },
});
writeFileSync(root + 'native-project.json', JSON.stringify(transfer, null, 2));
console.log(JSON.stringify(report));

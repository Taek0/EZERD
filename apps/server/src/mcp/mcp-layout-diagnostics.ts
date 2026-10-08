import { z } from 'zod';
import { nodeLayoutSchema } from '@ezerd/contracts';
import {
  basicCardSize,
  isVisibleInView,
  nativeTableCanvasMetrics,
  type NativeDesignDocument,
} from '@ezerd/model';
import { inspectRouteConflicts, reconstructDiagnosticRoutes } from './mcp-route-diagnostics.js';

// Rendered stubs can extend outside the persisted coordinate range.
const coordinate = z.number();
export const layoutDiagnosticSchema = z.strictObject({
  code: z.enum([
    'card-expanded',
    'card-overlap',
    'card-gap-too-small',
    'relation-card-penetration',
    'relation-segment-overlap',
    'relation-crossing',
  ]),
  viewId: z.string(),
  objectId: z.string(),
  otherObjectId: z.string().optional(),
  message: z.string(),
  x: coordinate,
  y: coordinate,
  relationId: z.string().optional(),
  otherRelationId: z.string().optional(),
  segmentIndex: z.number().int().nonnegative().optional(),
  otherSegmentIndex: z.number().int().nonnegative().optional(),
  intersectionKind: z.enum(['crossing', 'touch', 'overlap']).optional(),
  segment: z
    .strictObject({
      start: z.strictObject({ x: z.number(), y: z.number() }),
      end: z.strictObject({ x: z.number(), y: z.number() }),
    })
    .optional(),
  otherSegment: z
    .strictObject({
      start: z.strictObject({ x: z.number(), y: z.number() }),
      end: z.strictObject({ x: z.number(), y: z.number() }),
    })
    .optional(),
  mode: z.enum(['physical', 'logical']).optional(),
});
export const layoutDiagnosisSchema = z.strictObject({
  diagnostics: z.array(layoutDiagnosticSchema),
  truncated: z.boolean(),
  coverage: z.strictObject({
    geometry: z.literal('shared-native-router'),
    complete: z.boolean(),
    checkedRoutes: z.number().int().nonnegative(),
    skippedRoutes: z.number().int().nonnegative(),
    comparisons: z.number().int().nonnegative(),
    modes: z.array(z.enum(['physical', 'logical'])),
    limitations: z.array(z.string()),
  }),
});
export const layoutDiagnosisInputSchema = z.strictObject({
  projectId: z.uuid(),
  viewId: z.string().min(1).max(160).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  mode: z.enum(['physical', 'logical']).default('physical'),
});

export function diagnoseLayout(
  document: NativeDesignDocument,
  viewId: string | undefined,
  limit: number,
  mode?: 'physical' | 'logical',
) {
  type Diagnostic = z.infer<typeof layoutDiagnosticSchema>;
  const diagnostics: Diagnostic[] = [];
  const modes = mode ? [mode] : (['physical', 'logical'] as const);
  const coverage = {
    geometry: 'shared-native-router' as const,
    complete: Boolean(mode),
    checkedRoutes: 0,
    skippedRoutes: 0,
    comparisons: 0,
    modes: [...modes],
    limitations: [
      'Only persisted layout nodes are inspected; temporary canvas filters, draft positions and generated preview nodes are not included.',
      'Domain relationship paths are not reconstructed.',
      'Route reconstruction is limited to 200 cards and 200 routes per view; intersection inspection is limited to 100000 candidate comparisons.',
      ...(mode
        ? []
        : [
            'Without a mode, card bounds conservatively cover physical and logical renderings; route positions are estimates.',
          ]),
    ],
  };
  const byView = new Map<string, Array<(typeof document.layout.nodes)[number]>>();
  for (const node of document.layout.nodes) {
    if (viewId && node.viewId !== viewId) continue;
    const group = byView.get(node.viewId) ?? [];
    group.push(node);
    byView.set(node.viewId, group);
  }
  if (viewId && !byView.has(viewId)) byView.set(viewId, []);
  for (const route of document.layout.relations ?? []) {
    if ((!viewId || route.viewId === viewId) && !byView.has(route.viewId))
      byView.set(route.viewId, []);
  }
  let truncated = false;
  const tableIds = new Set((document.tables ?? []).map((table) => table.id));
  const tablesById = new Map((document.tables ?? []).map((table) => [table.id, table]));
  const domainIds = new Set(document.domains.map((domain) => domain.id));
  const sizeFor = (node: NativeDesignDocument['layout']['nodes'][number]) => {
    const table = tablesById.get(node.objectId);
    const minimum = basicCardSize(
      table ? 'table' : domainIds.has(node.objectId) ? 'domain' : 'note',
      node.width,
      node.height,
    );
    // Old direct callers without a mode conservatively cover both renderings.
    const metrics = table
      ? modes
          .filter((mode) => isVisibleInView(table.scope, mode))
          .map((mode) => nativeTableCanvasMetrics(document, table, mode))
      : [];
    return {
      width: Math.min(
        nodeLayoutSchema.shape.width.maxValue!,
        Math.max(minimum.width, ...metrics.map((metric) => metric.width)),
      ),
      height: Math.min(
        nodeLayoutSchema.shape.height.maxValue!,
        Math.max(minimum.height, ...metrics.map((metric) => metric.height)),
      ),
    };
  };
  const push = (diagnostic: Diagnostic) => {
    if (diagnostics.length < limit) diagnostics.push(diagnostic);
    else truncated = true;
    return !truncated;
  };
  for (const [currentView, nodes] of byView) {
    const visible = nodes
      .filter(
        (node) =>
          !mode ||
          !tablesById.has(node.objectId) ||
          isVisibleInView(tablesById.get(node.objectId)!.scope, mode),
      )
      .map((node) => ({ node, size: sizeFor(node) }))
      .sort((a, b) => a.node.x - b.node.x || a.node.id.localeCompare(b.node.id));
    for (let index = 0; index < visible.length; index++) {
      const a = visible[index]!;
      const rightA = a.node.x + a.size.width;
      const bottomA = a.node.y + a.size.height;
      for (let otherIndex = index + 1; otherIndex < visible.length; otherIndex++) {
        const b = visible[otherIndex]!;
        if (b.node.x >= rightA + 40) break;
        const rightB = b.node.x + b.size.width;
        const bottomB = b.node.y + b.size.height;
        const xGap = Math.max(0, a.node.x - rightB, b.node.x - rightA);
        const yGap = Math.max(0, a.node.y - bottomB, b.node.y - bottomA);
        if (xGap >= 40 || yGap >= 40) continue;
        const overlap =
          Math.min(rightA, rightB) > Math.max(a.node.x, b.node.x) &&
          Math.min(bottomA, bottomB) > Math.max(a.node.y, b.node.y);
        push({
          code: overlap ? 'card-overlap' : 'card-gap-too-small',
          viewId: currentView,
          objectId: a.node.objectId,
          otherObjectId: b.node.objectId,
          message: overlap
            ? '실제 렌더링 카드 영역이 겹칩니다.'
            : `카드 사이의 가로·세로 간격이 모두 40px 미만입니다 (가로 ${xGap}px, 세로 ${yGap}px).`,
          x: a.node.x,
          y: a.node.y,
        });
        if (truncated) break;
      }
      if (truncated) break;
    }
    if (truncated) break;
    for (const { node, size } of visible) {
      if (tableIds.has(node.objectId) && (size.width > node.width || size.height > node.height))
        push({
          code: 'card-expanded',
          viewId: currentView,
          objectId: node.objectId,
          message: `테이블 카드가 내용에 맞춰 저장 크기 ${node.width}×${node.height}px에서 실제 ${size.width}×${size.height}px로 확장됩니다.`,
          x: node.x,
          y: node.y,
        });
      if (truncated) break;
    }
    if (truncated) break;
    for (const routeMode of modes) {
      const cards = visible
        .filter(
          ({ node }) =>
            !tablesById.has(node.objectId) ||
            isVisibleInView(tablesById.get(node.objectId)!.scope, routeMode),
        )
        .map(({ node, size }) => ({ ...node, ...size }));
      const reconstructed = reconstructDiagnosticRoutes(document, cards, currentView, routeMode);
      coverage.checkedRoutes += reconstructed.routes.length;
      coverage.skippedRoutes += reconstructed.skipped;
      if (reconstructed.skipped) coverage.complete = false;
      const inspected = inspectRouteConflicts(
        reconstructed.routes,
        cards,
        (conflict) => push({ ...conflict, viewId: currentView, mode: routeMode }),
        Math.max(0, 100_000 - coverage.comparisons),
      );
      coverage.comparisons += inspected.comparisons;
      if (!inspected.complete) {
        coverage.complete = false;
        truncated = true;
        break;
      }
    }
    if (document.domainRelations.length && currentView === 'overview') {
      coverage.skippedRoutes += document.domainRelations.length;
      coverage.complete = false;
    }
    if (truncated) break;
  }
  if (truncated) coverage.complete = false;
  return layoutDiagnosisSchema.parse({ diagnostics, truncated, coverage });
}

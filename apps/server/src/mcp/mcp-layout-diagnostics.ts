import { z } from 'zod';
import { effectiveCardSize, type DesignDocument } from '@ezerd/model';

const coordinate = z.number().min(-1e7).max(1e7);
export const layoutDiagnosticSchema = z.strictObject({
  code: z.enum(['card-expanded', 'card-overlap', 'card-gap-too-small']),
  viewId: z.string(),
  objectId: z.string(),
  otherObjectId: z.string().optional(),
  message: z.string(),
  x: coordinate,
  y: coordinate,
});
export const layoutDiagnosisSchema = z.strictObject({
  diagnostics: z.array(layoutDiagnosticSchema),
  truncated: z.boolean(),
});
export const layoutDiagnosisInputSchema = z.strictObject({
  projectId: z.uuid(),
  viewId: z.string().min(1).max(160).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export function diagnoseLayout(
  document: DesignDocument,
  viewId: string | undefined,
  limit: number,
) {
  type Diagnostic = z.infer<typeof layoutDiagnosticSchema>;
  const diagnostics: Diagnostic[] = [];
  const byView = new Map<string, Array<(typeof document.layout.nodes)[number]>>();
  for (const node of document.layout.nodes) {
    if (viewId && node.viewId !== viewId) continue;
    const group = byView.get(node.viewId) ?? [];
    group.push(node);
    byView.set(node.viewId, group);
  }
  let truncated = false;
  const tableIds = new Set((document.tables ?? []).map((table) => table.id));
  const push = (diagnostic: Diagnostic) => {
    if (diagnostics.length < limit) diagnostics.push(diagnostic);
    else truncated = true;
  };
  for (const [currentView, nodes] of byView) {
    const visible = nodes
      .map((node) => ({ node, size: effectiveCardSize(document, node) }))
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
  }
  return layoutDiagnosisSchema.parse({ diagnostics, truncated });
}

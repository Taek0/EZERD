import { TABLES_VIEW_ID, type DesignDocument, upsertCombinedView, setViewport } from '@ezerd/model';
import { tableCardSize } from '../tables/table-geometry.js';
export function domainViewExitTarget(
  doc: DesignDocument,
  domainIds: string[],
  origin: string | null,
): string {
  if (origin === TABLES_VIEW_ID) return TABLES_VIEW_ID;
  const available = domainIds.filter((id) => doc.domains.some((domain) => domain.id === id));
  return origin && available.includes(origin) ? origin : (available[0] ?? 'overview');
}
/** Name the saved view after its domains so the editor path shows what is combined. */
export function combinedViewName(names: string[]): string {
  if (!names.length) return '도메인 뷰';
  const label =
    names.length > 3
      ? names.slice(0, 2).join(' · ') + ' 외 ' + (names.length - 2) + '개'
      : names.join(' · ');
  return label.length > 120 ? label.slice(0, 119) + '…' : label;
}
export function applyDomainSelection(
  doc: DesignDocument,
  domainIds: string[],
  preferredViewId: string | null,
  createId: () => string,
): { document: DesignDocument; viewId: string } {
  const selected = doc.domains.filter((d) => domainIds.includes(d.id));
  const selectedIds = selected.map((d) => d.id);
  const current = doc.views?.find((v) => v.id === preferredViewId) ?? doc.views?.[0];
  const viewId = current?.id ?? createId();
  let next = upsertCombinedView(doc, {
    id: viewId,
    name: combinedViewName(selected.map((d) => d.name)),
    domainIds: selectedIds,
  });
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const anchors: { x: number; y: number }[] = [];
  const groups = selectedIds.flatMap((domainId, index) => {
    const originals = (doc.tables ?? [])
      .filter((t) => t.domainId === domainId)
      .flatMap((t) => {
        const source = doc.layout.nodes.find((n) => n.viewId === domainId && n.objectId === t.id);
        return source
          ? [
              {
                objectId: t.id,
                x: source.x,
                y: source.y,
                ...tableCardSize(doc, t.id, source.width, source.height),
              },
            ]
          : [];
      });
    if (!originals.length) return [];
    const minX = Math.min(...originals.map((n) => n.x)),
      minY = Math.min(...originals.map((n) => n.y));
    const width = Math.max(...originals.map((n) => n.x + n.width)) - minX;
    const height = Math.max(...originals.map((n) => n.y + n.height)) - minY;
    const overview = doc.layout.nodes.find(
      (n) => n.viewId === 'overview' && n.objectId === domainId,
    );
    const anchor = {
      x: overview ? overview.x + overview.width / 2 : (index % 4) * 500,
      y: overview ? overview.y + overview.height / 2 : Math.floor(index / 4) * 500,
    };
    // Coincident/missing map locations have no meaningful relative direction.
    // Separate those deterministically without changing the original document.
    while (anchors.some((p) => Math.hypot(p.x - anchor.x, p.y - anchor.y) < 1)) anchor.x += 500;
    anchors.push(anchor);
    return [{ originals, minX, minY, width, height, anchor }];
  });
  // Uniformly expand the overview centers enough to fit every table cluster.
  // This preserves the map's direction/proportions and all within-domain distances.
  let scale = 1;
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!,
        b = groups[j]!;
      const dx = Math.abs(a.anchor.x - b.anchor.x),
        dy = Math.abs(a.anchor.y - b.anchor.y);
      scale = Math.max(
        scale,
        Math.min(
          dx > 0 ? ((a.width + b.width) / 2 + 180) / dx : Infinity,
          dy > 0 ? ((a.height + b.height) / 2 + 180) / dy : Infinity,
        ),
      );
    }
  const left = groups.length ? Math.min(...groups.map((g) => g.anchor.x * scale - g.width / 2)) : 0;
  const top = groups.length ? Math.min(...groups.map((g) => g.anchor.y * scale - g.height / 2)) : 0;
  for (const group of groups)
    for (const n of group.originals)
      positions.set(n.objectId, {
        x: group.anchor.x * scale - group.width / 2 - left + n.x - group.minX,
        y: group.anchor.y * scale - group.height / 2 - top + n.y - group.minY,
        width: n.width,
        height: n.height,
      });
  next = {
    ...next,
    layout: {
      ...next.layout,
      nodes: next.layout.nodes.map((n) =>
        n.viewId === viewId && positions.has(n.objectId)
          ? { ...n, ...positions.get(n.objectId)! }
          : n,
      ),
      ...(next.layout.relations && {
        relations: next.layout.relations.filter((r) => r.viewId !== viewId),
      }),
    },
  };
  return { document: setViewport(next, { viewId, x: 40, y: 120, zoom: 1 }), viewId };
}

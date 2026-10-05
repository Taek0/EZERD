import type { DesignDocument, NodeLayout } from './document.js';
import { TABLES_VIEW_ID } from './document.js';

const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 64;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Manual, deterministic flow layout; only placements in the requested view change. */
type LayoutDocument = Pick<
  DesignDocument,
  'domains' | 'views' | 'domainRelations' | 'notes' | 'layout'
> & {
  tables?: { id: string }[];
  tableRelations?: { sourceTableId: string; targetTableId: string }[];
};
export function autoLayoutView<T extends LayoutDocument>(document: T, viewId: string): T {
  if (
    viewId !== 'overview' &&
    viewId !== TABLES_VIEW_ID &&
    !document.domains.some((domain) => domain.id === viewId) &&
    !document.views?.some((view) => view.id === viewId)
  ) {
    throw new Error('자동 배치할 뷰를 찾을 수 없습니다.');
  }
  const objects = new Set(
    (viewId === 'overview' ? document.domains : (document.tables ?? [])).map((object) => object.id),
  );
  const nodes = document.layout.nodes
    .filter((node) => node.viewId === viewId && objects.has(node.objectId))
    .toSorted((a, b) => compare(a.objectId, b.objectId) || compare(a.id, b.id));
  if (nodes.length === 0) return document;
  // Match the canvas minimums without changing legacy persisted card dimensions.
  const width = (node: NodeLayout) => Math.max(viewId === 'overview' ? 240 : 280, node.width);
  const height = (node: NodeLayout) => Math.max(viewId === 'overview' ? 210 : 220, node.height);
  const indices = new Map<string, number[]>();
  nodes.forEach((node, index) =>
    indices.set(node.objectId, [...(indices.get(node.objectId) ?? []), index]),
  );
  const outgoing = nodes.map(() => new Set<number>());
  const incoming = nodes.map(() => new Set<number>());
  const connect = (source: string, target: string) => {
    for (const a of indices.get(source) ?? [])
      for (const b of indices.get(target) ?? []) {
        if (a !== b) {
          outgoing[a]!.add(b);
          incoming[b]!.add(a);
        }
      }
  };
  if (viewId === 'overview') {
    for (const relation of document.domainRelations) {
      connect(relation.sourceDomainId, relation.targetDomainId);
      if (relation.direction === 'both') connect(relation.targetDomainId, relation.sourceDomainId);
    }
  } else {
    for (const relation of document.tableRelations ?? [])
      connect(relation.sourceTableId, relation.targetTableId);
  }

  // Iterative Kosaraju traversal avoids recursion limits for large connected documents.
  const edges = outgoing.map((neighbors) => [...neighbors].sort((a, b) => a - b));
  const visited = new Set<number>();
  const finish: number[] = [];
  for (let start = 0; start < nodes.length; start++) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: { vertex: number; next: number }[] = [{ vertex: start, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const neighbor = edges[frame.vertex]![frame.next++];
      if (neighbor === undefined) {
        finish.push(frame.vertex);
        stack.pop();
      } else if (!visited.has(neighbor)) {
        visited.add(neighbor);
        stack.push({ vertex: neighbor, next: 0 });
      }
    }
  }
  const membership = Array<number>(nodes.length).fill(-1);
  const components: number[][] = [];
  for (const start of finish.reverse()) {
    if (membership[start] !== -1) continue;
    const component: number[] = [];
    const componentId = components.length;
    membership[start] = componentId;
    const stack = [start];
    while (stack.length) {
      const vertex = stack.pop()!;
      component.push(vertex);
      for (const neighbor of incoming[vertex]!)
        if (membership[neighbor] === -1) {
          membership[neighbor] = componentId;
          stack.push(neighbor);
        }
    }
    components.push(component.sort((a, b) => a - b));
  }

  // Collapse cycles into components, then assign longest-path ranks on the DAG.
  const componentEdges = components.map(() => new Set<number>());
  const indegrees = components.map(() => 0);
  edges.forEach((neighbors, source) => {
    for (const target of neighbors) {
      const a = membership[source]!;
      const b = membership[target]!;
      if (a !== b && !componentEdges[a]!.has(b)) {
        componentEdges[a]!.add(b);
        indegrees[b]!++;
      }
    }
  });
  const ranks = components.map(() => 0);
  const ready = components.flatMap((_, index) => (indegrees[index] === 0 ? [index] : []));
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const source = ready[cursor]!;
    for (const target of componentEdges[source]!) {
      ranks[target] = Math.max(ranks[target]!, ranks[source]! + 1);
      indegrees[target]!--;
      if (indegrees[target] === 0) ready.push(target);
    }
  }
  const layers = new Map<number, number[]>();
  components.forEach((component, index) => {
    const rank = ranks[index]!;
    layers.set(rank, [...(layers.get(rank) ?? []), ...component]);
  });
  const orderedLayers = [...layers]
    .sort(([a], [b]) => a - b)
    .map(([, layer]) => layer.sort((a, b) => a - b));
  const heights = orderedLayers.map(
    (layer) =>
      layer.reduce((sum, index) => sum + height(nodes[index]!), 0) +
      (layer.length - 1) * VERTICAL_GAP,
  );
  const maximumHeight = Math.max(...heights);
  // Keep notes stationary and leave their occupied vertical area unobstructed.
  const noteIds = new Set(
    document.notes.filter((note) => note.viewId === viewId).map((note) => note.id),
  );
  let originY = Math.min(...nodes.map((node) => node.y));
  for (const node of document.layout.nodes)
    if (node.viewId === viewId && noteIds.has(node.objectId)) {
      originY = Math.max(originY, node.y + Math.max(110, node.height) + VERTICAL_GAP);
    }
  const positions = new Map<string, Pick<NodeLayout, 'x' | 'y'>>();
  let x = Math.min(...nodes.map((node) => node.x));
  orderedLayers.forEach((layer, layerIndex) => {
    let y = originY + Math.floor((maximumHeight - heights[layerIndex]!) / 2);
    for (const index of layer) {
      const node = nodes[index]!;
      positions.set(node.id, { x, y });
      y += height(node) + VERTICAL_GAP;
    }
    x += Math.max(...layer.map((index) => width(nodes[index]!))) + HORIZONTAL_GAP;
  });
  return {
    ...document,
    layout: {
      ...document.layout,
      nodes: document.layout.nodes.map((node) => {
        const point = positions.get(node.id);
        return point ? { ...node, ...point } : node;
      }),
    },
  };
}

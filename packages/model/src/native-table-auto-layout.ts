import type { NodeLayout } from './document-base.js';

const GAP = 200;
const ORDER_SWEEPS = 4;
const CROSSING_SAMPLE_LIMIT = 64;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
type Point = { x: number; y: number };
type Box = { width: number; height: number; positions: Map<number, Point> };
type Reference = { sourceTableId: string; targetTableId: string };

/**
 * Arrange visible, measured TABLE cards. References point from FK child to PK parent.
 * Only coordinates change; the caller decides which cards belong to the current view.
 */
export function arrangeNativeTableNodes(nodes: NodeLayout[], relations: Reference[]): NodeLayout[] {
  if (!nodes.length) return [];
  const ordered = nodes.toSorted(
    (a, b) => compareText(a.objectId, b.objectId) || compareText(a.id, b.id),
  );
  const byObject = new Map<string, number[]>();
  ordered.forEach((node, index) => {
    const entries = byObject.get(node.objectId);
    if (entries) entries.push(index);
    else byObject.set(node.objectId, [index]);
  });
  const outgoing = ordered.map(() => new Set<number>());
  const incoming = ordered.map(() => new Set<number>());
  for (const relation of relations) {
    // A parent precedes every referencing child, including references with duplicate columns.
    for (const parent of byObject.get(relation.targetTableId) ?? []) {
      for (const child of byObject.get(relation.sourceTableId) ?? []) {
        if (parent === child) continue;
        outgoing[parent]!.add(child);
        incoming[child]!.add(parent);
      }
    }
  }
  const edges = outgoing.map((neighbors) => [...neighbors].sort((a, b) => a - b));
  const reverse = incoming.map((neighbors) => [...neighbors].sort((a, b) => a - b));
  const { groups, membership } = stronglyConnectedComponents(edges, reverse);
  const groupEdges = groups.map(() => new Set<number>());
  const indegrees = groups.map(() => 0);
  edges.forEach((neighbors, source) => {
    for (const target of neighbors) {
      const a = membership[source]!;
      const b = membership[target]!;
      if (a !== b && !groupEdges[a]!.has(b)) {
        groupEdges[a]!.add(b);
        indegrees[b]!++;
      }
    }
  });
  const groupRanks = groups.map(() => 0);
  const ready = groups.flatMap((_, index) => (indegrees[index] === 0 ? [index] : []));
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const source = ready[cursor]!;
    for (const target of groupEdges[source]!) {
      groupRanks[target] = Math.max(groupRanks[target]!, groupRanks[source]! + 1);
      if (--indegrees[target]! === 0) ready.push(target);
    }
  }
  const ranks = ordered.map((_, index) => groupRanks[membership[index]!]!);
  const components = weakComponents(edges, reverse);
  const componentLayers = components.map((component) => {
    const layers: number[][] = [];
    for (const index of component) (layers[ranks[index]!] ??= []).push(index);
    return orderLayers(layers, edges, reverse, ranks, ordered);
  });
  const paddedArea = ordered.reduce(
    (sum, node) => sum + (node.width + GAP) * (node.height + GAP),
    0,
  );
  const widest = ordered.reduce((max, node) => Math.max(max, node.width), 0);
  const baseWidth = Math.max(widest, Math.sqrt(paddedArea * 1.4));
  let best: Box | undefined;
  let bestScore = Infinity;
  // Three fixed candidates bound the work even on large connected graphs.
  for (const scale of [0.8, 1.2, 1.8]) {
    const targetWidth = Math.max(widest, baseWidth * scale);
    const boxes = componentLayers.map((layers) => layoutLayers(layers, ordered, targetWidth));
    const packed = packComponents(boxes, targetWidth);
    const score = scoreLayout(packed, ordered, edges, paddedArea);
    if (score < bestScore) {
      best = packed;
      bestScore = score;
    }
  }
  const originX = nodes.reduce((min, node) => Math.min(min, node.x), Infinity);
  const originY = nodes.reduce((min, node) => Math.min(min, node.y), Infinity);
  const placements = new Map(
    ordered.map((node, index) => [node.id, best!.positions.get(index)!] as const),
  );
  return nodes.map((node) => {
    const position = placements.get(node.id)!;
    return { ...node, x: originX + position.x, y: originY + position.y };
  });
}

/** Iterative Kosaraju traversal avoids call-stack limits on long chains. */
function stronglyConnectedComponents(edges: number[][], reverse: number[][]) {
  const visited = new Uint8Array(edges.length);
  const finish: number[] = [];
  for (let start = 0; start < edges.length; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    const stack = [{ vertex: start, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const neighbor = edges[frame.vertex]![frame.next++];
      if (neighbor === undefined) {
        finish.push(frame.vertex);
        stack.pop();
      } else if (!visited[neighbor]) {
        visited[neighbor] = 1;
        stack.push({ vertex: neighbor, next: 0 });
      }
    }
  }
  const membership = Array<number>(edges.length).fill(-1);
  const groups: number[][] = [];
  for (let cursor = finish.length - 1; cursor >= 0; cursor--) {
    const start = finish[cursor]!;
    if (membership[start] !== -1) continue;
    const group: number[] = [];
    const groupId = groups.length;
    const stack = [start];
    membership[start] = groupId;
    while (stack.length) {
      const vertex = stack.pop()!;
      group.push(vertex);
      for (const neighbor of reverse[vertex]!) {
        if (membership[neighbor] === -1) {
          membership[neighbor] = groupId;
          stack.push(neighbor);
        }
      }
    }
    groups.push(group);
  }
  return { groups, membership };
}

function weakComponents(edges: number[][], reverse: number[][]): number[][] {
  const visited = new Uint8Array(edges.length);
  const result: number[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    const stack = [start];
    const component: number[] = [];
    while (stack.length) {
      const vertex = stack.pop()!;
      component.push(vertex);
      for (const neighbors of [edges[vertex]!, reverse[vertex]!]) {
        for (const neighbor of neighbors) {
          if (visited[neighbor]) continue;
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }
    result.push(component.sort((a, b) => a - b));
  }
  return result;
}

function orderLayers(
  layers: number[][],
  edges: number[][],
  reverse: number[][],
  ranks: number[],
  nodes: NodeLayout[],
): number[][] {
  const positions = new Map<number, number>();
  const refresh = () => {
    for (const layer of layers)
      layer.forEach((vertex, position) => positions.set(vertex, position));
  };
  const barycenter = (vertex: number, neighbors: number[][]) => {
    let sum = 0;
    let count = 0;
    for (const neighbor of neighbors[vertex]!) {
      if (ranks[neighbor] === ranks[vertex]) continue;
      sum += positions.get(neighbor)!;
      count++;
    }
    return count ? sum / count : positions.get(vertex)!;
  };
  // Canonical sweeps do not depend on mutable canvas positions. This keeps repeated
  // execution stable; canvas order is used only for final equal-score ties.
  refresh();
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    const downward = sweep % 2 === 0;
    for (let step = 0; step < layers.length; step++) {
      const rank = downward ? step : layers.length - step - 1;
      const layer = layers[rank]!;
      const neighbors = downward ? reverse : edges;
      const scores = new Map(layer.map((vertex) => [vertex, barycenter(vertex, neighbors)]));
      layer.sort((a, b) => scores.get(a)! - scores.get(b)! || a - b);
      layer.forEach((vertex, position) => positions.set(vertex, position));
    }
  }
  // Read existing rows top-to-bottom, then left-to-right. Sorting by x alone would
  // scramble wrapped rows on the next invocation. IDs settle exact position ties.
  const scores = new Map<number, number>();
  for (const layer of layers) {
    for (const vertex of layer) scores.set(vertex, barycenter(vertex, reverse));
  }
  return layers.map((layer) =>
    layer.toSorted(
      (a, b) =>
        scores.get(a)! - scores.get(b)! ||
        nodes[a]!.y - nodes[b]!.y ||
        nodes[a]!.x - nodes[b]!.x ||
        a - b,
    ),
  );
}

function layoutLayers(layers: number[][], nodes: NodeLayout[], targetWidth: number): Box {
  const rows: { vertices: number[]; width: number; height: number }[] = [];
  for (const layer of layers) {
    let row = { vertices: [] as number[], width: 0, height: 0 };
    for (const vertex of layer) {
      const node = nodes[vertex]!;
      if (row.vertices.length && row.width + GAP + node.width > targetWidth) {
        rows.push(row);
        row = { vertices: [], width: 0, height: 0 };
      }
      row.width += (row.vertices.length ? GAP : 0) + node.width;
      row.height = Math.max(row.height, node.height);
      row.vertices.push(vertex);
    }
    if (row.vertices.length) rows.push(row);
  }
  const width = rows.reduce((max, row) => Math.max(max, row.width), 0);
  const positions = new Map<number, Point>();
  let y = 0;
  for (const row of rows) {
    let x = (width - row.width) / 2;
    for (const vertex of row.vertices) {
      positions.set(vertex, { x, y });
      x += nodes[vertex]!.width + GAP;
    }
    y += row.height + GAP;
  }
  return { positions, width, height: Math.max(0, y - GAP) };
}

function packComponents(boxes: Box[], targetWidth: number): Box {
  const positions = new Map<number, Point>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const box of boxes) {
    if (x && x + box.width > targetWidth) {
      y += rowHeight + GAP;
      x = 0;
      rowHeight = 0;
    }
    for (const [vertex, point] of box.positions) {
      positions.set(vertex, { x: point.x + x, y: point.y + y });
    }
    width = Math.max(width, x + box.width);
    rowHeight = Math.max(rowHeight, box.height);
    x += box.width + GAP;
  }
  return { positions, width, height: y + rowHeight };
}

function scoreLayout(box: Box, nodes: NodeLayout[], edges: number[][], paddedArea: number): number {
  const centers = nodes.map((node, vertex) => {
    const point = box.positions.get(vertex)!;
    return { x: point.x + node.width / 2, y: point.y + node.height / 2 };
  });
  let edgeCount = 0;
  let length = 0;
  for (let source = 0; source < edges.length; source++) {
    for (const target of edges[source]!) {
      length += Math.hypot(
        centers[source]!.x - centers[target]!.x,
        centers[source]!.y - centers[target]!.y,
      );
      edgeCount++;
    }
  }
  // Sample at most 64 edges; the crossing estimate examines at most 2,016 pairs.
  const stride = Math.max(1, Math.ceil(edgeCount / CROSSING_SAMPLE_LIMIT));
  const sample: [number, number][] = [];
  let edgeIndex = 0;
  for (let source = 0; source < edges.length; source++) {
    for (const target of edges[source]!) {
      if (edgeIndex++ % stride === 0) sample.push([source, target]);
    }
  }
  let crossings = 0;
  let pairs = 0;
  for (let a = 0; a < sample.length; a++) {
    const [a1, a2] = sample[a]!;
    for (let b = a + 1; b < sample.length; b++) {
      const [b1, b2] = sample[b]!;
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      pairs++;
      if (segmentsCross(centers[a1]!, centers[a2]!, centers[b1]!, centers[b2]!)) crossings++;
    }
  }
  const area = Math.max(1, box.width * box.height);
  return (
    Math.abs(Math.log(Math.max(1, box.width) / Math.max(1, box.height))) * 0.55 +
    Math.log(area / Math.max(1, paddedArea)) * 0.35 +
    (length / Math.max(1, edgeCount) / Math.sqrt(area)) * 0.4 +
    (crossings / Math.max(1, pairs)) * 2
  );
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

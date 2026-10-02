import { readFileSync, writeFileSync } from 'node:fs';
import {
  relationGeometry,
  segmentCrossesBounds,
} from '../../../apps/web/src/features/relations/relation-routing.ts';

const root = 'artifacts/repository-erd/';
const view = JSON.parse(readFileSync(root + 'routing-input.json', 'utf8'));
const nodes = view.nodes;
const edges = view.tableRelations;
const byId = new Map(nodes.map((n) => [n.objectId, n]));
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const segments = (points) => points.slice(1).map((b, i) => [points[i], b]);
const simplify = (points) => {
  const out = [];
  for (const p of points) {
    if (out.length && distance(out.at(-1), p) < 0.001) continue;
    while (
      out.length > 1 &&
      ((out.at(-2).x === out.at(-1).x && out.at(-1).x === p.x) ||
        (out.at(-2).y === out.at(-1).y && out.at(-1).y === p.y))
    )
      out.pop();
    out.push(p);
  }
  return out;
};
function pairCost(a, b) {
  let overlap = 0,
    crossings = 0;
  for (const [p, q] of a.segments)
    for (const [r, s] of b.segments) {
      const h = p.y === q.y,
        k = r.y === s.y;
      if (h === k) {
        if (h ? p.y === r.y : p.x === r.x)
          overlap += Math.max(
            0,
            Math.min(
              h ? Math.max(p.x, q.x) : Math.max(p.y, q.y),
              h ? Math.max(r.x, s.x) : Math.max(r.y, s.y),
            ) -
              Math.max(
                h ? Math.min(p.x, q.x) : Math.min(p.y, q.y),
                h ? Math.min(r.x, s.x) : Math.min(r.y, s.y),
              ),
          );
      } else {
        const [u, v, w, z] = h ? [p, q, r, s] : [r, s, p, q];
        if (
          w.x > Math.min(u.x, v.x) &&
          w.x < Math.max(u.x, v.x) &&
          u.y > Math.min(w.y, z.y) &&
          u.y < Math.max(w.y, z.y)
        )
          crossings++;
      }
    }
  return { overlap, crossings };
}
const make = (points, route) => ({
  points,
  route,
  segments: segments(points),
  length: segments(points).reduce((s, [a, b]) => s + distance(a, b), 0),
});
const port = (edge, source) => {
  const id = source ? edge.sourceTableId : edge.targetTableId;
  const peers = edges
    .filter((r) => (source ? r.sourceTableId : r.targetTableId) === id)
    .sort((a, b) => {
      const aa = byId.get(source ? a.targetTableId : a.sourceTableId),
        bb = byId.get(source ? b.targetTableId : b.sourceTableId);
      return aa.y - bb.y || a.id.localeCompare(b.id);
    });
  const n = byId.get(id),
    ratio = (peers.indexOf(edge) + 1) / (peers.length + 1);
  return {
    anchor: { side: source ? 'left' : 'right', ratio },
    point: { x: source ? n.x - 8 : n.x + n.width + 8, y: n.y + n.height * ratio },
  };
};
const baseline = edges.map((e, i) => {
  const a = byId.get(e.sourceTableId),
    b = byId.get(e.targetTableId);
  const lane = edges
    .slice(0, i)
    .filter(
      (r) => r.sourceTableId === e.sourceTableId && r.targetTableId === e.targetTableId,
    ).length;
  return make(
    relationGeometry(
      a,
      b,
      200,
      lane,
      0,
      undefined,
      nodes.filter((n) => n !== a && n !== b),
    ).points,
  );
});
const choices = edges.map((e, index) => {
  const source = port(e, true),
    target = port(e, false),
    a = source.point,
    b = target.point;
  const out = [];
  const add = (raw) => {
    const points = simplify(raw);
    if (points[1].x >= a.x || points.at(-2).x <= b.x) return;
    if (segments(points).some(([p, q]) => nodes.some((n) => segmentCrossesBounds(p, q, n)))) return;
    out.push(
      make(points, {
        relationId: e.id,
        viewId: view.view.id,
        offset: 0,
        sourceAnchor: source.anchor,
        targetAnchor: target.anchor,
        waypoints: points.slice(1, -1),
      }),
    );
  };
  for (let j = 1; j <= 15; j++) {
    const x = b.x + ((a.x - b.x) * j) / 16;
    add([a, { x, y: a.y }, { x, y: b.y }, b]);
  }
  const ys = [
    ...nodes.flatMap((n) => [n.y - 30 - index * 2, n.y + n.height + 30 + index * 2]),
    -80 - index * 24,
    Math.max(...nodes.map((n) => n.y + n.height)) + 80 + index * 24,
  ];
  for (const margin of [26, 66, 106, 146])
    for (const other of [26, 66, 106, 146])
      for (const y of ys) {
        const x1 = a.x - margin - index * 0.4,
          x2 = b.x + other + index * 0.4;
        if (x1 <= x2) continue;
        add([a, { x: x1, y: a.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: b.y }, b]);
      }
  if (!out.length) throw new Error(`No obstacle-free route: ${e.id}`);
  return out.sort((a, b) => a.length - b.length);
});
function stats(routes) {
  let overlap = 0,
    crossings = 0;
  for (let i = 0; i < routes.length; i++)
    for (const b of routes.slice(i + 1)) {
      const c = pairCost(routes[i], b);
      overlap += c.overlap;
      crossings += c.crossings;
    }
  return {
    overlapPixels: Math.round(overlap),
    crossings,
    length: Math.round(routes.reduce((s, r) => s + r.length, 0)),
    cardIntersections: routes.reduce(
      (s, r) =>
        s + r.segments.filter(([a, b]) => nodes.some((n) => segmentCrossesBounds(a, b, n))).length,
      0,
    ),
  };
}
let best,
  bestScore = Infinity;
for (let trial = 0; trial < 80; trial++) {
  const selected = Array(edges.length);
  const order = edges
    .map((_, i) => i)
    .sort((a, b) =>
      trial === 0
        ? choices[b][0].length - choices[a][0].length
        : Math.sin((a + 1) * (trial + 1) * 127.1) - Math.sin((b + 1) * (trial + 1) * 127.1),
    );
  for (let pass = 0; pass < 4; pass++)
    for (const index of order) {
      let winner,
        cost = Infinity;
      for (const candidate of choices[index]) {
        let value = candidate.length + candidate.segments.length * 20;
        for (let j = 0; j < selected.length; j++)
          if (j !== index && selected[j]) {
            const c = pairCost(candidate, selected[j]);
            value += c.overlap * 100000 + c.crossings * 100000;
          }
        if (value < cost) {
          cost = value;
          winner = candidate;
        }
      }
      selected[index] = winner;
    }
  const metrics = stats(selected),
    score = metrics.overlapPixels * 100000 + metrics.crossings * 100000 + metrics.length;
  if (score < bestScore) {
    bestScore = score;
    best = selected;
  }
}
// Validate using the application's actual manual-route renderer, not just planned paths.
const rendered = best.map((r, i) => {
  const e = edges[i],
    a = byId.get(e.sourceTableId),
    b = byId.get(e.targetTableId);
  const geometry = relationGeometry(
    a,
    b,
    200,
    0,
    0,
    undefined,
    nodes.filter((n) => n !== a && n !== b),
    r.route,
  );
  if (JSON.stringify(geometry.points) !== JSON.stringify(r.points))
    throw new Error(`Renderer changed route ${e.id}`);
  return make(geometry.points, r.route);
});
const result = {
  before: stats(baseline),
  after: stats(rendered),
  routes: rendered.map((r) => r.route),
};
if (result.after.cardIntersections || result.after.overlapPixels > result.before.overlapPixels)
  throw new Error(JSON.stringify({ before: result.before, after: result.after }));
writeFileSync(root + 'routing-result.json', JSON.stringify(result, null, 2));
const transfer = JSON.parse(readFileSync(root + 'ezerd-project.json', 'utf8'));
transfer.document.layout.nodes = transfer.document.layout.nodes
  .filter((n) => n.viewId !== view.view.id)
  .concat(nodes);
transfer.document.layout.relations = transfer.document.layout.relations
  .filter((r) => r.viewId !== view.view.id)
  .concat(result.routes);
transfer.document.views = transfer.document.views.map((v) =>
  v.id === view.view.id ? { ...v, name: view.view.name } : v,
);
writeFileSync(root + 'ezerd-project.json', JSON.stringify(transfer, null, 2));
console.log(
  JSON.stringify({
    before: result.before,
    after: result.after,
    candidates: choices.map((c) => c.length),
  }),
);

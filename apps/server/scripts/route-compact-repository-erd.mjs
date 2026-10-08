import { readFileSync, writeFileSync } from 'node:fs';
import {
  relationGeometry,
  segmentCrossesBounds,
} from '../../../apps/web/src/features/relations/relation-routing.ts';

const root = 'artifacts/repository-erd/current/';
const plan = JSON.parse(readFileSync(root + 'refresh-plan.json', 'utf8'));
const view = { view: { id: plan.viewId } };
const nodes = plan.nodes.map((n) => ({ ...n, x: n.y, y: n.x, width: n.height, height: n.width }));
const edges = plan.document.tableRelations;
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
    near = 0,
    crossings = 0;
  for (const [p, q] of a.segments)
    for (const [r, s] of b.segments) {
      const h = p.y === q.y,
        k = r.y === s.y;
      if (h === k) {
        if (Math.abs(h ? p.y - r.y : p.x - r.x) < 20)
          near += Math.max(
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
  const x = a.label,
    y = b.label;
  const labels =
    x &&
    y &&
    x.x < y.x + y.width &&
    y.x < x.x + x.width &&
    x.y < y.y + y.height &&
    y.y < x.y + x.height
      ? 1
      : 0;
  const rotated = (box) => ({ x: box.y, y: box.x, width: box.height, height: box.width });
  const labelLines =
    (y ? a.segments.filter(([p, q]) => segmentCrossesBounds(p, q, rotated(y))).length : 0) +
    (x ? b.segments.filter(([p, q]) => segmentCrossesBounds(p, q, rotated(x))).length : 0);
  return { overlap, near, crossings, labels, labelLines };
}
function labelBounds(points, edge) {
  const width = Math.max(90, 24 + edge.physical.name.length * 8);
  const spans = segments(points.map((p) => ({ x: p.y, y: p.x })))
    .map(([a, b]) => ({ a, b, length: distance(a, b) }))
    .sort((a, b) => b.length - a.length);
  const span = spans.find((s) => s.a.y === s.b.y && s.length >= width + 16) ?? spans[0];
  const x = (span.a.x + span.b.x) / 2;
  let y = (span.a.y + span.b.y) / 2 - 20;
  for (let i = 0; i <= plan.nodes.length + 1; i++) {
    const r = { x: x - width / 2 - 6, y: y - 16, width: width + 12, height: 32 };
    const hit = plan.nodes.find(
      (n) =>
        r.x < n.x + n.width && r.x + r.width > n.x && r.y < n.y + n.height && r.y + r.height > n.y,
    );
    if (!hit) break;
    y = hit.y - 36;
  }
  return { x: x - width / 2 - 6, y: y - 16, width: width + 12, height: 32 };
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
    const candidate = make(points, {
      relationId: e.id,
      viewId: view.view.id,
      offset: 0,
      sourceAnchor: source.anchor,
      targetAnchor: target.anchor,
      waypoints: points.slice(1, -1),
    });
    candidate.label = labelBounds(points, e);
    out.push(candidate);
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
    near = 0,
    labels = 0,
    labelLines = 0,
    crossings = 0;
  for (let i = 0; i < routes.length; i++)
    for (const b of routes.slice(i + 1)) {
      const c = pairCost(routes[i], b);
      overlap += c.overlap;
      near += c.near;
      labels += c.labels;
      labelLines += c.labelLines;
      crossings += c.crossings;
    }
  return {
    overlapPixels: Math.round(overlap),
    nearParallelPixels: Math.round(near),
    labels,
    labelLines,
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
for (let trial = 0; trial < 64; trial++) {
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
            value +=
              c.overlap * 1000000 +
              c.near * 100000 +
              c.crossings * 300000 +
              c.labels * 10000000 +
              c.labelLines * 500000;
          }
        if (value < cost) {
          cost = value;
          winner = candidate;
        }
      }
      selected[index] = winner;
    }
  const metrics = stats(selected),
    score =
      metrics.overlapPixels * 1000000 +
      metrics.nearParallelPixels * 100000 +
      metrics.crossings * 300000 +
      metrics.labels * 10000000 +
      metrics.labelLines * 500000 +
      metrics.length;
  if (score < bestScore) {
    bestScore = score;
    best = selected;
  }
}

const routes = best.map((r) => ({
  ...r.route,
  sourceAnchor: { ...r.route.sourceAnchor, side: 'top' },
  targetAnchor: { ...r.route.targetAnchor, side: 'bottom' },
  waypoints: r.route.waypoints.map((p) => ({ x: p.y, y: p.x })),
}));
const rendered = routes.map((r, i) => {
  const e = edges[i],
    a = plan.nodes.find((n) => n.objectId === e.sourceTableId),
    b = plan.nodes.find((n) => n.objectId === e.targetTableId);
  const label = e.physical.name;
  const geometry = relationGeometry(
    a,
    b,
    Math.max(90, 24 + label.length * 8),
    i,
    0,
    undefined,
    plan.nodes.filter((n) => n !== a && n !== b),
    r,
  );
  const expected = best[i].points.map((p) => ({ x: p.y, y: p.x }));
  if (JSON.stringify(expected) !== JSON.stringify(geometry.points))
    throw new Error('Renderer changed ' + e.id);
  return { id: e.id, label, geometry };
});
let labelCollisions = 0;
const labels = rendered.map((r) => ({
  x: r.geometry.labelX - (24 + r.label.length * 8) / 2,
  y: r.geometry.labelY - 16,
  width: 24 + r.label.length * 8,
  height: 32,
}));
for (let i = 0; i < labels.length; i++)
  for (const b of labels.slice(i + 1)) {
    const a = labels[i];
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
      labelCollisions++;
  }
const output = {
  before: stats(baseline),
  after: { ...stats(best), labelCollisions },
  routes,
  rendered,
};
writeFileSync(root + 'compact-routes.json', JSON.stringify(output, null, 2));
console.log(
  JSON.stringify({
    before: output.before,
    after: output.after,
    candidates: choices.map((v) => v.length),
  }),
);

export type Point = { x: number; y: number };
export type RelationBounds = Point & { width: number; height: number };
type Port = { tip: Point; stub: Point; axis: 0 | 1 };
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const expand = (r: RelationBounds, p: number): RelationBounds => ({
  x: r.x - p,
  y: r.y - p,
  width: r.width + 2 * p,
  height: r.height + 2 * p,
});
const inside = (p: Point, r: RelationBounds) =>
  p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
export function segmentCrossesBounds(a: Point, b: Point, r: RelationBounds) {
  if (a.x === b.x)
    return (
      a.x > r.x &&
      a.x < r.x + r.width &&
      Math.max(a.y, b.y) > r.y &&
      Math.min(a.y, b.y) < r.y + r.height
    );
  if (a.y === b.y)
    return (
      a.y > r.y &&
      a.y < r.y + r.height &&
      Math.max(a.x, b.x) > r.x &&
      Math.min(a.x, b.x) < r.x + r.width
    );
  return true;
}
function simplify(points: Point[]) {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length && same(result[result.length - 1]!, point)) continue;
    while (result.length > 1) {
      const a = result[result.length - 2]!,
        b = result[result.length - 1]!;
      if (
        ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)) &&
        distance(a, b) + distance(b, point) === distance(a, point)
      )
        result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}
function ports(r: RelationBounds, lane: number): Port[] {
  const shift = lane === 0 ? 0 : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * 22;
  const x = r.x + r.width / 2 + Math.max(-r.width / 2 + 36, Math.min(r.width / 2 - 36, shift));
  const y = r.y + r.height / 2 + Math.max(-r.height / 2 + 36, Math.min(r.height / 2 - 36, shift));
  return [
    { tip: { x: r.x + r.width + 8, y }, stub: { x: r.x + r.width + 44, y }, axis: 0 },
    { tip: { x: r.x - 8, y }, stub: { x: r.x - 44, y }, axis: 0 },
    { tip: { x, y: r.y - 8 }, stub: { x, y: r.y - 44 }, axis: 1 },
    { tip: { x, y: r.y + r.height + 8 }, stub: { x, y: r.y + r.height + 44 }, axis: 1 },
  ];
}
const clear = (points: Point[], boxes: RelationBounds[]) =>
  points.every((p, i) => !i || !boxes.some((r) => segmentCrossesBounds(points[i - 1]!, p, r)));
function retraces(points: Point[]) {
  for (let i = 1; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i - 1]!,
        b = points[i]!,
        c = points[j - 1]!,
        d = points[j]!;
      if (
        a.x === b.x &&
        c.x === d.x &&
        a.x === c.x &&
        Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >
          Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
      )
        return true;
      if (
        a.y === b.y &&
        c.y === d.y &&
        a.y === c.y &&
        Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >
          Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
      )
        return true;
    }
  return new Set(points.map((p) => p.x + ',' + p.y)).size !== points.length;
}
function score(points: Point[]) {
  return (
    points.reduce((n, p, i) => n + (i ? distance(points[i - 1]!, p) : 0), 0) +
    Math.max(0, points.length - 2) * 48
  );
}
/** Sparse visibility grid, with a direction penalty to prefer fewer orthogonal bends. */
function search(
  start: Point,
  end: Point,
  boxes: RelationBounds[],
  startAxis?: 0 | 1,
  endAxis?: 0 | 1,
): Point[] | null {
  if (same(start, end)) return [start];
  const xs = [...new Set([start.x, end.x, ...boxes.flatMap((r) => [r.x, r.x + r.width])])].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set([start.y, end.y, ...boxes.flatMap((r) => [r.y, r.y + r.height])])].sort(
    (a, b) => a - b,
  );
  const point = (index: number): Point => ({
    x: xs[index % xs.length]!,
    y: ys[Math.floor(index / xs.length)]!,
  });
  const from = ys.indexOf(start.y) * xs.length + xs.indexOf(start.x),
    to = ys.indexOf(end.y) * xs.length + xs.indexOf(end.x);
  type Entry = { key: number; cost: number; priority: number };
  const heap: Entry[] = [];
  const push = (v: Entry) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.priority <= v.priority) break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = v;
  };
  const pop = () => {
    const first = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1]!.priority < heap[c]!.priority) c++;
        if (heap[c]!.priority >= last.priority) break;
        heap[i] = heap[c]!;
        i = c;
      }
      heap[i] = last;
    }
    return first;
  };
  const costs = new Map<number, number>(),
    previous = new Map<number, number>();
  for (const axis of [0, 1]) {
    const key = from * 2 + axis;
    costs.set(key, 0);
    push({ key, cost: 0, priority: distance(start, end) });
  }
  while (heap.length) {
    const current = pop();
    if (current.cost !== costs.get(current.key)) continue;
    const at = Math.floor(current.key / 2),
      axis = current.key % 2,
      p = point(at);
    if (at === to && (endAxis === undefined || axis === endAxis)) {
      const result: Point[] = [];
      let key: number | undefined = current.key;
      while (key !== undefined) {
        result.push(point(Math.floor(key / 2)));
        key = previous.get(key);
      }
      return simplify(result.reverse());
    }
    const x = at % xs.length,
      y = Math.floor(at / xs.length);
    for (const [nx, ny, nextAxis] of [
      [x - 1, y, 0],
      [x + 1, y, 0],
      [x, y - 1, 1],
      [x, y + 1, 1],
    ]) {
      if (nx! < 0 || ny! < 0 || nx! >= xs.length || ny! >= ys.length) continue;
      if (at === from && startAxis !== undefined && nextAxis !== startAxis) continue;
      const next = ny! * xs.length + nx!,
        q = point(next);
      if (boxes.some((r) => inside(q, r) || segmentCrossesBounds(p, q, r))) continue;
      const key = next * 2 + nextAxis!,
        cost = current.cost + distance(p, q) + (axis === nextAxis ? 0 : 48);
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost);
      previous.set(key, current.key);
      push({ key, cost, priority: cost + distance(q, end) });
    }
  }
  return null;
}
function outsidePoint(point: Point, boxes: RelationBounds[]): Point {
  let result = { ...point };
  for (let i = 0; i <= boxes.length; i++) {
    const hit = boxes.find((r) => inside(result, r));
    if (!hit) return result;
    const options = [
      { x: hit.x, y: result.y },
      { x: hit.x + hit.width, y: result.y },
      { x: result.x, y: hit.y },
      { x: result.x, y: hit.y + hit.height },
    ];
    const free = options.filter((p) => !boxes.some((r) => inside(p, r)));
    result = (free.length ? free : options).sort(
      (a, b) => distance(a, point) - distance(b, point),
    )[0]!;
  }
  return { x: Math.min(...boxes.map((r) => r.x)) - 44, y: point.y };
}
export function relationGeometry(
  a: RelationBounds,
  b: RelationBounds,
  labelWidth: number,
  lane: number,
  offset = 0,
  bend?: Point,
  obstacles: RelationBounds[] = [],
) {
  const self =
    a === b || (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
  const raw = [a, ...(self ? [] : [b]), ...obstacles];
  const boxes = raw.map((r) => expand(r, 18));
  const source = ports(a, lane),
    target = ports(b, lane);
  const requested = bend ? outsidePoint(bend, boxes) : undefined;
  const xs = [
    ...new Set([...boxes.flatMap((r) => [r.x, r.x + r.width]), (a.x + a.width + b.x) / 2]),
  ];
  const ys = [
    ...new Set([
      ...boxes.flatMap((r) => [
        r.y - 36 - lane * 22 - offset,
        r.y + r.height + 36 + lane * 22 + offset,
      ]),
      (a.y + a.height / 2 + b.y + b.height / 2) / 2,
    ]),
  ];
  let best: Point[] | undefined,
    bestScore = Infinity;
  const candidates: Array<{ s: Port; t: Port }> = [];
  for (const [si, s] of source.entries())
    for (const [ti, t] of target.entries()) {
      if (self && si === ti) continue;
      if (!clear([s.tip, s.stub], raw) || !clear([t.stub, t.tip], raw)) continue;
      if (boxes.some((r) => inside(s.stub, r) || inside(t.stub, r))) continue;
      candidates.push({ s, t });
    }
  const consider = (s: Port, t: Port, middle: Point[]) => {
    if (!clear(middle, boxes)) return;
    const points = simplify([s.tip, ...middle, t.tip]);
    // Simplification must not reverse an attachment into the table.
    if (!clear(points, raw) || retraces(points)) return;
    if (requested && !points.slice(1, -1).some((p) => same(p, requested))) return;
    const cost = score(points);
    if (cost < bestScore) {
      best = points;
      bestScore = cost;
    }
    return true;
  };
  const sourcePaths = new Map<string, Point[] | null>(),
    targetPaths = new Map<string, Point[] | null>();
  if (requested)
    candidates.sort(
      (a, b) =>
        distance(a.s.stub, requested) +
        distance(requested, a.t.stub) -
        (distance(b.s.stub, requested) + distance(requested, b.t.stub)),
    );
  for (const { s, t } of candidates) {
    if (requested) {
      if (distance(s.stub, requested) + distance(requested, t.stub) + 72 >= bestScore) continue;
      const firstDirect = [
        [s.stub, { x: s.stub.x, y: requested.y }, requested],
        [s.stub, { x: requested.x, y: s.stub.y }, requested],
      ];
      const lastDirect = [
        [requested, { x: requested.x, y: t.stub.y }, t.stub],
        [requested, { x: t.stub.x, y: requested.y }, t.stub],
      ];
      let direct = false;
      for (const before of firstDirect)
        for (const after of lastDirect) direct = !!consider(s, t, [...before, ...after]) || direct;
      if (direct || distance(s.stub, requested) + distance(requested, t.stub) + 72 >= bestScore)
        continue;
      for (const axis of [0, 1] as const) {
        const sk = s.stub.x + ',' + s.stub.y + ':' + axis,
          tk = t.stub.x + ',' + t.stub.y + ':' + axis;
        if (!sourcePaths.has(sk))
          sourcePaths.set(sk, search(s.stub, requested, boxes, undefined, axis));
        if (!targetPaths.has(tk))
          targetPaths.set(tk, search(requested, t.stub, boxes, axis === 0 ? 1 : 0));
        const first = sourcePaths.get(sk),
          last = targetPaths.get(tk);
        for (const before of [...firstDirect, ...(first ? [first] : [])])
          for (const after of [...lastDirect, ...(last ? [last] : [])])
            consider(s, t, [...before, ...after]);
      }
      continue;
    }
    consider(s, t, [s.stub, { x: s.stub.x, y: t.stub.y }, t.stub]);
    consider(s, t, [s.stub, { x: t.stub.x, y: s.stub.y }, t.stub]);
    for (const x of xs) consider(s, t, [s.stub, { x, y: s.stub.y }, { x, y: t.stub.y }, t.stub]);
    for (const y of ys) consider(s, t, [s.stub, { x: s.stub.x, y }, { x: t.stub.x, y }, t.stub]);
  }
  if (!best)
    for (const { s, t } of candidates) {
      const middle = search(s.stub, t.stub, boxes);
      if (middle) consider(s, t, middle);
    }
  // Overlapping cards can enclose every port; keep a visible exterior loop until they are separated.
  if (!best) {
    const s = source[2]!,
      t = target[self ? 0 : 2]!,
      top = Math.min(...raw.map((r) => r.y)) - 64 - lane * 24;
    best = simplify([s.tip, { x: s.tip.x, y: top }, { x: t.stub.x, y: top }, t.stub, t.tip]);
  }
  const points = best;
  const segments = points
    .slice(1)
    .map((p, i) => ({ a: points[i]!, b: p, length: distance(points[i]!, p) }))
    .sort((a, b) => b.length - a.length);
  const segment =
    segments.find((s) => s.a.y === s.b.y && s.length >= labelWidth + 16) ?? segments[0]!;
  const anchor = requested ?? {
    x: (segment.a.x + segment.b.x) / 2,
    y: (segment.a.y + segment.b.y) / 2,
  };
  let labelX = anchor.x,
    labelY = anchor.y - 20;
  for (let i = 0; i <= raw.length + 1; i++) {
    const label = {
      x: labelX - labelWidth / 2 - 6,
      y: labelY - 16,
      width: labelWidth + 12,
      height: 32,
    };
    const hit = raw.find(
      (r) =>
        label.x < r.x + r.width &&
        label.x + label.width > r.x &&
        label.y < r.y + r.height &&
        label.y + label.height > r.y,
    );
    if (!hit) break;
    labelY = hit.y - 36;
  }
  return {
    points,
    path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
    labelX,
    labelY,
    handle: anchor,
  };
}

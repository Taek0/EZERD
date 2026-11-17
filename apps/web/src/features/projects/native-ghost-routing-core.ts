import { relationGeometry, type RelationBounds } from '../relations/relation-routing.js';

export type NativeSceneGeometry = ReturnType<typeof relationGeometry>;
export interface NativeSceneRoutingInput {
  /** Shared once; relation entries refer to indices instead of duplicating obstacles. */
  bounds: RelationBounds[];
  relations: Array<{
    source: number;
    target: number;
    labelWidth: number;
    lane: number;
    offset: number;
    bend?: { x: number; y: number };
    options: Parameters<typeof relationGeometry>[7];
  }>;
}
export const nativeSceneRoutingKey = (input: NativeSceneRoutingInput) => JSON.stringify(input);

/** Ordinary moved-scene routing, identical to the synchronous canvas algorithm. */
export function routeNativeScene(input: NativeSceneRoutingInput): NativeSceneGeometry[] {
  return input.relations.map((relation) =>
    relationGeometry(
      input.bounds[relation.source]!,
      input.bounds[relation.target]!,
      relation.labelWidth,
      relation.lane,
      relation.offset,
      relation.bend,
      input.bounds.filter((_, index) => index !== relation.source && index !== relation.target),
      relation.options,
    ),
  );
}

const point = (value: unknown): value is { x: number; y: number } =>
  !!value &&
  typeof value === 'object' &&
  'x' in value &&
  'y' in value &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y);
/** Reject malformed/nonfinite paths before installing any scene or cache entry. */
export function validNativeSceneRoutingResult(
  value: unknown,
  count: number,
  input?: NativeSceneRoutingInput,
): value is NativeSceneGeometry[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((geometry: unknown, index) => {
      if (
        !geometry ||
        typeof geometry !== 'object' ||
        !('points' in geometry) ||
        !Array.isArray(geometry.points) ||
        geometry.points.length < 2 ||
        !geometry.points.every(point) ||
        !('handle' in geometry) ||
        !point(geometry.handle) ||
        !('labelX' in geometry) ||
        !Number.isFinite(geometry.labelX) ||
        !('labelY' in geometry) ||
        !Number.isFinite(geometry.labelY) ||
        !('path' in geometry)
      )
        return false;
      const endpointMatches = (p: { x: number; y: number }, bounds: RelationBounds) =>
        ((p.x === bounds.x - 8 || p.x === bounds.x + bounds.width + 8) &&
          p.y >= bounds.y &&
          p.y <= bounds.y + bounds.height) ||
        ((p.y === bounds.y - 8 || p.y === bounds.y + bounds.height + 8) &&
          p.x >= bounds.x &&
          p.x <= bounds.x + bounds.width);
      const relation = input?.relations[index];
      if (
        input &&
        relation &&
        (!endpointMatches(geometry.points[0]!, input.bounds[relation.source]!) ||
          !endpointMatches(geometry.points.at(-1)!, input.bounds[relation.target]!))
      )
        return false;
      return (
        geometry.path ===
          geometry.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') &&
        geometry.points.every(
          (p, i, points) => i === 0 || p.x === points[i - 1]!.x || p.y === points[i - 1]!.y,
        )
      );
    })
  );
}
export interface NativeSceneRoutingCache {
  get(input: NativeSceneRoutingInput): NativeSceneGeometry[] | undefined;
  set(input: NativeSceneRoutingInput, geometries: NativeSceneGeometry[]): void;
}
/** One latest result; no approximation and no retained document/React objects. */
export function createNativeSceneRoutingCache(): NativeSceneRoutingCache {
  let latest: { key: string; geometries: NativeSceneGeometry[] } | undefined;
  return {
    get(input) {
      return latest?.key === nativeSceneRoutingKey(input) ? latest.geometries : undefined;
    },
    set(input, geometries) {
      if (!validNativeSceneRoutingResult(geometries, input.relations.length, input))
        throw Error('canvas.placement-invalid');
      latest = { key: nativeSceneRoutingKey(input), geometries };
    },
  };
}

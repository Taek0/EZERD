import type { NativeTableRelation } from '@ezerd/model';
export type NativeRelationEnd = { min: 0 | 1; max: 1 | 'many' };
export function nativeRelationEnds(
  relation: NativeTableRelation,
): [NativeRelationEnd, NativeRelationEnd] {
  return [
    relation.logical.sourceCardinality ?? {
      min: 0,
      max: relation.logical.cardinality === 'one-to-one' ? 1 : 'many',
    },
    relation.logical.targetCardinality ?? {
      min: relation.logical.required ? 1 : 0,
      max: relation.logical.cardinality === 'many-to-many' ? 'many' : 1,
    },
  ];
}
export const nativeRelationEndPath = (max: 1 | 'many') =>
  max === 'many' ? 'M 18 12 L 30 3 M 18 12 L 30 21 M 18 12 L 30 12' : 'M 27 4 L 27 20';

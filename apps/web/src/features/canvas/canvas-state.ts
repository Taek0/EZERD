import { basicCardSize } from '@ezerd/model';
export function cardSize(kind: 'domain' | 'table' | 'note', width: number, height: number) {
  return basicCardSize(kind, width, height);
}
export function connectedRelations<T extends { sourceDomainId: string; targetDomainId: string }>(
  relations: T[],
  selected: string,
): T[] {
  return relations.filter(
    (relation) => relation.sourceDomainId === selected || relation.targetDomainId === selected,
  );
}

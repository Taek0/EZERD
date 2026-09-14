export function cardSize(kind: 'domain' | 'table' | 'note', width: number, height: number) {
  const min = kind === 'domain' ? [240, 210] : kind === 'table' ? [280, 220] : [160, 110];
  return { width: Math.max(min[0]!, width), height: Math.max(min[1]!, height) };
}
export function relationTargets<T extends { id: string }>(domains: T[], source: string): T[] {
  return domains.filter(domain => domain.id !== source);
}
export function connectedRelations<T extends { sourceDomainId: string; targetDomainId: string }>(relations: T[], selected: string): T[] {
  return relations.filter(relation => relation.sourceDomainId === selected || relation.targetDomainId === selected);
}

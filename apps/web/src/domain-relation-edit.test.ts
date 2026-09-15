import { describe, expect, it } from 'vitest';
import { addDomain, createEmptyDocument, upsertDomainRelation } from '@ezerd/model';
import { applyDomainRelationPatch } from './domain-relation-edit.js';

function fixture() {
  let doc = createEmptyDocument();
  for (const id of ['a', 'b', 'c'])
    doc = addDomain(doc, { id, name: id, description: '' }, { x: 0, y: 0 });
  return upsertDomainRelation(doc, {
    id: 'r',
    sourceDomainId: 'a',
    targetDomainId: 'b',
    name: '흐름',
    direction: 'forward',
    description: '',
  });
}
describe('domain relation immediate field edits', () => {
  it('retains remote fields and unrelated document changes', () => {
    const latest = fixture();
    latest.domainRelations[0]!.description = '원격 설명';
    latest.domainRelations[0]!.targetDomainId = 'c';
    const next = applyDomainRelationPatch(latest, 'r', { name: ' 새 이름 ' });
    expect(next.domainRelations[0]).toMatchObject({
      name: '새 이름',
      description: '원격 설명',
      targetDomainId: 'c',
    });
    expect(next.domains).toEqual(latest.domains);
    expect(latest.domainRelations[0]!.name).toBe('흐름');
  });
  it.each([
    { name: '  ' },
    { sourceDomainId: '' },
    { targetDomainId: 'missing' },
    { sourceDomainId: 'b' },
  ])('rejects invalid input %j without changing the document', (patch) => {
    const doc = fixture();
    expect(applyDomainRelationPatch(doc, 'r', patch)).toBe(doc);
  });
  it('does not recreate a remotely deleted relationship', () => {
    const doc = fixture();
    doc.domainRelations = [];
    expect(applyDomainRelationPatch(doc, 'r', { name: 'new' })).toBe(doc);
  });
  it('applies each endpoint, direction and description independently', () => {
    const doc = fixture();
    expect(
      applyDomainRelationPatch(doc, 'r', { sourceDomainId: 'c' }).domainRelations[0]!
        .sourceDomainId,
    ).toBe('c');
    expect(
      applyDomainRelationPatch(doc, 'r', { direction: 'both' }).domainRelations[0]!.direction,
    ).toBe('both');
    expect(
      applyDomainRelationPatch(doc, 'r', { description: '설명' }).domainRelations[0]!.description,
    ).toBe('설명');
  });
});

import { describe, expect, it } from 'vitest';
import { cardSize, connectedRelations } from './canvas-state.js';
describe('canvas domain interactions', () => {
  it('lists incoming and outgoing relationships for the selected domain', () => {
    const relations = [
      { sourceDomainId: 'a', targetDomainId: 'b' },
      { sourceDomainId: 'c', targetDomainId: 'a' },
      { sourceDomainId: 'b', targetDomainId: 'c' },
    ];
    expect(connectedRelations(relations, 'a')).toEqual(relations.slice(0, 2));
  });
  it('keeps resized domain and table content above safe minimum dimensions', () => {
    expect(cardSize('domain', 40, 60)).toEqual({ width: 240, height: 210 });
    expect(cardSize('table', 100, 40)).toEqual({ width: 280, height: 220 });
    expect(cardSize('note', 320, 300)).toEqual({ width: 320, height: 300 });
  });
});

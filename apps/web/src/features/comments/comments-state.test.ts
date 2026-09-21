import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addDomain, removeDomain, updateNodeLayout } from '@ezerd/model';
import { pinPosition, pinAttachment, selectedMentions, LatestRequest } from './comments-state.js';
describe('review pins and mentions', () => {
  const doc = addDomain(
    createEmptyDocument(),
    { id: 'd', name: 'Domain', description: '' },
    { x: 100, y: 200 },
  );
  const thread = { viewId: 'overview', objectId: 'd', x: 12, y: 24 };
  it('stores object-relative pins and follows moved objects', () => {
    expect(pinAttachment(doc, 'overview', 'd', { x: 112, y: 224 })).toEqual({
      objectId: 'd',
      x: 12,
      y: 24,
    });
    expect(pinPosition(updateNodeLayout(doc, 'node:d', { x: 400 }), thread)).toEqual({
      x: 412,
      y: 224,
      missing: false,
    });
  });
  it('preserves threads with deleted targets and keeps blank pins absolute', () => {
    expect(pinPosition(removeDomain(doc, 'd'), thread).missing).toBe(true);
    expect(pinPosition(doc, { ...thread, objectId: null })).toEqual({
      x: 12,
      y: 24,
      missing: false,
    });
    expect(pinAttachment(doc, 'overview', 'missing', { x: 7, y: 8 })).toEqual({
      objectId: null,
      x: 7,
      y: 8,
    });
  });
  it('marks blank pins in deleted domain views as missing', () => {
    expect(pinPosition(doc, { viewId: 'deleted-domain', objectId: null, x: 7, y: 8 }).missing).toBe(
      true,
    );
  });
  it('mentions only selected existing IDs, not ambiguous typed names', () => {
    expect(selectedMentions(['a', 'a', 'unknown', 'b'], [{ id: 'a' }, { id: 'b' }])).toEqual([
      'a',
      'b',
    ]);
  });
  it('ignores responses from superseded navigation requests', () => {
    const gate = new LatestRequest();
    const old = gate.begin();
    const next = gate.begin();
    expect(gate.isCurrent(old)).toBe(false);
    expect(gate.isCurrent(next)).toBe(true);
    gate.begin();
    expect(gate.isCurrent(next)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createEmptyDocument, diagnoseDocument } from './index.js';
import type { DesignDocument } from './index.js';

describe('draft document diagnostics', () => {
  it('reports invisible draft objects and missing relation endpoints without rewriting a draft', () => {
    const doc: DesignDocument = {
      ...createEmptyDocument(), domains: [{ id: 'd', name: '', description: '' }],
      domainRelations: [{ id: 'r', sourceDomainId: 'd', targetDomainId: 'gone', name: '', direction: 'forward', description: '' }],
    };
    const snapshot = structuredClone(doc);
    expect(diagnoseDocument(doc).map(d => [d.code, d.objectId])).toEqual([['missing-domain', 'r'], ['missing-layout', 'd']]);
    expect(doc).toEqual(snapshot);
  });
  it('diagnoses detached screen state as well as orphan text and layouts', () => {
    const doc: DesignDocument = { ...createEmptyDocument(), notes: [{ id: 'n', viewId: 'deleted', text: 'kept draft' }], layout: { nodes: [{ id: 'l', objectId: 'gone', viewId: 'overview', x: 0, y: 0, width: 200, height: 100 }], viewports: [{ viewId: 'deleted', x: 0, y: 0, zoom: 1 }] } };
    expect(diagnoseDocument(doc).map(d => d.code)).toContain('missing-viewport-domain');
    expect(diagnoseDocument(doc).map(d => d.code)).toContain('missing-view');
    expect(diagnoseDocument(doc).map(d => d.code)).toContain('invalid-layout-target');
  });
});

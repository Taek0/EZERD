import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from './document.js';
import {
  extractPersonalState,
  mergeStoredPersonalState,
  reconcilePersonalState,
} from './personal.js';
import { sharedDocument } from './sync.js';

describe('personal document state', () => {
  it('keeps combined notes, nodes and camera separate from shared changes', () => {
    const document = createEmptyDocument();
    document.domains = [{ id: 'sales', name: 'Sales', description: '' }];
    document.views = [{ id: 'combined', name: 'Together', domainIds: ['sales'] }];
    document.notes = [{ id: 'note', viewId: 'combined', text: 'Private note' }];
    document.layout.nodes = [
      {
        id: 'node:sales',
        objectId: 'sales',
        viewId: 'overview',
        x: 0,
        y: 0,
        width: 240,
        height: 140,
      },
      {
        id: 'node:note',
        objectId: 'note',
        viewId: 'combined',
        x: 20,
        y: 20,
        width: 240,
        height: 140,
      },
    ];
    document.layout.viewports.push({ viewId: 'combined', x: 10, y: 20, zoom: 1.2 });
    const personal = extractPersonalState(document);
    const shared = sharedDocument(document);
    expect(shared.views).toBeUndefined();
    expect(shared.notes).toEqual([]);
    expect(shared.layout.nodes).toHaveLength(1);
    expect(mergeStoredPersonalState(shared, personal)).toMatchObject(document);
  });

  it('drops references to domains and tables removed from the shared document', () => {
    const shared = createEmptyDocument();
    shared.domains = [{ id: 'sales', name: 'Sales', description: '' }];
    const personal = {
      views: [
        { id: 'combined', name: 'Together', domainIds: ['sales'] },
        { id: 'deleted-view', name: 'Deleted', domainIds: ['missing'] },
      ],
      notes: [],
      nodes: [
        {
          id: 'node:old',
          objectId: 'old-table',
          viewId: 'combined',
          x: 0,
          y: 0,
          width: 240,
          height: 180,
        },
      ],
      viewports: [
        { viewId: 'overview', x: 0, y: 0, zoom: 1 },
        { viewId: 'deleted-view', x: 0, y: 0, zoom: 1 },
      ],
      relations: [],
    };
    expect(reconcilePersonalState(shared, personal)).toMatchObject({
      views: [{ id: 'combined' }],
      nodes: [],
      viewports: [{ viewId: 'overview' }],
    });
  });
});

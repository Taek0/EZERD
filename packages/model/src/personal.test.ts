import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from './document.js';
import {
  extractPersonalState,
  mergeStoredPersonalState,
  reconcilePersonalState,
} from './personal.js';
import { sharedDocument } from './sync.js';
import { createEmptyNativeDocument } from './database/native-document.js';
import { defaultDatabaseContext } from './database/profiles.js';

describe('personal document state', () => {
  it('merges and reconciles native private state without losing indexes/checks or DB context', () => {
    const source = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    source.domains = [{ id: 'd', name: '', description: '' }];
    source.tables = [
      {
        id: 't',
        domainId: 'd',
        scope: 'logical',
        logical: { name: '', definition: '' },
        physical: {
          name: '',
          namespace: { kind: 'postgresSchema', name: 'public' },
          options: { database: 'postgresql' },
          comment: '',
        },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    source.indexes = [
      {
        id: 'index',
        tableId: 't',
        name: '',
        scope: 'logical',
        unique: false,
        parts: [
          {
            direction: 'asc',
            expression: { kind: 'literal', literalType: 'number', value: '12345678901234567890' },
          },
        ],
        options: { database: 'postgresql', method: 'btree' },
      },
    ];
    source.checks = [
      {
        id: 'check',
        tableId: 't',
        name: '',
        scope: 'logical',
        expression: { kind: 'literal', literalType: 'boolean', value: true },
      },
    ];
    const before = structuredClone(source);
    const personal = {
      views: [{ id: 'v', name: '', domainIds: ['d'] }],
      notes: [{ id: 'note', viewId: 'v', text: 'private' }],
      nodes: [{ id: 'node', viewId: 'v', objectId: 'note', x: 0, y: 0, width: 240, height: 160 }],
      viewports: [{ viewId: 'v', x: 1, y: 2, zoom: 1 }],
      relations: [],
    };
    const merged = mergeStoredPersonalState(source, personal);
    expect(merged.schemaVersion).toBe(2);
    expect(merged.database).toEqual(source.database);
    expect(merged.indexes).toEqual(source.indexes);
    expect(merged.checks).toEqual(source.checks);
    expect(extractPersonalState(merged)).toEqual(personal);
    expect(reconcilePersonalState(source, personal)).toEqual(personal);
    expect(sharedDocument(merged)).toEqual(sharedDocument(source));
    expect(source).toEqual(before);
  });
  it('does not resurrect old shared combined-view notes/placements after a user removes their private view', () => {
    const source = createEmptyDocument();
    source.views = [{ id: 'old', name: '', domainIds: ['d'] }];
    source.notes = [
      { id: 'old-note', viewId: 'old', text: 'old private' },
      { id: 'shared', viewId: '__tables__', text: 'shared' },
    ];
    source.layout.nodes = [
      { id: 'old-node', objectId: 'old-note', viewId: 'old', x: 0, y: 0, width: 240, height: 160 },
    ];
    source.layout.relations = [{ relationId: 'r', viewId: 'old', offset: 0 }];
    const before = structuredClone(source);
    const merged = mergeStoredPersonalState(source, {
      views: [],
      notes: [],
      nodes: [],
      viewports: [],
      relations: [],
    });
    expect(merged.notes).toEqual([{ id: 'shared', viewId: '__tables__', text: 'shared' }]);
    expect(merged.layout.nodes).toEqual([]);
    expect(merged.layout.relations).toEqual([]);
    expect(sharedDocument(merged)).toEqual(sharedDocument(source));
    expect(source).toEqual(before);
  });
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

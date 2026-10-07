import { describe, expect, it } from 'vitest';
import type { NativeSyncOperationResult } from '@ezerd/contracts';
import { clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { projectEntry } from './project-entry.js';
import { nativeEntryAfterAck } from './native-ack-entry.js';
import {
  normalizeSharedTableCanvas,
  TABLES_VIEW_ID,
  createEmptyNativeDocument,
  createNativeTable,
  type NativeDesignDocument,
} from '@ezerd/model';
import { nativeCanvasScene } from './NativeERDCanvas.js';

// Match the read-only server reader's canonical ID contract, including long imported IDs.
function readerPreview(document: NativeDesignDocument) {
  return normalizeSharedTableCanvas(document, {
    nodeId: (tableId) => `node:${tableId.slice(0, 128)}:${TABLES_VIEW_ID}`,
  });
}
function sparseFixture() {
  const { entry, ack } = fixture();
  if (
    entry.snapshot.sourceDocument.schemaVersion !== 2 ||
    entry.snapshot.native.status !== 'available'
  )
    throw Error('native');
  const raw = structuredClone(entry.snapshot.sourceDocument);
  raw.tables!.forEach((table) => {
    table.scope = 'physical';
  });
  raw.columns!.forEach((column) => {
    column.scope = 'physical';
  });
  raw.layout.nodes = raw.layout.nodes.filter((node) => node.objectId !== 'a');
  entry.snapshot.sourceDocument = raw;
  entry.snapshot.native.document = readerPreview(raw);
  entry.document = entry.snapshot.native.document;
  ack.document = structuredClone(raw);
  ack.document.columns![0]!.physical.name = 'id';
  ack.changedPaths = ['/columns/ca/physical/name'];
  return { entry, ack, raw };
}
function fixture() {
  const snapshot = clipboardSnapshot();
  const entry = projectEntry(snapshot);
  if (entry.kind !== 'native' || snapshot.sourceDocument.schemaVersion !== 2) throw Error('native');
  const document = structuredClone(snapshot.sourceDocument);
  document.layout.nodes[0]!.x += 80;
  const id = '00000000-0000-4000-8000-000000000001';
  const ack: NativeSyncOperationResult = {
    protocolVersion: 2,
    database: document.database,
    databaseRevision: snapshot.project.databaseRevision,
    operationId: id,
    groupId: id,
    sequence: snapshot.sequence + 1,
    status: 'accepted',
    actor: { id, username: 'test', color: '#123456' },
    changedPaths: ['/layout/nodes/a/x'],
    createdAt: '2026-10-07T00:00:00Z',
    document,
    nextBaseline: {
      baselineId: id,
      baseSequence: snapshot.sequence + 1,
      baselineIssuedAt: '2026-10-07T00:00:00Z',
      databaseRevision: snapshot.project.databaseRevision,
    },
  };
  return { entry, ack };
}
describe('native ACK document confirmation', () => {
  it('keeps both physical tables visible after a column ACK when raw storage omits one placement', () => {
    const { entry, ack, raw } = sparseFixture();
    const before = structuredClone({ entry, ack });
    expect(
      nativeCanvasScene(entry.document!, TABLES_VIEW_ID, 'physical')
        .nodes.map((node) => node.objectId)
        .sort(),
    ).toEqual(['a', 'b']);
    const next = nativeEntryAfterAck(entry, ack)!;
    expect(
      nativeCanvasScene(next.document!, TABLES_VIEW_ID, 'physical')
        .nodes.map((node) => node.objectId)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(next.document!.layout.nodes.find((node) => node.objectId === 'a')).toEqual(
      entry.document!.layout.nodes.find((node) => node.objectId === 'a'),
    );
    expect(next.document!.layout.nodes.find((node) => node.objectId === 'b')).toBe(
      raw.layout.nodes[0],
    );
    expect(next.snapshot.sourceDocument).toEqual(ack.document);
    expect(next.snapshot.sourceDocument.layout.nodes.map((node) => node.objectId)).toEqual(['b']);
    if (next.snapshot.native.status !== 'available') throw Error('native');
    expect(next.snapshot.native.document).toEqual(readerPreview(ack.document!));
    expect(next.document!.columns![0]!.physical.name).toBe('id');
    expect({ entry, ack }).toEqual(before);
  });

  it('normalizes only shared preview before merging existing personal views and placements', () => {
    const { entry, ack } = sparseFixture();
    entry.document = {
      ...entry.document!,
      views: [{ id: 'private', name: 'My view', domainIds: ['d'] }],
      layout: {
        ...entry.document!.layout,
        nodes: [
          ...entry.document!.layout.nodes,
          {
            id: 'private-a',
            objectId: 'a',
            viewId: 'private',
            x: 991,
            y: 992,
            width: 320,
            height: 260,
          },
        ],
        viewports: [{ viewId: 'private', x: 11, y: 22, zoom: 1.5 }],
      },
    };
    const original = structuredClone(entry.document);
    const next = nativeEntryAfterAck(entry, ack)!;
    expect(next.document!.views).toEqual(original.views);
    expect(next.document!.layout.nodes.find((node) => node.id === 'private-a')).toEqual(
      original.layout.nodes.at(-1),
    );
    expect(next.document!.layout.viewports).toEqual(original.layout.viewports);
    expect(next.snapshot.sourceDocument).toEqual(ack.document);
    if (next.snapshot.native.status !== 'available') throw Error('native');
    expect(next.snapshot.native.document.views ?? []).toEqual([]);
    expect(next.snapshot.native.document.layout.nodes.map((node) => node.viewId)).toEqual([
      TABLES_VIEW_ID,
      TABLES_VIEW_ID,
    ]);
    expect(entry.document).toEqual(original);
  });

  it('matches the reader truncation and collision suffix for long IDs across repeated ACKs', () => {
    const { entry, ack } = fixture();
    const raw = createEmptyNativeDocument(ack.document!.database);
    const prefix = 'x'.repeat(159);
    raw.tables = [
      createNativeTable(raw.database, prefix + '1', null, 'physical'),
      createNativeTable(raw.database, prefix + '0', null, 'physical'),
    ];
    const occupied = `node:${'x'.repeat(128)}:${TABLES_VIEW_ID}`;
    raw.notes = [{ id: 'note', viewId: TABLES_VIEW_ID, text: 'occupied' }];
    raw.layout.nodes = [
      {
        id: occupied,
        objectId: 'note',
        viewId: TABLES_VIEW_ID,
        x: 100,
        y: 200,
        width: 240,
        height: 160,
      },
    ];
    entry.snapshot.sourceDocument = raw;
    if (entry.snapshot.native.status !== 'available') throw Error('native');
    entry.snapshot.native.document = readerPreview(raw);
    entry.document = entry.snapshot.native.document;
    ack.document = structuredClone(raw);
    ack.changedPaths = ['/tables'];
    const next = nativeEntryAfterAck(entry, ack)!;
    const nodes = next.document!.layout.nodes;
    expect(nodes).toEqual(readerPreview(raw).layout.nodes);
    expect(nodes).toHaveLength(3);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(3);
    expect(nodes.slice(1).map((node) => node.id)).toEqual([`${occupied}:1`, `${occupied}:2`]);
    expect(nodes.every((node) => node.id.length <= 160)).toBe(true);
    expect(nodes[0]).toBe(raw.layout.nodes[0]);
    expect(nodes.slice(1).map((node) => node.objectId)).toEqual([prefix + '0', prefix + '1']);
    const again = nativeEntryAfterAck(next, { ...ack, sequence: ack.sequence + 1 })!;
    expect(again.document!.layout.nodes).toBe(nodes);
    expect(again.snapshot.sourceDocument.layout.nodes).toHaveLength(1);
    expect(raw.layout.nodes).toHaveLength(1);
  });
  it('uses the response document without invalidating unchanged table and column references', () => {
    const { entry, ack } = fixture();
    const next = nativeEntryAfterAck(entry, ack)!;
    expect(next.snapshot.sequence).toBe(ack.sequence);
    expect(next.snapshot.project.version).toBe(entry.snapshot.project.version + 1);
    expect(next.snapshot.sourceDocument.tables).toBe(entry.snapshot.sourceDocument.tables);
    expect(next.snapshot.sourceDocument.columns).toBe(entry.snapshot.sourceDocument.columns);
    if (next.snapshot.native.status !== 'available' || entry.snapshot.native.status !== 'available')
      throw Error('native');
    expect(next.snapshot.native.issues).toBe(entry.snapshot.native.issues);
    expect(next.snapshot.sourceDocument.layout.nodes[0]!.x).toBe(ack.document!.layout.nodes[0]!.x);
    expect(next.snapshot.sourceDocument.layout.nodes[1]).toBe(
      entry.snapshot.sourceDocument.layout.nodes[1],
    );
  });
  it('ignores duplicate/old ACKs and requests reconciliation for unknown gaps or changed context', () => {
    const { entry, ack } = fixture();
    const next = nativeEntryAfterAck(entry, ack)!;
    expect(nativeEntryAfterAck(next, ack)).toBe(next);
    expect(nativeEntryAfterAck(entry, { ...ack, sequence: ack.sequence + 1 })).toBeNull();
    expect(
      nativeEntryAfterAck(entry, { ...ack, databaseRevision: ack.databaseRevision + 1 }),
    ).toBeNull();
    expect(nativeEntryAfterAck(entry, { ...ack, status: 'rejected' })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { NativeSyncOperationResult } from '@ezerd/contracts';
import { clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { projectEntry } from './project-entry.js';
import { nativeEntryAfterAck } from './native-ack-entry.js';
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

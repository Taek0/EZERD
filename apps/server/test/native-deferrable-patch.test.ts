import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  deriveOperationChanges,
  requestFingerprint,
  validateDatabaseDocument,
} from '@ezerd/model';
import { nativeStoredDesignDocumentSchema, type NativeEditorCommand } from '@ezerd/contracts';
import { nativeEditorCandidate } from '../src/mcp/mcp-native-document.service.js';
import { deferrableFixture } from './native-deferrable-fixture.js';

const clearCommands: NativeEditorCommand[] = [
  { type: 'patch_key', id: 'key/a~b', patch: { deferrable: null } },
  { type: 'patch_foreign_key', id: 'fk/a~b', patch: { deferrable: null } },
];
describe('root deferrable patch consumer and existing model field removals', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'deletes optional %s fields and preserves the complete raw source through the model roundtrip',
    (kind) => {
      const source = deferrableFixture(kind),
        before = structuredClone(source),
        candidate = nativeEditorCandidate(source, clearCommands),
        expected = structuredClone(source);
      delete expected.keys![0]!.deferrable;
      delete expected.tableRelations![0]!.deferrable;
      expect(candidate).toEqual(expected);
      expect(source).toEqual(before);
      expect(Object.hasOwn(candidate.keys![0]!, 'deferrable')).toBe(false);
      expect(Object.hasOwn(candidate.tableRelations![0]!, 'deferrable')).toBe(false);
      const changes = deriveOperationChanges(source, candidate);
      expect(changes).toEqual([
        {
          path: '/keys/key~1a~0b/deferrable',
          before: { initially: 'deferred' },
          after: null,
          afterExists: false,
        },
        {
          path: '/tableRelations/fk~1a~0b/deferrable',
          before: { initially: 'immediate' },
          after: null,
          afterExists: false,
        },
      ]);
      expect(applyChanges(source, changes)).toEqual(candidate);
      expect(
        validateDatabaseDocument(candidate, source.database, {
          mode: 'write',
          previous: source,
        }).filter((issue) => issue.severity === 'error'),
      ).toEqual([]);
      expect(nativeStoredDesignDocumentSchema.parse(candidate)).toEqual(candidate);
    },
  );
  it('preserves omitted deferrable while merging only supplied FK logical/physical fields', () => {
    const source = deferrableFixture(),
      candidate = nativeEditorCandidate(source, [
        { type: 'patch_key', id: 'key/a~b', patch: { name: 'renamed_pk' } },
        {
          type: 'patch_foreign_key',
          id: 'fk/a~b',
          patch: { logical: { name: 'renamed logical' }, physical: { name: 'renamed_fk' } },
        },
      ]);
    expect(candidate.keys![0]).toEqual({ ...source.keys![0], name: 'renamed_pk' });
    expect(candidate.tableRelations![0]).toEqual({
      ...source.tableRelations![0],
      logical: { ...source.tableRelations![0]!.logical, name: 'renamed logical' },
      physical: { ...source.tableRelations![0]!.physical!, name: 'renamed_fk' },
    });
    expect(candidate.columns).toEqual(source.columns);
  });
  it('makes clearing absent fields a no-op and setting a field an explicit replace', () => {
    const source = nativeEditorCandidate(deferrableFixture(), clearCommands);
    expect(deriveOperationChanges(source, nativeEditorCandidate(source, clearCommands))).toEqual(
      [],
    );
    const candidate = nativeEditorCandidate(source, [
      { type: 'patch_key', id: 'key/a~b', patch: { deferrable: { initially: 'immediate' } } },
      { type: 'patch_foreign_key', id: 'fk/a~b', patch: { deferrable: { initially: 'deferred' } } },
    ]);
    expect(candidate.keys![0]!.deferrable).toEqual({ initially: 'immediate' });
    expect(candidate.tableRelations![0]!.deferrable).toEqual({ initially: 'deferred' });
    expect(source.keys![0]).not.toHaveProperty('deferrable');
  });
  it('rejects explicit undefined/misplaced options without mutation and keeps omission/null request identities distinct', () => {
    const source = deferrableFixture(),
      before = structuredClone(source);
    for (const type of ['patch_key', 'patch_foreign_key'] as const) {
      const id = type === 'patch_key' ? 'key/a~b' : 'fk/a~b';
      expect(() =>
        nativeEditorCandidate(source, [{ type, id, patch: { deferrable: undefined } } as never]),
      ).toThrow();
      expect(requestFingerprint({ type, id, patch: {} })).not.toBe(
        requestFingerprint({ type, id, patch: { deferrable: null } }),
      );
      expect(requestFingerprint({ type, id, patch: { deferrable: undefined } })).not.toBe(
        requestFingerprint({ type, id, patch: {} }),
      );
    }
    expect(() =>
      nativeEditorCandidate(source, [
        {
          type: 'patch_foreign_key',
          id: 'fk/a~b',
          patch: { physical: { deferrable: null } },
        } as never,
      ]),
    ).toThrow();
    expect(() =>
      nativeEditorCandidate(source, [
        { type: 'patch_key', id: 'missing', patch: { deferrable: null } },
      ]),
    ).toThrow('object-not-found');
    expect(source).toEqual(before);
  });
});

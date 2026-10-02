import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { inspectNativeLegacyChanges } from '@ezerd/model';
import {
  nativeCanvasStyleCommandSchema,
  nativeDomainRelationCommandSchema,
} from '@ezerd/contracts';
import { nativeEditorCandidate } from '../src/mcp/mcp-native-document.service.js';
import { decorationFixture } from '../../web/src/features/projects/native-canvas-decoration-test-fixtures.js';
describe('native canvas decoration ordinary commands', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'preserves raw %s legacy/native metadata while adding/patching/deleting domain relations',
    (kind) => {
      const source = decorationFixture(kind),
        before = structuredClone(source);
      let candidate = nativeEditorCandidate(source, [
        {
          type: 'add_domain_relation',
          value: {
            id: 'fresh',
            sourceDomainId: 'a',
            targetDomainId: 'b',
            name: 'New',
            direction: 'forward',
            description: '',
          },
        },
        { type: 'patch_domain_relation', id: 'r', patch: { name: 'Changed' } },
      ]);
      expect(candidate.schemaVersion).toBe(2);
      expect(candidate.domainRelations.find((item) => item.id === 'r')).toEqual({
        ...source.domainRelations[0]!,
        name: 'Changed',
      });
      expect(candidate.tables).toEqual(source.tables);
      expect(candidate.columns).toEqual(source.columns);
      expect(inspectNativeLegacyChanges(candidate, source)).toEqual([]);
      candidate = nativeEditorCandidate(candidate, [
        { type: 'delete_domain_relation', id: 'fresh' },
      ]);
      expect(candidate.domainRelations).toHaveLength(1);
      expect(source).toEqual(before);
    },
  );
  it('rejects endpoint hijacks, missing relations, batch ID reuse and strict unknown patches', () => {
    const source = decorationFixture();
    expect(() =>
      nativeEditorCandidate(source, [
        { type: 'patch_domain_relation', id: 'r', patch: { targetDomainId: 'foreign' } },
      ]),
    ).toThrow();
    expect(() =>
      nativeEditorCandidate(source, [{ type: 'delete_domain_relation', id: 'missing' }]),
    ).toThrow('canvas.domain-relation-not-found');
    expect(() =>
      nativeEditorCandidate(source, [
        { type: 'delete_domain_relation', id: 'r' },
        { type: 'add_domain_relation', value: source.domainRelations[0]! },
      ]),
    ).toThrow('document.duplicate-identities');
    expect(
      nativeDomainRelationCommandSchema.safeParse({
        type: 'patch_domain_relation',
        id: 'r',
        patch: { id: 'replace' },
      }).success,
    ).toBe(false);
    expect(
      nativeDomainRelationCommandSchema.safeParse({
        type: 'patch_domain_relation',
        id: 'r',
        patch: {},
      }).success,
    ).toBe(false);
    expect(
      nativeCanvasStyleCommandSchema.safeParse({
        type: 'patch_canvas_style',
        target: { kind: 'domain', id: 'a' },
        patch: { canvasDisplay: { showNullable: false } },
      }).success,
    ).toBe(false);
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'applies and resets %s table/domain/note colors and merges common display options',
    (kind) => {
      const source = decorationFixture(kind),
        before = structuredClone(source);
      let candidate = nativeEditorCandidate(source, [
        {
          type: 'patch_canvas_style',
          target: { kind: 'table', id: 't' },
          patch: { color: '#112233', canvasDisplay: { showComment: false } },
        },
        { type: 'patch_canvas_style', target: { kind: 'domain', id: 'a' }, patch: { color: null } },
        { type: 'patch_canvas_style', target: { kind: 'note', id: 'n' }, patch: { color: null } },
      ]);
      expect(candidate.tables![0]).toEqual({
        ...source.tables![0],
        color: '#112233',
        canvasDisplay: { showComment: false },
      });
      expect(candidate.domains[0]).not.toHaveProperty('color');
      expect(candidate.notes[0]).not.toHaveProperty('color');
      expect(candidate.columns).toEqual(before.columns);
      candidate = nativeEditorCandidate(candidate, [
        {
          type: 'patch_canvas_style',
          target: { kind: 'table', id: 't' },
          patch: { color: null, canvasDisplay: { showNullable: false } },
        },
      ]);
      expect(candidate.tables![0]).not.toHaveProperty('color');
      expect(candidate.tables![0]!.canvasDisplay).toEqual({
        showNullable: false,
        showComment: false,
      });
      expect(inspectNativeLegacyChanges(candidate, source)).toEqual([]);
      expect(source).toEqual(before);
    },
  );
  it('rejects private note styling and physical/ownership fields in a common style patch', () => {
    const source = decorationFixture();
    source.views = [{ id: 'private', name: 'Private', domainIds: ['a'] }];
    source.notes[0]!.viewId = 'private';
    expect(() =>
      nativeEditorCandidate(source, [
        {
          type: 'patch_canvas_style',
          target: { kind: 'note', id: 'n' },
          patch: { color: '#112233' },
        },
      ]),
    ).toThrow('canvas.shared-view-required');
    for (const patch of [
      { color: 'red' },
      { physical: { name: 'changed' } },
      { domainId: 'b' },
      { canvasDisplay: { showNullable: 'false' } },
      {},
    ])
      expect(
        nativeCanvasStyleCommandSchema.safeParse({
          type: 'patch_canvas_style',
          target: { kind: 'table', id: 't' },
          patch,
        }).success,
      ).toBe(false);
  });
});

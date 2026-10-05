import { describe, expect, it } from 'vitest';
import {
  nativeInlineCommand,
  nativeInlineInput,
  nativeInlineKey,
} from './NativeCanvasInlineEditor.js';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeDraftRecoveryTarget } from './native-draft-recovery-target.js';
import type { NativeDraftArchiveEntry } from './native-draft-archive.js';
describe('native inline edits', () => {
  it('patches only the chosen physical or logical field and preserves the source', () => {
    const doc = decorationFixture(),
      before = structuredClone(doc);
    expect(
      nativeInlineCommand(doc, { tableId: 't', mode: 'physical', field: 'name' }, 'renamed'),
    ).toEqual({ type: 'patch_table', id: 't', patch: { physical: { name: 'renamed' } } });
    expect(
      nativeInlineCommand(
        doc,
        { tableId: 't', columnId: 'c', mode: 'logical', field: 'comment' },
        'definition',
      ),
    ).toEqual({ type: 'patch_column', id: 'c', patch: { logical: { definition: 'definition' } } });
    expect(
      nativeInlineCommand(
        doc,
        { tableId: 't', columnId: 'c', mode: 'logical', field: 'required' },
        'true',
      ),
    ).toEqual({ type: 'patch_column', id: 'c', patch: { logical: { required: true } } });
    expect(doc).toEqual(before);
  });
  it('rejects mismatched objects and malformed boolean or format shortcuts', () => {
    const doc = decorationFixture();
    expect(() =>
      nativeInlineInput(doc, {
        tableId: 'missing',
        columnId: 'c',
        mode: 'physical',
        field: 'name',
      }),
    ).toThrow();
    expect(() =>
      nativeInlineCommand(
        doc,
        { tableId: 't', columnId: 'c', mode: 'logical', field: 'required' },
        'yes',
      ),
    ).toThrow();
    expect(() =>
      nativeInlineCommand(
        doc,
        { tableId: 't', columnId: 'c', mode: 'physical', field: 'format' },
        'text',
      ),
    ).toThrow();
  });
  it('routes preserved inline input back to the canvas without parsing IDs by delimiters', () => {
    const doc = decorationFixture(),
      target = { tableId: 't', columnId: 'c', mode: 'physical' as const, field: 'name' as const },
      key = nativeInlineKey(target);
    const entry = {
      category: 'editor',
      logicalKey: key,
      draft: { key },
    } as NativeDraftArchiveEntry;
    expect(nativeDraftRecoveryTarget(doc, entry)).toEqual({
      kind: 'canvas',
      selection: { viewId: '__tables__', inline: target },
      personal: false,
    });
    doc.columns = [];
    expect(nativeDraftRecoveryTarget(doc, entry)).toBeNull();
  });
});

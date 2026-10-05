import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeCanvasStyleEditor } from './NativeCanvasStyleEditor.js';
import {
  NativeDomainRelationEditor,
  nativeDomainRelationCommands,
} from './NativeDomainRelationEditor.js';
import { NativeClipboardMenu } from './native-clipboard.js';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId,
} from './native-canvas-decoration-test-fixtures.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { requestFingerprint } from '@ezerd/model';
import { setLocale } from '../../shared/i18n/index.js';

vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  setLocale('ko');
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const document = decorationFixture();
  const snapshot = decorationSnapshot(document);
  const context = {
    userId: decorationUserId,
    snapshot,
    busy: false,
    onSave: vi.fn(async () => true),
  };
  return { document, snapshot, context };
}

describe('native auxiliary original UI compositions', () => {
  it.each([
    ['note', '#FFF3C4'],
    ['domain', '#8993A3'],
    ['table', '#654321'],
  ])(
    'shows the original %s fallback color without changing the source or submitting',
    (kind, color) => {
      const { document, context } = fixture();
      delete document.notes[0]!.color;
      delete document.tables![0]!.color;
      const before = structuredClone(document);
      const html = renderToStaticMarkup(
        createElement(NativeCanvasStyleEditor, {
          document,
          context,
          editable: true,
          initialSelection: kind === 'note' ? 'note:n' : kind === 'domain' ? 'domain:b' : 'table:t',
        }),
      );
      expect(html).toContain('animated-details');
      expect(html).toContain('panel-section');
      expect(html).toContain(color);
      expect(html).toContain('domain-color-trigger');
      expect(html).toContain('자동 색상으로 되돌리기');
      if (kind === 'table') expect(html).toContain('ui-checkbox-root');
      if (kind === 'note') expect(html).toContain('메모 색상 선택');
      expect(document).toEqual(before);
      expect(context.onSave).not.toHaveBeenCalled();
    },
  );

  it('prefers explicitly recovered note style over current shell selection and preserves invalid HEX drafts', () => {
    const { document, context } = fixture();
    const key = 'canvas:style:note:n';
    const draft = {
      userId: decorationUserId,
      projectId: context.snapshot.project.id,
      key,
      revision: decorationUserId,
      expected: {
        version: context.snapshot.project.version,
        sequence: context.snapshot.sequence,
        databaseRevision: context.snapshot.project.databaseRevision,
      },
      before: { color: '#abcdef', showNullable: 'true', showComment: 'true' },
      values: { color: '#12', showNullable: 'true', showComment: 'true' },
    };
    storeNativeEditorDraft(draft);
    const html = renderToStaticMarkup(
      createElement(NativeCanvasStyleEditor, {
        document,
        context,
        editable: true,
        initialSelection: 'note:n',
        selectedTableId: 't',
        selectedNoteId: 'other',
      }),
    );
    expect(html).toContain('<legend>Note</legend>');
    expect(html).toContain('value="#12"');
    expect(html).toContain('메모 색상 선택');
    expect(loadNativeEditorDraft(decorationUserId, context.snapshot.project.id, key)).toEqual(
      draft,
    );
    expect(context.onSave).not.toHaveBeenCalled();
  });

  it('accepts a selected note and keeps its palette unavailable when read-only or busy', () => {
    const { document, context } = fixture();
    const props = { document, context, editable: true, selectedNoteId: 'n', selectedTableId: 't' };
    const note = renderToStaticMarkup(createElement(NativeCanvasStyleEditor, props));
    expect(note).toContain('<legend>Note</legend>');
    const busy = renderToStaticMarkup(
      createElement(NativeCanvasStyleEditor, { ...props, context: { ...context, busy: true } }),
    );
    expect(busy).toContain('<fieldset disabled=""');
    expect(busy).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="메모 색상 선택"|<button[^>]*aria-label="메모 색상 선택"[^>]*disabled=""/,
    );
    const readonly = renderToStaticMarkup(
      createElement(NativeCanvasStyleEditor, { ...props, editable: false }),
    );
    expect(readonly).toContain('조회 전용');
    expect(readonly).not.toContain('domain-color-trigger');
    expect(context.onSave).not.toHaveBeenCalled();
  });

  it('uses the common clipboard accordion, checkbox and multiline paste field without writing', () => {
    const { document, snapshot, context } = fixture();
    const before = structuredClone(document);
    const html = renderToStaticMarkup(
      createElement(NativeClipboardMenu, {
        snapshot,
        userId: decorationUserId,
        editable: true,
        busy: true,
        onSave: context.onSave,
      }),
    );
    expect(html).toContain('animated-details');
    expect(html).toContain('ui-checkbox-root');
    expect(html).toContain('ui-textarea');
    expect(html).toContain('<fieldset disabled=""');
    expect(document).toEqual(before);
    expect(context.onSave).not.toHaveBeenCalled();
  });

  it('shows contextual readonly relationship direction and keeps deletion review tied to the baseline', () => {
    const { document, context } = fixture();
    document.domainRelations.push({
      ...document.domainRelations[0]!,
      id: 'other',
      name: 'Hidden relation',
    });
    const readonly = renderToStaticMarkup(
      createElement(NativeDomainRelationEditor, {
        document,
        context,
        editable: false,
        selectedId: 'r',
      }),
    );
    expect(readonly).toContain('도메인 관계 수정');
    expect(readonly).toContain('↔');
    expect(readonly).not.toContain('Hidden relation');
    const deletion = renderToStaticMarkup(
      createElement(NativeDomainRelationEditor, {
        document,
        context,
        editable: true,
        selectedId: 'r',
        initialAction: 'delete',
      }),
    );
    expect(deletion).toContain('ui-checkbox-root');
    const review = requestFingerprint({
      id: 'r',
      version: context.snapshot.project.version,
      sequence: context.snapshot.sequence,
      databaseRevision: context.snapshot.project.databaseRevision,
    });
    expect(nativeDomainRelationCommands(document, context, 'delete', 'r', { review }, {})).toEqual([
      { type: 'delete_domain_relation', id: 'r' },
    ]);
    context.snapshot.sequence++;
    expect(() =>
      nativeDomainRelationCommands(document, context, 'delete', 'r', { review }, {}),
    ).toThrow('canvas.domain-relation-review-required');
    expect(context.onSave).not.toHaveBeenCalled();
  });
});

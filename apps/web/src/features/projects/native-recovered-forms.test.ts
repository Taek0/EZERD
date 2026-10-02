import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardActor, clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { NativeStructureEditor, nativeConstraintInitial } from './native-editor-structure.js';
import { NativeAdvancedEditor } from './NativeAdvancedEditor.js';
import { NativeDomainEditor } from './NativeDomainEditor.js';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { NativeCanvasStyleEditor } from './NativeCanvasStyleEditor.js';
import { NativeDomainRelationEditor } from './NativeDomainRelationEditor.js';
import { storeNativeEditorDraft, loadNativeEditorDraft } from './native-editor-draft.js';
import { setLocale } from '../../shared/i18n/index.js';

function fixture() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  setLocale('ko');
  const snapshot = clipboardSnapshot();
  if (snapshot.sourceDocument.schemaVersion !== 2) throw Error('native expected');
  const doc = snapshot.sourceDocument;
  doc.tables![0]!.scope = 'both';
  doc.columns![0]!.scope = 'both';
  doc.notes = [{ id: 'n', viewId: '__tables__', text: 'Saved note' }];
  doc.domains.push({ id: 'd2', name: 'Audit', description: '' });
  doc.domainRelations = [
    {
      id: 'dr',
      sourceDomainId: 'd',
      targetDomainId: 'd2',
      direction: 'forward',
      name: 'Saved relation',
      description: '',
    },
  ];
  const context = {
    userId: clipboardActor,
    snapshot,
    busy: false,
    onSave: vi.fn(async () => true),
  };
  return { doc, snapshot, context };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('native recovered form initial selections', () => {
  it('opens the requested constraint form and reads its preserved input instead of the default create form', () => {
    const { doc, context } = fixture(),
      key = 'constraint:keys:k';
    const before = nativeConstraintInitial(doc, 'keys', 'k');
    const draft = {
      userId: clipboardActor,
      projectId: context.snapshot.project.id,
      key,
      revision: clipboardActor,
      expected: {
        version: context.snapshot.project.version - 1,
        sequence: context.snapshot.sequence,
        databaseRevision: context.snapshot.project.databaseRevision,
      },
      before,
      values: { ...before, name: 'recovered constraint' },
    };
    storeNativeEditorDraft(draft);
    const html = renderToStaticMarkup(
      createElement(NativeStructureEditor, {
        context,
        document: doc,
        table: doc.tables![0]!,
        initialSelection: { action: 'patch', target: '["keys","k"]' },
      }),
    );
    expect(html).toContain('value="recovered constraint"');
    expect(html).toContain('open=""');
    expect(loadNativeEditorDraft(clipboardActor, context.snapshot.project.id, key)).toEqual(draft);
    expect(context.onSave).not.toHaveBeenCalled();
  });
  it.each([
    'index:new',
    'check:new',
    '["index","ix"]',
    '["check","q"]',
    '["default","ca"]',
    '["computed","ca"]',
  ])('opens advanced selection %s without submitting', (selection) => {
    const { doc, context } = fixture(),
      before = structuredClone(doc);
    const html = renderToStaticMarkup(
      createElement(NativeAdvancedEditor, {
        context,
        document: doc,
        table: doc.tables![0]!,
        initialSelection: selection,
      }),
    );
    expect(html).toContain('open=""');
    expect(html).toContain('selected=""');
    expect(html).toContain(
      selection === 'index:new' || selection.startsWith('["index"')
        ? '고급 인덱스'
        : selection.includes('default')
          ? '기본값 식'
          : selection.includes('computed')
            ? '생성 식'
            : '새 복합 CHECK',
    );
    expect(doc).toEqual(before);
    expect(context.onSave).not.toHaveBeenCalled();
  });
  it.each(['delete', 'move'] as const)(
    'opens domain %s with the exact target, including the deletion review',
    (action) => {
      const { doc, snapshot, context } = fixture();
      const html = renderToStaticMarkup(
        createElement(NativeDomainEditor, {
          document: doc,
          snapshot,
          userId: clipboardActor,
          editable: true,
          busy: false,
          onSave: context.onSave,
          initialAction: action,
          ...(action === 'delete' ? { selectedDomainId: 'd' } : { selectedTableId: 'a' }),
        }),
      );
      expect(html).toContain(action === 'delete' ? '도메인 삭제' : '테이블 소속 이동');
      expect(html).toContain('open=""');
      expect(context.onSave).not.toHaveBeenCalled();
    },
  );
  it('opens shared canvas action with preserved text and does not fall back to the default note creation form', () => {
    const { doc, snapshot, context } = fixture(),
      key = 'canvas:action:__tables__:note-edit:n';
    const draft = {
      userId: clipboardActor,
      projectId: snapshot.project.id,
      key,
      revision: clipboardActor,
      expected: {
        version: snapshot.project.version,
        sequence: snapshot.sequence,
        databaseRevision: snapshot.project.databaseRevision,
      },
      before: { text: 'Saved note' },
      values: { text: 'recovered raw note -unfinished' },
    };
    storeNativeEditorDraft(draft);
    const html = renderToStaticMarkup(
      createElement(NativeERDCanvas, {
        document: doc,
        snapshot,
        userId: clipboardActor,
        editable: true,
        busy: false,
        mode: 'physical',
        onSave: context.onSave,
        onReload() {},
        onSelect() {},
        recoverySelection: { viewId: '__tables__', action: { action: 'note-edit', target: 'n' } },
      }),
    );
    expect(html).toContain('recovered raw note -unfinished');
    expect(context.onSave).not.toHaveBeenCalled();
    expect(loadNativeEditorDraft(clipboardActor, snapshot.project.id, key)).toEqual(draft);
  });
  it('waits for the requested private view instead of opening a shared action with that recovered target', () => {
    const { doc, snapshot, context } = fixture();
    doc.views = [{ id: 'v', name: 'Private', domainIds: ['d'] }];
    const html = renderToStaticMarkup(
      createElement(NativeERDCanvas, {
        document: doc,
        snapshot,
        userId: clipboardActor,
        editable: true,
        personalEditable: true,
        busy: false,
        mode: 'physical',
        onSave: context.onSave,
        onReload() {},
        onSelect() {},
        recoverySelection: { viewId: 'v', action: { action: 'note', target: '' } },
      }),
    );
    expect(html).toContain('복구할 화면을 불러오는 중입니다.');
    expect(html).not.toContain('class="native-erd-actions"');
    expect(context.onSave).not.toHaveBeenCalled();
  });
  it('style selection survives parent table focus when a note style was explicitly recovered', () => {
    const { doc, context } = fixture();
    const html = renderToStaticMarkup(
      createElement(NativeCanvasStyleEditor, {
        document: doc,
        context,
        editable: true,
        selectedTableId: 'a',
        initialSelection: 'note:n',
      }),
    );
    expect(html).toContain('open=""');
    expect(html).toContain('<legend>Saved note</legend>');
    expect(html).not.toContain('type="checkbox"');
    expect(context.onSave).not.toHaveBeenCalled();
  });
  it('opens domain relation deletion instead of silently changing it to edit', () => {
    const { doc, context } = fixture();
    const html = renderToStaticMarkup(
      createElement(NativeDomainRelationEditor, {
        document: doc,
        context,
        editable: true,
        selectedId: 'dr',
        initialAction: 'delete',
      }),
    );
    expect(html).toContain('open=""');
    expect(html).toContain('연결 삭제를 확인했습니다.');
    expect(context.onSave).not.toHaveBeenCalled();
  });
});

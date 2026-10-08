import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyNativeDocument,
  defaultDatabaseContext,
  nativeExpressionColumnIds,
} from '@ezerd/model';
import {
  planNativeClipboardCommand,
  nativeClipboardObjectIds,
  nativeEditorDraftSchema,
} from '@ezerd/contracts';
import {
  clipboardFixture,
  clipboardSnapshot,
  clipboardCommand,
  clipboardActor,
} from './native-clipboard-test-fixtures.js';
import {
  copyNativeClipboard,
  prepareNativeClipboardPaste,
  readNativeClipboard,
  nativeClipboardDraftFields,
  nativeClipboardDraftText,
  reviewedNativeClipboardCommand,
  nativeClipboardReviewToken,
} from './native-clipboard-helpers.js';
import { NativeClipboardMenu } from './native-clipboard.js';
import { setLocale } from '../../shared/i18n/index.js';
import {
  stageNativeSave,
  sendNativePending,
  recoverNativePending,
  loadNativePending,
} from './native-save.js';
import { storeNativeEditorDraft, loadNativeEditorDraft } from './native-editor-draft.js';
import {
  createNativeTestIndexedDB,
  nativeTestIndexedDBAvailable,
} from './native-durable-test-environment.js';
import { request } from '../../shared/api/client.js';
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
function review(
  snapshot: ReturnType<typeof clipboardSnapshot>,
  command: ReturnType<typeof clipboardCommand>,
): Record<string, string> {
  const text = JSON.stringify(command.clipboard),
    remap = JSON.stringify(command.newIds);
  return {
    ...nativeClipboardDraftFields(text, 'clipboard'),
    ...nativeClipboardDraftFields(remap, 'remap'),
    ...nativeClipboardDraftFields(text, 'reviewClipboard'),
    ...nativeClipboardDraftFields(remap, 'reviewRemap'),
    domainId: '',
    x: '100',
    y: '200',
    review: nativeClipboardReviewToken(snapshot, '', '100', '200'),
  };
}
describe('native clipboard live preparation and menu', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'prepares %s logical graph IDs and ASTs without mutating raw source',
    (kind) => {
      const source = clipboardFixture(kind),
        before = structuredClone(source),
        snapshot = clipboardSnapshot(source);
      const copied = copyNativeClipboard(snapshot, ['a', 'b']);
      const ids = clipboardCommand(source).newIds;
      let index = 0;
      const result = prepareNativeClipboardPaste(
        clipboardSnapshot(createEmptyNativeDocument(source.database)),
        copied.text,
        null,
        { x: 100, y: 200 },
        () => ids[index++]!,
      );
      expect(result.plan.canApply).toBe(true);
      expect(result.command.clipboard.sourceProjectId).toBe(snapshot.project.id);
      expect(result.plan.document.tableRelations![0]).toMatchObject({
        sourceTableId: ids[1],
        targetTableId: ids[0],
      });
      expect(nativeExpressionColumnIds(result.plan.document.checks![0]!.expression)).toEqual([
        ids[2],
      ]);
      expect(
        nativeExpressionColumnIds(result.plan.document.indexes![0]!.parts[0]!.expression),
      ).toEqual([ids[2]]);
      expect(result.plan.document.columns![0]!.physical.defaultValue).toEqual(
        source.columns![0]!.physical.defaultValue,
      );
      expect(source).toEqual(before);
    },
  );
  it('uses only shared raw state, omits partial foreign keys, and supplies missing canonical geometry locally', () => {
    const source = clipboardFixture();
    source.views = [{ id: 'private', name: 'Private', domainIds: ['d'] }];
    source.notes = [{ id: 'secret', viewId: 'private', text: 'SECRET PRIVATE' }];
    source.layout.nodes.push({
      id: 'secret-node',
      objectId: 'secret',
      viewId: 'private',
      x: 1,
      y: 2,
      width: 240,
      height: 160,
    });
    source.layout.viewports = [{ viewId: 'private', x: 100, y: 200, zoom: 4 }];
    const before = structuredClone(source),
      copied = copyNativeClipboard(clipboardSnapshot(source), ['a']);
    expect(copied.text).not.toContain('SECRET');
    expect(copied.file.document.views).toBeUndefined();
    expect(copied.file.document.layout.viewports).toEqual([]);
    expect(copied.omittedRelations).toEqual(['Audits']);
    expect(copied.file.document.tableRelations).toEqual([]);
    expect(source).toEqual(before);
    source.layout.nodes = [];
    expect(
      copyNativeClipboard(clipboardSnapshot(source), ['a']).file.document.layout.nodes,
    ).toHaveLength(1);
    expect(before.notes![0]!.text).toBe('SECRET PRIVATE');
  });
  it('rejects v1/SQL, all legacy copies including logical scope, foreign DB and borrowed missing references', () => {
    expect(() => readNativeClipboard('CREATE TABLE sample (id INT)')).toThrow(
      'clipboard.format-invalid',
    );
    expect(() =>
      readNativeClipboard(JSON.stringify({ format: 'ezerd/tables-v1', document: {} })),
    ).toThrow('clipboard.format-invalid');
    const snapshot = clipboardSnapshot();
    (snapshot.sourceDocument as ReturnType<typeof clipboardFixture>).columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'opaque', isArray: false },
    };
    expect(() => copyNativeClipboard(snapshot, ['a'])).toThrow(
      'clipboard.legacy-copy-not-supported',
    );
    expect(() =>
      prepareNativeClipboardPaste(
        clipboardSnapshot(createEmptyNativeDocument(defaultDatabaseContext('mysql'))),
        JSON.stringify(clipboardCommand().clipboard),
        null,
        { x: 0, y: 0 },
      ),
    ).toThrow('clipboard.database-mismatch');
    const borrowed = clipboardCommand().clipboard;
    borrowed.document.tableRelations![0]!.targetTableId = 'foreign-existing-short-id';
    expect(() => readNativeClipboard(JSON.stringify(borrowed))).toThrow(
      'clipboard.reference-missing',
    );
  });
  it('reviews exact text/remap and invalidates approvals on draft, position or revision changes', () => {
    const command = clipboardCommand(),
      snapshot = clipboardSnapshot(createEmptyNativeDocument(command.clipboard.sourceDatabase));
    const values = review(snapshot, command);
    expect(reviewedNativeClipboardCommand(snapshot, values)).toEqual(command);
    values.clipboard0JSON += ' ';
    expect(() => reviewedNativeClipboardCommand(snapshot, values)).toThrow(
      'clipboard.review-required',
    );
    const moved = { ...review(snapshot, command), x: '101' };
    expect(() => reviewedNativeClipboardCommand(snapshot, moved)).toThrow(
      'clipboard.review-required',
    );
    const changed = { ...snapshot, sequence: 11 };
    expect(() => reviewedNativeClipboardCommand(changed, review(snapshot, command))).toThrow(
      'clipboard.review-required',
    );
    const remapped = review(snapshot, command);
    remapped.remap0JSON = remapped.remap0JSON!.replace('10000000', '20000000');
    expect(() => reviewedNativeClipboardCommand(snapshot, remapped)).toThrow(
      'clipboard.review-required',
    );
  });
  it('preserves bounded large manual input in draft chunks without changing the 2MB envelope limit', () => {
    const text = 'x'.repeat(350001),
      fields = nativeClipboardDraftFields(text, 'clipboard');
    expect(nativeClipboardDraftText(fields, 'clipboard')).toBe(text);
    expect(Object.values(fields).every((value) => value.length <= 100000)).toBe(true);
    const snapshot = clipboardSnapshot(),
      all = {
        ...fields,
        ...nativeClipboardDraftFields('', 'remap'),
        ...nativeClipboardDraftFields('', 'reviewClipboard'),
        ...nativeClipboardDraftFields('', 'reviewRemap'),
        domainId: '',
        x: '0',
        y: '0',
        review: '',
      };
    expect(
      nativeEditorDraftSchema.safeParse({
        userId: clipboardActor,
        projectId: snapshot.project.id,
        key: 'canvas:clipboard:paste',
        revision: '10000000-0000-4000-8000-000000000001',
        expected: { version: 7, sequence: 10, databaseRevision: 3 },
        before: all,
        values: all,
      }).success,
    ).toBe(true);
    expect(() => readNativeClipboard('🙂'.repeat(500001))).toThrow('clipboard.size-limit');
  });
  it('allocates fresh IDs on LAN and accepts verified basic physical declarations', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    vi.stubGlobal('isSecureContext', false);
    const source = clipboardFixture(),
      copied = copyNativeClipboard(clipboardSnapshot(source), ['a', 'b']);
    const plan = prepareNativeClipboardPaste(
      clipboardSnapshot(createEmptyNativeDocument(source.database)),
      copied.text,
      null,
      { x: 0, y: 0 },
    );
    expect(new Set(plan.command.newIds).size).toBe(
      nativeClipboardObjectIds(plan.command.clipboard).length,
    );
    expect(plan.command.newIds.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    source.tables!.forEach((item) => {
      item.scope = 'both';
    });
    source.columns!.forEach((item) => {
      item.scope = 'both';
      item.physical.defaultValue = { kind: 'none' };
    });
    const gated = planNativeClipboardCommand(
      createEmptyNativeDocument(source.database),
      clipboardCommand(source),
    );
    expect(gated.canApply).toBe(true);
    expect(gated.issues.some((issue) => issue.severity === 'error')).toBe(false);
  });
  it.each([false, true])(
    'renders readonly/archive copy selection and no paste writer (%s)',
    (archived) => {
      const snapshot = clipboardSnapshot();
      if (archived) snapshot.project.status = 'archived';
      const save = vi.fn(async () => true);
      const html = renderToStaticMarkup(
        createElement(NativeClipboardMenu, {
          snapshot,
          userId: clipboardActor,
          editable: archived,
          busy: false,
          onSave: save,
          selectedTableId: 'a',
        }),
      );
      expect(html).toContain('테이블 복사');
      expect(html).toContain('Orders');
      expect(html).toContain('조회 전용');
      expect(html).not.toContain('type="submit"');
      expect(html).not.toContain('붙여넣을 내용');
      expect(save).not.toHaveBeenCalled();
    },
  );
  it('provides editable manual paste text without requiring the Clipboard API and blocks pending writes', () => {
    vi.stubGlobal('navigator', {});
    const snapshot = clipboardSnapshot(),
      save = vi.fn(async () => true);
    const html = renderToStaticMarkup(
      createElement(NativeClipboardMenu, {
        snapshot,
        userId: clipboardActor,
        editable: true,
        busy: true,
        onSave: save,
      }),
    );
    expect(html).toContain('붙여넣을 내용');
    expect(html).toContain('<fieldset disabled=""');
    expect(html).not.toContain('type="submit"');
    expect(save).not.toHaveBeenCalled();
  });
});
describe.runIf(nativeTestIndexedDBAvailable)('native clipboard command durability', () => {
  it('stores the exact remap before transport and retains newer clipboard input on old ACK recovery', async () => {
    vi.stubGlobal('indexedDB', createNativeTestIndexedDB());
    const command = clipboardCommand(),
      snapshot = clipboardSnapshot(createEmptyNativeDocument(command.clipboard.sourceDatabase));
    const values = review(snapshot, command),
      draft = {
        userId: clipboardActor,
        projectId: snapshot.project.id,
        key: 'canvas:clipboard:paste',
        revision: crypto.randomUUID(),
        expected: { version: 7, sequence: 10, databaseRevision: 3 },
        before: {},
        values,
      };
    storeNativeEditorDraft(draft);
    const pending = await stageNativeSave(
      clipboardActor,
      snapshot,
      [reviewedNativeClipboardCommand(snapshot, values)],
      localStorage,
      draft.expected,
      { key: draft.key, revision: draft.revision },
    );
    const api = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(await loadNativePending(clipboardActor, snapshot.project.id)).toEqual(pending);
      expect(JSON.parse(init!.body as string).commands[0].newIds).toEqual(command.newIds);
      throw Error('Lost ACK');
    });
    await expect(sendNativePending(pending, localStorage, api as typeof request)).rejects.toThrow(
      'Lost ACK',
    );
    const newer = {
      ...draft,
      revision: crypto.randomUUID(),
      values: { ...values, clipboard0JSON: values.clipboard0JSON + ' ' },
    };
    storeNativeEditorDraft(newer);
    const ack = {
      protocolVersion: 2,
      database: command.clipboard.sourceDatabase,
      databaseRevision: 3,
      operationId: pending.request.operationId,
      groupId: pending.request.groupId,
      sequence: 11,
      status: 'accepted',
      actor: { id: clipboardActor, username: 'actor', color: '#123456' },
      changedPaths: ['/tables/' + command.newIds[0]],
      createdAt: '2026-10-02T00:00:01Z',
      nextBaseline: {
        baselineId: snapshot.project.id,
        baseSequence: 11,
        baselineIssuedAt: '2026-10-02T00:00:01Z',
        databaseRevision: 3,
      },
    };
    const lookup = vi.fn().mockResolvedValue(ack);
    await recoverNativePending(
      pending,
      { ...snapshot, project: { ...snapshot.project, status: 'archived', databaseRevision: 4 } },
      localStorage,
      lookup as typeof request,
      false,
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await loadNativePending(clipboardActor, snapshot.project.id)).toBeNull();
    expect(loadNativeEditorDraft(clipboardActor, snapshot.project.id, draft.key)).toEqual(newer);
  });
});

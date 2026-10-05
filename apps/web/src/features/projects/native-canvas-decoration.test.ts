import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { requestFingerprint } from '@ezerd/model';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId,
} from './native-canvas-decoration-test-fixtures.js';
import { nativeCanvasStyleCommands, nativeTableCanvasRows } from './native-canvas-style.js';
import { nativeDomainGeometry, NativeDomainLines } from './native-domain-lines.js';
import { NativeCanvasStyleEditor } from './NativeCanvasStyleEditor.js';
import {
  NativeDomainRelationEditor,
  nativeDomainRelationCommands,
} from './NativeDomainRelationEditor.js';
import { NativeERDCanvas, nativeCanvasScene } from './NativeERDCanvas.js';
import { NativeCanvasPngExport } from './NativeCanvasPngExport.js';
import { setLocale } from '../../shared/i18n/index.js';
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
beforeEach(() => {
  setLocale('ko');
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('native common style/domain relation UI and geometry', () => {
  it('produces only changed presentation fields and preserves native labels and source payloads', () => {
    const source = decorationFixture(),
      before = structuredClone(source);
    expect(
      nativeCanvasStyleCommands(
        { kind: 'table', id: 't' },
        { color: '', showNullable: 'false', showComment: 'true' },
        { color: '#123456', showNullable: 'true', showComment: 'true' },
      ),
    ).toEqual([
      {
        type: 'patch_canvas_style',
        target: { kind: 'table', id: 't' },
        patch: { color: null, canvasDisplay: { showNullable: false } },
      },
    ]);
    const rows = nativeTableCanvasRows(source, source.tables![0]!, 'physical');
    expect(rows[0]!.type).toContain('ORIGINAL_TYPE');
    expect(rows[0]!.comment).toContain('<script>');
    expect(rows[0]!.nullable).toBe('NOT NULL');
    source.tables![0]!.canvasDisplay = { showNullable: false, showComment: false };
    const hidden = nativeTableCanvasRows(source, source.tables![0]!, 'physical');
    expect(hidden[0]!.comment).toBe('');
    expect(hidden[0]!.nullable).toBe('');
    expect(hidden[0]!.height).toBeLessThan(rows[0]!.height);
    expect(source.columns).toEqual(before.columns);
  });
  it('builds strict partial relationship commands and ties deletion review to current revision', () => {
    const source = decorationFixture(),
      snapshot = decorationSnapshot(source),
      context = { userId: decorationUserId, snapshot, busy: false, onSave: async () => true };
    const values = {
      id: 'r',
      sourceDomainId: 'a',
      targetDomainId: 'b',
      name: 'Tracks',
      description: 'Description',
      direction: 'both',
    };
    expect(
      nativeDomainRelationCommands(
        source,
        context,
        'edit',
        'r',
        { ...values, description: 'Edited' },
        values,
      ),
    ).toEqual([{ type: 'patch_domain_relation', id: 'r', patch: { description: 'Edited' } }]);
    const review = requestFingerprint({ id: 'r', version: 7, sequence: 10, databaseRevision: 3 });
    expect(nativeDomainRelationCommands(source, context, 'delete', 'r', { review }, {})).toEqual([
      { type: 'delete_domain_relation', id: 'r' },
    ]);
    snapshot.sequence++;
    expect(() =>
      nativeDomainRelationCommands(source, context, 'delete', 'r', { review }, {}),
    ).toThrow('canvas.domain-relation-review-required');
  });
  it('starts relationship creation with empty metadata and a fresh LAN-safe identity even when existing relationships are present', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint8Array) => {
        values.fill(21);
        return values;
      },
    });
    const document = decorationFixture(),
      snapshot = decorationSnapshot(document),
      context = { userId: decorationUserId, snapshot, busy: false, onSave: async () => true };
    const html = renderToStaticMarkup(
      createElement(NativeDomainRelationEditor, {
        document,
        context,
        editable: true,
        initialAction: 'create',
      }),
    );
    expect(html).not.toContain('value="Tracks"');
    expect(html).not.toContain('value="Description"');
    expect(html).toContain('value="forward" selected=""');
  });
  it('consumes common overview relation ports/labels and never draws them on the table scene', () => {
    const source = decorationFixture(),
      overview = nativeCanvasScene(source, 'overview', 'physical');
    const geometry = nativeDomainGeometry(source, overview.nodes);
    expect(geometry).toHaveLength(1);
    expect(geometry[0]!.geometry.path).toMatch(/^M/);
    expect(
      nativeDomainGeometry(source, nativeCanvasScene(source, '__tables__', 'physical').nodes),
    ).toEqual([]);
    const html = renderToStaticMarkup(
      createElement(NativeDomainLines, { document: source, nodes: overview.nodes, onSelect() {} }),
    );
    expect(html).toContain('data-domain-relation-id="r"');
    expect(html).toContain('marker-start');
    expect(html).toContain('Tracks');
  });
  it('integrates readonly PNG/domain/style menu and shows native common rows without write forms', () => {
    const source = decorationFixture(),
      snapshot = decorationSnapshot(source),
      before = structuredClone(source);
    const html = renderToStaticMarkup(
      createElement(NativeERDCanvas, {
        document: source,
        snapshot,
        editable: false,
        busy: false,
        mode: 'physical',
        onSave: async () => true,
        onSelect() {},
        onReload() {},
      }),
    );
    for (const text of ['PNG 내보내기', '카드 표시', '새 도메인 관계', 'ORIGINAL_TYPE', 'NOT NULL'])
      expect(html).toContain(text);
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('border-color:#c8d0de');
    expect(html).toContain('background:#123456');
    expect(html).toMatch(/class="[^"]*native-scene-entry/);
    expect(source).toEqual(before);
  });
  it('keeps common editors pending-disabled and clean saves unavailable', () => {
    const document = decorationFixture(),
      snapshot = decorationSnapshot(document),
      context = { userId: decorationUserId, snapshot, busy: true, onSave: async () => true };
    for (const node of [
      createElement(NativeCanvasStyleEditor, { document, context, editable: true }),
      createElement(NativeDomainRelationEditor, { document, context, editable: true }),
    ]) {
      const html = renderToStaticMarkup(node);
      expect(html).toContain('<fieldset disabled=""');
      expect(html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
    }
    const privateHtml = renderToStaticMarkup(
      createElement(NativeCanvasPngExport, {
        snapshot,
        viewId: 'private',
        mode: 'physical',
        sceneFor: nativeCanvasScene,
      }),
    );
    expect(privateHtml).toContain('개인 화면을 불러온 뒤 PNG를 내보내 주세요.');
    expect(privateHtml).toContain('disabled=""');
  });
});

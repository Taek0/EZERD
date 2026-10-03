import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const path = new URL('../../app/App.tsx', import.meta.url);
const source = ts.createSourceFile(
  'App.tsx',
  readFileSync(path, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function nodes(root: ts.Node) {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}
function fn(name: string) {
  const node = nodes(source).find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (!node) throw Error(`missing ${name}`);
  return node;
}
const calls = (root: ts.Node) =>
  nodes(root)
    .filter(ts.isCallExpression)
    .map((node) => node.expression.getText(source));
describe('actual App gallery conversion wiring', () => {
  it('the actual gallery onEdit calls changeProject, and raw-v2 branch returns before the legacy metadata PATCH', () => {
    const gallery = nodes(source).find(
      (node) =>
        ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'ProjectGallery',
    );
    expect(gallery?.getText(source)).toMatch(/onEdit=\{changeProject\}/);
    const handler = fn('changeProject');
    expect(calls(handler)).toContain('fetchGalleryDatabaseSnapshot');
    const native = nodes(handler).find(
      (node) =>
        ts.isIfStatement(node) &&
        /snapshot\.sourceDocument\.schemaVersion\s*===\s*2/.test(node.expression.getText(source)),
    );
    expect(native && ts.isIfStatement(native)).toBe(true);
    if (!native || !ts.isIfStatement(native)) throw Error('missing raw native dispatch');
    const nativeCalls = calls(native.thenStatement);
    expect(nativeCalls).toContain('prepareGalleryDatabaseConversion');
    expect(nativeCalls).toContain('galleryConversion.current?.review');
    expect(nativeCalls).toContain('galleryConversion.current?.recover');
    expect(nativeCalls).toContain('galleryConversionMatchesInput');
    expect(nativeCalls).toContain('saveNativeGalleryName');
    expect(nativeCalls).not.toContain('request');
    expect(calls(handler)).toContain('previewDatabaseChange');
    expect(calls(handler)).toContain('request');
  });
  it('the native review/recovery host is wired with actor/workspace identity and receives the real current edit permission', () => {
    const host = nodes(source).find(
      (node) =>
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(source) === 'NativeGalleryConversion',
    );
    const text = host?.getText(source) ?? '';
    expect(text).toMatch(/ref=\{galleryConversion\}/);
    expect(text).toMatch(/userId=\{user\.id\}/);
    expect(text).toMatch(/workspaceId=\{workspaceId\}/);
    expect(text).toMatch(/canEdit=\{workspacePermissions\(selectedWorkspace\)\.edit\}/);
    expect(text).toContain('setProjects');
    expect(text).toContain('setRefresh');
  });
  it('App.open consumes the tested read-only/unknown-safe dispatcher and returns from actual pending recovery before replaceEntry', () => {
    const handler = fn('open'),
      names = calls(handler);
    expect(names).toContain('loadGalleryProjectForOpen');
    expect(names).toContain('galleryConversion.current?.recover');
    expect(names).toContain('replaceEntry');
    expect(handler.getText(source)).not.toMatch(/permissions\.edit|canEdit/);
    const recovery = nodes(handler).find(
      (node) =>
        ts.isIfStatement(node) &&
        /result\.kind\s*===\s*'recover'/.test(node.expression.getText(source)),
    );
    expect(
      recovery &&
        ts.isIfStatement(recovery) &&
        nodes(recovery.thenStatement).some(ts.isReturnStatement),
    ).toBe(true);
  });
});

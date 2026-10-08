import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Check the whole local runtime graph, so a wrapper cannot reintroduce the retired editor.
it('keeps legacy editor and sync entry points outside the application runtime graph', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const reached = new Set<string>();
  function visit(file: string) {
    if (reached.has(file)) return;
    reached.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function follow(specifier: string) {
      if (!specifier.startsWith('.')) return;
      const base = resolve(dirname(file), specifier).replace(/\.js$/, '');
      const target = [base + '.ts', base + '.tsx'].find(existsSync);
      if (specifier.endsWith('.js')) expect(target, `${file}: ${specifier}`).toBeDefined();
      if (target) visit(target);
    }
    function scan(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const typeOnly = ts.isImportDeclaration(node)
          ? node.importClause?.isTypeOnly
          : node.isTypeOnly;
        if (!typeOnly) follow(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        follow(node.arguments[0].text);
      ts.forEachChild(node, scan);
    }
    scan(source);
  }
  visit(resolve(root, 'main.tsx'));
  const paths = [...reached].map((file) => relative(root, file).replaceAll('\\', '/'));
  expect(paths).toContain('features/projects/NativeProjectView.tsx');
  expect(paths).toContain('features/projects/NativeERDCanvas.tsx');
  for (const file of [
    'features/canvas/canvas-selection.ts',
    'features/canvas/selection-frame.ts',
    'features/canvas/canvas-tool-shortcuts.ts',
    'features/canvas/canvas-wheel.ts',
    'shared/clipboard/table-clipboard-store.ts',
    'features/canvas/inspector-state.ts',
    'features/relations/relation-routing.ts',
    'features/domains/domain-relations.ts',
    'features/domains/DomainDescription.tsx',
    'features/domains/DomainColorPicker.tsx',
    'features/tables/column-type-display.ts',
  ])
    expect(paths).toContain(file);
  for (const file of [
    'features/canvas/table-clipboard.ts',
    'features/canvas/Canvas.tsx',
    'features/collaboration/sync-client.ts',
    'features/collaboration/sync-history-panel.tsx',
    'features/projects/NativeUpgradeButton.tsx',
  ])
    expect(paths).not.toContain(file);
});

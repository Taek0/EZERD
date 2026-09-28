import ts from 'typescript';
import type { Plugin } from 'vite';

export function instrumentFunctions(
  source: string,
  names: string[],
  label: string,
  collectorPath: string,
) {
  const file = ts.createSourceFile(
    'input.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const edits: { at: number; text: string }[] = [];
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.body &&
      names.includes(node.name.text)
    ) {
      const name = node.name.text;
      found.push(name);
      edits.push({
        at: node.body.getStart(file) + 1,
        text: `\nconst __perfEnd = __perfBegin(${JSON.stringify(label + '.' + name)}); try {\n`,
      });
      edits.push({ at: node.body.end - 1, text: '\n} finally { __perfEnd?.(); }\n' });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!found.length) return null;
  let output = source;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    output = output.slice(0, edit.at) + edit.text + output.slice(edit.at);
  return {
    code: `import { beginMeasurementSpan as __perfBegin } from ${JSON.stringify(collectorPath)};\n${output}`,
    found,
  };
}

export function measurementPlugin(collectorPath: string): Plugin {
  const required = new Set([
    'tableCardMetrics',
    'tableCardSize',
    'relationGeometry',
    'layoutDomainRelations',
    'Canvas',
  ]);
  const seen = new Set<string>();
  return {
    name: 'ezerd-measurement-only',
    enforce: 'pre',
    transform(source, id) {
      const path = id.replaceAll('\\', '/').split('?')[0]!;
      let names: string[] = [];
      if (/\/packages\/model\/(dist|src)\/table-geometry\.(js|ts)$/.test(path))
        names = ['tableCardMetrics', 'tableCardSize'];
      if (path.endsWith('/features/relations/relation-routing.ts')) names = ['relationGeometry'];
      if (path.endsWith('/features/domains/domain-relations.ts')) names = ['layoutDomainRelations'];
      if (path.endsWith('/features/canvas/Canvas.tsx'))
        names = ['Canvas', 'moveViewport', 'move', 'finish'];
      if (!names.length) return;
      const result = instrumentFunctions(source, names, path.split('/').at(-1)!, collectorPath);
      result?.found.forEach((name) => seen.add(name));
      return result ? { code: result.code, map: null } : undefined;
    },
    generateBundle() {
      const missing = [...required].filter((name) => !seen.has(name));
      if (missing.length) this.error(`Missing measurement targets: ${missing.join(', ')}`);
    },
  };
}

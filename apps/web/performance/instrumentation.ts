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

export function measurementPlugin(
  collectorPath: string,
  frameMode: 'raf' | 'immediate' = 'raf',
): Plugin {
  const required = new Set([
    'tableCardMetrics',
    'tableCardSize',
    'relationGeometry',
    'layoutDomainRelations',
    'NativeERDCanvas',
    'NativeCanvasWorkspace',
    'NativeProjectView',
    'EditableNativeCanvasInlineCell',
    'NativeCanvasTableRows',
    'nativeCanvasScene',
  ]);
  const seen = new Set<string>();
  return {
    name: 'ezerd-measurement-only',
    enforce: 'pre',
    transform(source, id) {
      const path = id.replaceAll('\\', '/').split('?')[0]!;
      // Measurement-only causal control. The normal app build never loads this plugin.
      if (frameMode === 'immediate' && path.endsWith('/features/canvas/frame-queue.ts'))
        return {
          code: 'export function createFrameQueue(){return {enqueue(task){task();},flush(){},cancel(){}}}',
          map: null,
        };
      let names: string[] = [];
      if (/\/packages\/model\/(dist|src)\/table-geometry\.(js|ts)$/.test(path))
        names = ['tableCardMetrics', 'tableCardSize'];
      if (/\/packages\/model\/(dist|src)\/relation-routing\.(js|ts)$/.test(path))
        names = ['relationGeometry'];
      if (path.endsWith('/features/domains/domain-relations.ts')) names = ['layoutDomainRelations'];
      if (path.endsWith('/features/canvas/Canvas.tsx'))
        names = ['Canvas', 'moveViewport', 'applyCameraFrame', 'preview', 'move', 'finish'];
      if (path.endsWith('/features/projects/NativeERDCanvas.tsx'))
        names = [
          'NativeERDCanvas',
          'NativeCanvasWorkspace',
          'nativeCanvasScene',
          'nativeCanvasWheel',
        ];
      if (path.endsWith('/features/projects/NativeProjectView.tsx')) names = ['NativeProjectView'];
      if (path.endsWith('/features/projects/NativeCanvasInlineCell.tsx'))
        names = ['EditableNativeCanvasInlineCell'];
      if (path.endsWith('/features/projects/NativeCanvasTableRows.tsx'))
        names = ['NativeCanvasTableRows', 'NativeCanvasColumnMenu', 'nativeCanvasColumnMenuItems'];
      if (path.endsWith('/features/projects/native-editor-policy.ts'))
        names = ['nativeEditorPolicy'];
      if (/\/packages\/model\/(dist|src)\/database\/display\.(js|ts)$/.test(path))
        names = ['nativeColumnTypeDisplay'];
      if (path.endsWith('/native-local-projection.ts'))
        names = ['projectNativeLocalColumns', 'readNativeLocalEntries'];
      if (path.endsWith('/native-local-draft-names.ts'))
        names = ['readNativeLocalDraftNames', 'projectNativeLocalDraftNames'];
      if (path.endsWith('/native-inline-edit.ts')) names = ['nativeInlineInput'];
      if (/\/packages\/model\/(dist|src)\/native-table-canvas\.(js|ts)$/.test(path))
        names = ['nativeTableCanvasMetrics'];
      if (path.endsWith('/native-primary-key.ts')) names = ['nativePrimaryKeyPlan'];
      if (path.endsWith('/native-ack-entry.ts')) names = ['nativeEntryAfterAck'];
      if (/\/packages\/model\/(dist|src)\/sync\.(js|ts)$/.test(path)) names = ['applyChanges'];
      if (/\/packages\/model\/(dist|src)\/table-canvas\.(js|ts)$/.test(path))
        names = ['normalizeSharedTableCanvas'];
      if (/\/packages\/model\/(dist|src)\/personal\.(js|ts)$/.test(path))
        names = ['reconcilePersonalState', 'mergeStoredPersonalState'];
      if (/\/packages\/model\/(dist|src)\/database\/validation\.(js|ts)$/.test(path))
        names = ['validateDatabaseDocument'];
      if (!names.length) return;
      const label = names.includes('relationGeometry')
        ? 'relation-routing.ts'
        : path.split('/').at(-1)!;
      const result = instrumentFunctions(source, names, label, collectorPath);
      result?.found.forEach((name) => seen.add(name));
      return result ? { code: result.code, map: null } : undefined;
    },
    generateBundle() {
      const missing = [...required].filter((name) => !seen.has(name));
      if (missing.length) this.error(`Missing measurement targets: ${missing.join(', ')}`);
    },
  };
}

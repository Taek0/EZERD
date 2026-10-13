import type { Plugin } from 'vite';
export function panelProfilingPlugin(controlPath: string): Plugin {
  const targets: Record<string, string[]> = {
    'NativeERDCanvas.tsx': ['NativeERDCanvas'],
    'NativeNavigatorTable.tsx': ['NativeNavigatorTable'],
    'NativeNavigatorDomain.tsx': ['NativeNavigatorDomain'],
    'NativeDomainEditor.tsx': ['NativeDomainEditor'],
    'NativeDomainRelationEditor.tsx': ['NativeDomainRelationEditor'],
    'NativePropertyEditor.tsx': ['NativePropertyEditor'],
    'native-editor-format.tsx': ['NativeFormatEditor'],
    'native-editor-structure.tsx': ['NativeStructureEditor'],
    'NativeAdvancedEditor.tsx': ['NativeAdvancedEditor'],
    'NativeTableRelationInspector.tsx': ['NativeTableRelationInspector'],
  };
  return {
    name: 'panel-detail-profiling-only',
    enforce: 'pre',
    transform(source, id) {
      const path = id.replaceAll('\\', '/').split('?')[0]!;
      const names = path.includes('/features/projects/')
        ? targets[path.split('/').at(-1)!]
        : undefined;
      if (!names) return;
      let code = source;
      for (const name of names) {
        const marker = `export function ${name}(`;
        if (!code.includes(marker)) this.error(`Missing panel profiler target ${name}`);
        code = code.replace(marker, `function ${name}Profiled(`);
        code += `\nexport function ${name}(props:Parameters<typeof ${name}Profiled>[0]){return <__PanelProfiler id="${name}" onRender={__recordPanelProfile}><${name}Profiled {...props}/></__PanelProfiler>;}\n`;
      }
      return {
        code: `import {Profiler as __PanelProfiler} from 'react';\nimport {recordPanelProfile as __recordPanelProfile} from ${JSON.stringify(controlPath)};\n${code}`,
        map: null,
      };
    },
  };
}

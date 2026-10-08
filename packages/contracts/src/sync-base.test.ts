import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import * as base from './sync-base.js';
import * as legacy from './legacy-sync.js';
import * as compatibility from './sync.js';
import * as native from './native-sync.js';
import * as readers from './sync-read.js';
import * as publicContracts from './index.js';

it('preserves the public schemas and old sync import path while separating historical readers', () => {
  expect(compatibility.syncChangeSchema).toBe(base.syncChangeSchema);
  expect(compatibility.syncBaselineSchema).toBe(base.syncBaselineSchema);
  expect(compatibility.syncOperationInputSchema).toBe(legacy.syncOperationInputSchema);
  expect(compatibility.syncOperationResultSchema).toBe(legacy.syncOperationResultSchema);
  expect(compatibility.syncEventSchema).toBe(legacy.syncEventSchema);
  expect(publicContracts.nativeSyncOperationInputSchema).toBe(
    native.nativeSyncOperationInputSchema,
  );
  expect(publicContracts.syncOperationInputReadSchema).toBe(readers.syncOperationInputReadSchema);
  expect(publicContracts.syncOperationResultReadSchema).toBe(readers.syncOperationResultReadSchema);
  expect(publicContracts.syncEventReadSchema).toBe(readers.syncEventReadSchema);
});

it('keeps the Native wire module independent of v1 envelopes and mixed-version readers', () => {
  const reached = new Set<string>();
  function visit(url: URL) {
    if (reached.has(url.href)) return;
    reached.add(url.href);
    const source = ts.createSourceFile(
      fileURLToPath(url),
      readFileSync(url, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      if (statement.importClause?.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier.startsWith('.')) visit(new URL(specifier.replace(/\.js$/, '.ts'), url));
    }
  }
  visit(new URL('./native-sync.ts', import.meta.url));
  expect(reached.has(new URL('./sync-base.ts', import.meta.url).href)).toBe(true);
  for (const file of ['sync.ts', 'legacy-sync.ts', 'sync-read.ts'])
    expect(reached.has(new URL(file, import.meta.url).href), file).toBe(false);
});

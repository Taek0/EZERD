import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
} from '@ezerd/model';
import { normalizeServerDocument } from '../src/shared/normalize-document.js';

it('types project and baseline JSON as known v1/v2 documents and narrows legacy consumers', () => {
  const configPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    fileURLToPath(new URL('../', import.meta.url)),
  );
  const file = fileURLToPath(new URL('../src/db/__stored-document-typecheck.ts', import.meta.url));
  const source = `
    import { projects, syncClientBaselines } from './schema.js';
    import { createEmptyDocument, createEmptyNativeDocument, defaultDatabaseContext, type DesignDocument, type StoredDesignDocument } from '@ezerd/model';
    import { requireLegacyServerDocument } from '../shared/normalize-document.js';
    const legacy = createEmptyDocument();
    const native = createEmptyNativeDocument(defaultDatabaseContext('mysql'));
    const projectLegacy: typeof projects.$inferSelect.document = legacy;
    const projectNative: typeof projects.$inferSelect.document = native;
    const baselineLegacy: typeof syncClientBaselines.$inferSelect.document = legacy;
    const baselineNative: typeof syncClientBaselines.$inferSelect.document = native;
    const insertNative: NonNullable<typeof projects.$inferInsert.document> = native;
    // @ts-expect-error Unknown versions are not persisted document types.
    const future: StoredDesignDocument = { ...native, schemaVersion: 3 };
    function readLegacy(document: StoredDesignDocument): DesignDocument {
      requireLegacyServerDocument(document);
      return document;
    }
  `;
  const options = { ...parsed.options, noEmit: true, incremental: false };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, create) =>
    name.replaceAll('\\', '/') === file.replaceAll('\\', '/')
      ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, onError, create);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  expect(
    diagnostics.map((value) => ts.flattenDiagnosticMessageText(value.messageText, '\n')),
  ).toEqual([]);
}, 30000);

it('normalizes v1 for compatibility but refuses Native documents without mutating them', () => {
  const legacy = createEmptyDocument();
  expect(normalizeServerDocument(legacy)).toEqual(legacy);
  for (const kind of ['postgresql', 'mysql', 'sqlite'] as const) {
    const document = createEmptyNativeDocument(defaultDatabaseContext(kind));
    const before = structuredClone(document);
    expect(() => normalizeServerDocument(document)).toThrow('새 설계 형식');
    expect(document).toEqual(before);
  }
});

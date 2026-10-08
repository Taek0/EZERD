import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createEmptyDocumentBase, TABLES_VIEW_ID } from './document-base.js';
import { createEmptyDocument, TABLES_VIEW_ID as legacyViewId } from './document.js';
import { createEmptyNativeDocument } from './database/native-document.js';
import { defaultDatabaseContext } from './database/profiles.js';
import * as publicModel from './index.js';

const emptyFields = () => ({
  domains: [],
  domainRelations: [],
  notes: [],
  layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
});

describe('version-independent document foundation', () => {
  it('preserves the v1 serialized shape and existing public import paths', () => {
    expect(JSON.stringify(createEmptyDocument())).toBe(
      JSON.stringify({ schemaVersion: 1, ...emptyFields() }),
    );
    expect(publicModel.createEmptyDocument).toBe(createEmptyDocument);
    expect(publicModel.createEmptyNativeDocument).toBe(createEmptyNativeDocument);
    expect(publicModel.createEmptyDocumentBase).toBe(createEmptyDocumentBase);
    expect(legacyViewId).toBe(TABLES_VIEW_ID);
  });

  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'preserves the %s Native serialized shape and copies its DB context',
    (kind) => {
      const database = Object.freeze(defaultDatabaseContext(kind));
      const document = createEmptyNativeDocument(database);
      expect(JSON.stringify(document)).toBe(
        JSON.stringify({ schemaVersion: 2, ...emptyFields(), database }),
      );
      expect(document.database).not.toBe(database);
      for (const key of [
        'views',
        'enums',
        'tables',
        'columns',
        'keys',
        'tableRelations',
        'indexes',
        'checks',
      ])
        expect(Object.hasOwn(document, key)).toBe(false);
    },
  );

  it('keeps new documents and their nested collections independent across versions', () => {
    const documents = [
      createEmptyDocumentBase(),
      createEmptyDocument(),
      createEmptyNativeDocument(defaultDatabaseContext('postgresql')),
    ];
    for (const current of documents) {
      current.domains.push({ id: 'changed', name: '', description: '' });
      current.notes.push({ id: 'note', viewId: 'overview', text: 'changed' });
      current.layout.viewports[0]!.zoom = 0.5;
      for (const other of documents.filter((value) => value !== current))
        expect(other).toMatchObject(emptyFields());
      current.domains.length = 0;
      current.notes.length = 0;
      current.layout.viewports[0]!.zoom = 1;
    }
  });

  it('still rejects inconsistent database kind/profile pairs', () => {
    expect(() =>
      createEmptyNativeDocument({ ...defaultDatabaseContext('postgresql'), kind: 'mysql' }),
    ).toThrow();
  });

  it('does not load the v1 document implementation when creating a Native document', () => {
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
        const bindings = statement.importClause?.namedBindings;
        if (
          !statement.importClause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.every((value) => value.isTypeOnly)
        )
          continue;
        const specifier = statement.moduleSpecifier.text;
        if (specifier.startsWith('.')) visit(new URL(specifier.replace(/\.js$/, '.ts'), url));
      }
    }
    visit(new URL('./database/native-document.ts', import.meta.url));
    expect(reached.has(new URL('./document-base.ts', import.meta.url).href)).toBe(true);
    expect(reached.has(new URL('./document.ts', import.meta.url).href)).toBe(false);
  });
});

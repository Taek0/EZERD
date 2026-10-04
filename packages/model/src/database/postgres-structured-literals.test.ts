import { describe, expect, it } from 'vitest';
import {
  inspectPostgresXmlLiteral,
  inspectPostgresJsonpathLiteral,
  postgresStructuredLiteralLimits as limits,
} from './postgres-structured-literals.js';
import { literalDecision, inspectNativeLiteralToken } from './literals.js';
import { defaultDatabaseContext } from './profiles.js';
import { hasDatabaseCoverage } from './definitions.js';
import { getDatabaseType } from './catalog.js';
import { nativeDefaultCoverage } from './readiness.js';
import { compileNativeDatabaseDDL } from './ddl.js';
import { createEmptyNativeDocument } from './native-document.js';
import { createNativeColumn, createNativeTable } from './editing.js';
import type { NativeColumnType } from './native-document.js';
const type = (name: 'xml' | 'jsonpath'): NativeColumnType => ({
  kind: 'builtin',
  database: 'postgresql',
  typeId: `postgresql:${name}`,
  parameters: {},
});
const context = defaultDatabaseContext('postgresql');
const decide = (
  name: 'xml' | 'jsonpath',
  value: string,
  literalType: 'typedText' | 'string' | 'json' = 'typedText',
) => literalDecision(context, type(name), { kind: 'literal', literalType, value });
describe('bounded PG XML and simple jsonpath typed literals', () => {
  it.each([
    '<root/>',
    ' \n<root><child id="a">한😀 &amp; &lt; &#65; &#x1F600;</child></root>\t',
    "<root a='&quot;' b=\"&apos;\">O'Reilly \\ ; SELECT 1</root>",
    '<r><item/><item x="&amp;foo;"/></r>',
    '<r a="one\ntwo">a&gt;b</r>',
  ])('accepts bounded single element XML without rewriting %s', (value) => {
    expect(inspectPostgresXmlLiteral(value)).toMatchObject({ allowed: true });
    const ready =
      hasDatabaseCoverage(nativeDefaultCoverage) &&
      hasDatabaseCoverage(getDatabaseType('postgresql:xml')!.coverage);
    expect(decide('xml', value)).toMatchObject({
      allowed: true,
      usable: ready,
      format: 'xml-single-element-fragment',
    });
    expect(decide('xml', value, 'string')).toMatchObject({
      allowed: false,
      usable: false,
      code: 'default.type-mismatch',
    });
  });
  it.each([
    '',
    'text',
    '<a/><b/>',
    '<a>text</b>',
    '<a>',
    '</a>',
    '<a/><a>',
    '<a></a>outside',
    '<a x="1" x="2"/>',
    '<a x="<"/>',
    '<a x="1"y="2"/>',
    '<a x=unquoted/>',
    '<a>&unknown;</a>',
    '<a>&#0;</a>',
    '<a>&#xD800;</a>',
    '<a>&#x110000;</a>',
    '<a>&#xFFFE;</a>',
    '<a>]]></a>',
    '<a>\u0001</a>',
    '<a>\ud800</a>',
  ])('rejects malformed/excluded XML %s', (value) => {
    expect(inspectPostgresXmlLiteral(value).allowed).toBe(false);
    expect(decide('xml', value).usable).toBe(false);
  });
  it.each([
    '<!DOCTYPE r SYSTEM "file:///qa-no-read"><r/>',
    '<!DOCTYPE r [<!ENTITY e "value">]><r>&e;</r>',
    '<?xml version="1.0"?><r/>',
    '<r><!--comment--></r>',
    '<r><![CDATA[text]]></r>',
    '<r><?processing value?></r>',
    '<ns:r/>',
    '<r xmlns="urn:qa"/>',
    '<r ns:a="x"/>',
  ])('never interprets DTD/namespaces/declarations %s', (value) => {
    expect(inspectPostgresXmlLiteral(value).allowed).toBe(false);
    expect(decide('xml', value)).toMatchObject({ allowed: false, usable: false });
  });
  it('enforces byte/depth/element/attribute/name limits without recursive parsing', () => {
    const exact = '<r>' + 'x'.repeat(limits.xmlBytes - 7) + '</r>';
    expect(inspectPostgresXmlLiteral(exact).allowed).toBe(true);
    expect(inspectPostgresXmlLiteral(exact.replace('x', '한')).allowed).toBe(false);
    expect(
      inspectPostgresXmlLiteral('<r>'.repeat(limits.xmlDepth) + '</r>'.repeat(limits.xmlDepth))
        .allowed,
    ).toBe(true);
    expect(
      inspectPostgresXmlLiteral(
        '<r>'.repeat(limits.xmlDepth + 1) + '</r>'.repeat(limits.xmlDepth + 1),
      ).allowed,
    ).toBe(false);
    expect(
      inspectPostgresXmlLiteral('<r>' + '<a/>'.repeat(limits.xmlElements - 1) + '</r>').allowed,
    ).toBe(true);
    expect(
      inspectPostgresXmlLiteral('<r>' + '<a/>'.repeat(limits.xmlElements) + '</r>').allowed,
    ).toBe(false);
    const attrs = Array.from({ length: limits.xmlAttributes }, (_, i) => ` a${i}="x"`).join('');
    expect(inspectPostgresXmlLiteral('<r' + attrs + '/>').allowed).toBe(true);
    expect(inspectPostgresXmlLiteral('<r' + attrs + ' extra="x"/>').allowed).toBe(false);
    expect(inspectPostgresXmlLiteral('<' + 'r'.repeat(limits.nameChars + 1) + '/>').allowed).toBe(
      false,
    );
  });
  it.each(['$', '$.items[0].value', '$[1024]', '$._key.a0[2][3]', '$.true', '$.null'])(
    'accepts the explicit jsonpath subset %s',
    (value) => {
      expect(inspectPostgresJsonpathLiteral(value)).toMatchObject({ allowed: true });
      expect(decide('jsonpath', value).allowed).toBe(true);
      expect(decide('jsonpath', value, 'string')).toMatchObject({
        allowed: false,
        code: 'default.type-mismatch',
      });
    },
  );
  it.each([
    '',
    ' $.a',
    'strict $.a',
    'lax $.a',
    '$."a"',
    '$.a-b',
    '$.*',
    '$.**',
    '$[*]',
    '$[-1]',
    '$[01]',
    '$[1025]',
    '$[0 to 1]',
    '$[0,1]',
    '$.a ? (@ > 1)',
    '$.a.size()',
    '$var',
    '$; SELECT 1',
    '$.한',
    '$.',
  ])('keeps jsonpath outside the subset unusable %s', (value) => {
    expect(inspectPostgresJsonpathLiteral(value).allowed).toBe(false);
    expect(decide('jsonpath', value).usable).toBe(false);
  });
  it('bounds jsonpath accessors and names independently of engine grammar', () => {
    expect(
      inspectPostgresJsonpathLiteral('$' + '.a'.repeat(limits.jsonpathAccessors)).allowed,
    ).toBe(true);
    expect(
      inspectPostgresJsonpathLiteral('$' + '.a'.repeat(limits.jsonpathAccessors + 1)).allowed,
    ).toBe(false);
    expect(inspectPostgresJsonpathLiteral('$.' + 'a'.repeat(limits.nameChars + 1)).allowed).toBe(
      false,
    );
    expect(inspectPostgresJsonpathLiteral('$.' + 'a'.repeat(limits.jsonpathBytes)).allowed).toBe(
      false,
    );
  });
  it.each(['xml', 'jsonpath'] as const)(
    '%s DDL uses an explicit type cast and preserves raw document tokens',
    (name) => {
      const document = createEmptyNativeDocument(context),
        table = createNativeTable(context, 't', null, 'both'),
        column = createNativeColumn(context, table, 'c');
      table.physical.name = 'records';
      column.physical.name = 'payload';
      column.scope = 'both';
      column.physical.type = type(name);
      const value =
        name === 'xml' ? "<r>O'Reilly \\ ; DROP TABLE records;</r>" : '$.items[0].value';
      column.physical.defaultValue = { kind: 'literal', literalType: 'typedText', value };
      document.tables = [table];
      document.columns = [column];
      const before = structuredClone(document),
        ddl = compileNativeDatabaseDDL(document);
      expect(ddl.canExport, JSON.stringify(ddl.issues)).toBe(true);
      expect(ddl.sql).toContain('CAST(');
      expect(ddl.sql).toContain(` AS ${name.toUpperCase()})`);
      expect(document).toEqual(before);
      expect(inspectNativeLiteralToken(column.physical.defaultValue)).toMatchObject({
        allowed: false,
        code: 'literal.target-type-required',
      });
      column.physical.defaultValue = { kind: 'literal', literalType: 'string', value };
      expect(compileNativeDatabaseDDL(document).canExport).toBe(false);
    },
  );
});

/** Shared, safe inputs for this dedicated proof; no mutation of the established 77-case manifest. */
export const postgresXmlJsonpathSchema = 'qa_xml_jsonpath_literals';
export const postgresXmlJsonpathCases = [
  { key: 'xml-empty', type: 'xml', raw: '<root/>', input: null, expected: null },
  {
    key: 'xml-unicode-entities',
    type: 'xml',
    raw: ' \n<root a="&quot;">한😀 &amp; &#65; &#x1F600;<child/></root>\t',
    input: null,
    expected: null,
  },
  {
    key: 'xml-sql-shaped-text',
    type: 'xml',
    raw: "<root a='&apos;'>O'Reilly \\ ; DROP TABLE records;</root>",
    input: null,
    expected: null,
  },
  {
    key: 'xml-depth-boundary',
    type: 'xml',
    raw: '<r>'.repeat(16) + '</r>'.repeat(16),
    input: null,
    expected: null,
  },
  {
    key: 'xml-byte-boundary',
    type: 'xml',
    raw: '<r>' + 'x'.repeat(8185) + '</r>',
    input: null,
    expected: null,
  },
  { key: 'path-root', type: 'jsonpath', raw: '$', input: { root: 7 }, expected: { root: 7 } },
  {
    key: 'path-member-index',
    type: 'jsonpath',
    raw: '$.items[0].value',
    input: { items: [{ value: "한 O'Reilly" }] },
    expected: "한 O'Reilly",
  },
  {
    key: 'path-nested-index',
    type: 'jsonpath',
    raw: '$._key.a0[2][3]',
    input: { _key: { a0: [[], [], [0, 0, 0, 42]] } },
    expected: 42,
  },
  {
    key: 'path-index-boundary',
    type: 'jsonpath',
    raw: '$[1024]',
    input: Array.from({ length: 1025 }, (_, i) => i),
    expected: 1024,
  },
  { key: 'path-keyword-true', type: 'jsonpath', raw: '$.true', input: { true: 9 }, expected: 9 },
  { key: 'path-keyword-null', type: 'jsonpath', raw: '$.null', input: { null: 11 }, expected: 11 },
] as const;
export const postgresXmlJsonpathBlockedCases = [
  {
    type: 'xml',
    raw: '<!DOCTYPE root SYSTEM "file:///qa-no-read"><root/>',
    reason: 'external-dtd',
  },
  { type: 'xml', raw: '<root><child></root>', reason: 'malformed-nesting' },
  { type: 'xml', raw: '<root xmlns="urn:qa"/>', reason: 'namespace' },
  { type: 'xml', raw: '<root/><other/>', reason: 'multiple-roots' },
  { type: 'xml', raw: '<root>&notDeclared;</root>', reason: 'custom-entity' },
  { type: 'jsonpath', raw: '$.*', reason: 'wildcard' },
  { type: 'jsonpath', raw: '$.items ? (@ > 0)', reason: 'filter' },
  { type: 'jsonpath', raw: '$[1025]', reason: 'index-limit' },
  { type: 'jsonpath', raw: '$.items.size()', reason: 'method' },
  { type: 'jsonpath', raw: '$; SELECT 1', reason: 'sql-text' },
] as const;

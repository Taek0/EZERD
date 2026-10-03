/** Deliberately bounded PG18 input subsets, not complete XML or SQL/JSON parsers. */
export const postgresStructuredLiteralLimits = Object.freeze({
  xmlBytes: 8192,
  xmlDepth: 16,
  xmlElements: 128,
  xmlAttributes: 32,
  nameChars: 64,
  jsonpathBytes: 2048,
  jsonpathAccessors: 32,
  jsonpathIndex: 1024,
});
type Decision =
  | { allowed: true; format: string }
  | {
      allowed: false;
      code: string;
      category: 'invalid' | 'unsupported';
    };
const invalid = (): Decision => ({
  allowed: false,
  code: 'default.literal-format-invalid',
  category: 'invalid',
});
const unsupported = (): Decision => ({
  allowed: false,
  code: 'default.literal-not-supported',
  category: 'unsupported',
});
const tooLong = (): Decision => ({
  allowed: false,
  code: 'default.length-exceeded',
  category: 'invalid',
});
const xmlSpace = (text: string) => /^[ \t\r\n]*$/.test(text);
const xmlCharacter = (code: number) =>
  code === 9 ||
  code === 10 ||
  code === 13 ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);
function byteCount(text: string) {
  let bytes = 0;
  for (const c of text) {
    const code = c.codePointAt(0)!;
    bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
  }
  return bytes;
}
function entities(text: string): boolean {
  let cursor = 0;
  while ((cursor = text.indexOf('&', cursor)) !== -1) {
    const end = text.indexOf(';', cursor + 1);
    if (end < 0 || end - cursor > 10) return false;
    const name = text.slice(cursor + 1, end);
    if (!['amp', 'lt', 'gt', 'apos', 'quot'].includes(name)) {
      if (!/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/.test(name)) return false;
      const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (!xmlCharacter(code)) return false;
    }
    cursor = end + 1;
  }
  return true;
}
/** One non-namespaced element with bounded nesting, attributes and XML 1.0 character data. */
export function inspectPostgresXmlLiteral(text: string): Decision {
  const limits = postgresStructuredLiteralLimits;
  if (text.length > limits.xmlBytes || byteCount(text) > limits.xmlBytes) return tooLong();
  if ([...text].some((c) => !xmlCharacter(c.codePointAt(0)!))) return invalid();
  // No declarations/DTD/entities/processing instructions, comments or CDATA are interpreted.
  if (text.includes('<!') || text.includes('<?')) return unsupported();
  let cursor = 0,
    elements = 0,
    seenRoot = false;
  const stack: string[] = [];
  const name = (): string | undefined => {
    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(text.slice(cursor));
    if (!match || match[0].length > limits.nameChars) return undefined;
    cursor += match[0].length;
    return match[0];
  };
  const space = () => {
    const start = cursor;
    while (cursor < text.length && xmlSpace(text[cursor]!)) cursor++;
    return cursor > start;
  };
  while (cursor < text.length) {
    if (text[cursor] !== '<') {
      const end = text.indexOf('<', cursor),
        stop = end === -1 ? text.length : end;
      const content = text.slice(cursor, stop);
      if (!stack.length ? !xmlSpace(content) : content.includes(']]>') || !entities(content))
        return invalid();
      cursor = stop;
      continue;
    }
    if (text.startsWith('</', cursor)) {
      cursor += 2;
      const closing = name();
      space();
      if (!closing || text[cursor++] !== '>' || stack.pop() !== closing) return invalid();
      continue;
    }
    cursor++;
    if (!stack.length && seenRoot) return invalid();
    const opening = name();
    if (!opening) return invalid();
    seenRoot = true;
    if (++elements > limits.xmlElements) return unsupported();
    const attributes = new Set<string>();
    let selfClosing = false;
    for (;;) {
      const separated = space();
      if (text.startsWith('/>', cursor)) {
        cursor += 2;
        selfClosing = true;
        break;
      }
      if (text[cursor] === '>') {
        cursor++;
        break;
      }
      if (!separated) return invalid();
      const attribute = name();
      if (!attribute || attributes.has(attribute)) return invalid();
      if (attribute === 'xmlns') return unsupported();
      attributes.add(attribute);
      if (attributes.size > limits.xmlAttributes) return unsupported();
      space();
      if (text[cursor++] !== '=') return invalid();
      space();
      const quote = text[cursor++];
      if (quote !== '\"' && quote !== "'") return invalid();
      const end = text.indexOf(quote, cursor);
      if (end < 0) return invalid();
      const value = text.slice(cursor, end);
      if (value.includes('<') || !entities(value)) return invalid();
      cursor = end + 1;
    }
    // Self-closing elements still count toward the nesting budget.
    if (stack.length + 1 > limits.xmlDepth) return unsupported();
    if (!selfClosing) stack.push(opening);
  }
  return seenRoot && stack.length === 0
    ? { allowed: true, format: 'xml-single-element-fragment' }
    : invalid();
}
/** Root plus ASCII unquoted members / canonical integer array indexes only; no execution. */
export function inspectPostgresJsonpathLiteral(text: string): Decision {
  const limits = postgresStructuredLiteralLimits;
  if (text.length > limits.jsonpathBytes || byteCount(text) > limits.jsonpathBytes)
    return tooLong();
  if (!text.startsWith('$')) return unsupported();
  let cursor = 1,
    accessors = 0;
  while (cursor < text.length) {
    if (++accessors > limits.jsonpathAccessors) return unsupported();
    const member = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(cursor));
    if (member) {
      if (member[1]!.length > limits.nameChars) return unsupported();
      cursor += member[0].length;
      continue;
    }
    const index = /^\[(0|[1-9][0-9]{0,3})\]/.exec(text.slice(cursor));
    if (!index || Number(index[1]) > limits.jsonpathIndex) return unsupported();
    cursor += index[0].length;
  }
  return { allowed: true, format: 'jsonpath-root-member-index' };
}

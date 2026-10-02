import { nativeExpressionSchema, MAX_DOCUMENT_BYTES } from '@ezerd/contracts';
import { nativeEditorErrorCode } from './native-editor-diagnostic.js';
import {
  nativeBuiltinFunctionIds,
  nativeExpressionDecision,
  inspectNativeLiteralToken,
  type NativeExpression,
  type NativeExpressionPolicyFacts,
  type DatabaseContext,
  type NativeLiteral,
} from '@ezerd/model';

export type NativeAstDraft =
  | { kind: 'literal'; literalType: NativeLiteral['literalType']; value: string }
  | { kind: 'null' }
  | { kind: 'column'; columnId: string }
  | { kind: 'call'; functionId: string; args: NativeAstDraft[] }
  | { kind: 'unary'; operator: 'NOT' | '+' | '-'; operand: NativeAstDraft }
  | {
      kind: 'binary';
      operator: Extract<NativeExpression, { kind: 'binary' }>['operator'];
      left: NativeAstDraft;
      right: NativeAstDraft;
    }
  | { kind: 'isNull'; operand: NativeAstDraft; negate: boolean }
  | { kind: 'in'; operand: NativeAstDraft; values: NativeAstDraft[]; negate: boolean };
export const nativeAstKinds = [
  'literal',
  'null',
  'column',
  'call',
  'unary',
  'binary',
  'isNull',
  'in',
] as const;
export const nativeAstMaxDepth = 32;
export const nativeAstMaxNodes = 1024;
export const nativeAstMaxList = 32;
const clone = <T>(value: T): T => structuredClone(value);
const literalKinds = new Set(['number', 'string', 'boolean', 'binary', 'json', 'typedText']);

/** Incomplete tokens are valid drafts. Only structure/budgets are checked before rendering. */
export function assertNativeAstDraft(raw: unknown): asserts raw is NativeAstDraft {
  const pending = [{ value: raw, depth: 0 }],
    seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > nativeAstMaxDepth || ++nodes > nativeAstMaxNodes)
      throw Error('expression.complexity-limit');
    if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value))
      throw Error('expression.draft-invalid');
    seen.add(value);
    const node = value as Record<string, unknown>;
    const child = (part: unknown) => pending.push({ value: part, depth: depth + 1 });
    let fields: string[];
    switch (node.kind) {
      case 'literal':
        fields = ['kind', 'literalType', 'value'];
        if (
          typeof node.literalType !== 'string' ||
          !literalKinds.has(node.literalType) ||
          typeof node.value !== 'string'
        )
          throw Error('expression.draft-invalid');
        break;
      case 'null':
        fields = ['kind'];
        break;
      case 'column':
        fields = ['kind', 'columnId'];
        if (typeof node.columnId !== 'string') throw Error('expression.draft-invalid');
        break;
      case 'call':
        fields = ['kind', 'functionId', 'args'];
        if (
          typeof node.functionId !== 'string' ||
          !Array.isArray(node.args) ||
          node.args.length > nativeAstMaxList
        )
          throw Error('expression.draft-invalid');
        node.args.forEach(child);
        break;
      case 'unary':
        fields = ['kind', 'operator', 'operand'];
        if (!['NOT', '+', '-'].includes(String(node.operator)))
          throw Error('expression.draft-invalid');
        child(node.operand);
        break;
      case 'binary':
        fields = ['kind', 'operator', 'left', 'right'];
        if (
          !['+', '-', '*', '/', '%', '=', '<>', '<', '<=', '>', '>=', 'AND', 'OR'].includes(
            String(node.operator),
          )
        )
          throw Error('expression.draft-invalid');
        child(node.left);
        child(node.right);
        break;
      case 'isNull':
        fields = ['kind', 'negate', 'operand'];
        if (typeof node.negate !== 'boolean') throw Error('expression.draft-invalid');
        child(node.operand);
        break;
      case 'in':
        fields = ['kind', 'negate', 'operand', 'values'];
        if (
          typeof node.negate !== 'boolean' ||
          !Array.isArray(node.values) ||
          node.values.length > nativeAstMaxList
        )
          throw Error('expression.draft-invalid');
        child(node.operand);
        node.values.forEach(child);
        break;
      default:
        throw Error('expression.draft-invalid');
    }
    if (Object.keys(node).some((key) => !fields.includes(key)))
      throw Error('expression.draft-invalid');
  }
}
export function readNativeAstDraft(text: string): NativeAstDraft {
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES)
    throw Error('expression.complexity-limit');
  const raw: unknown = JSON.parse(text);
  assertNativeAstDraft(raw);
  return raw;
}
export function nativeAstDraft(expression: NativeExpression): NativeAstDraft {
  nativeExpressionSchema.parse(expression);
  const transform = (node: NativeExpression): NativeAstDraft => {
    switch (node.kind) {
      case 'literal':
        return { ...node, value: String(node.value) };
      case 'call':
        return { ...node, args: node.args.map(transform) };
      case 'unary':
      case 'isNull':
        return { ...node, operand: transform(node.operand) };
      case 'binary':
        return { ...node, left: transform(node.left), right: transform(node.right) };
      case 'in':
        return { ...node, operand: transform(node.operand), values: node.values.map(transform) };
      default:
        return clone(node);
    }
  };
  const draft = transform(expression);
  assertNativeAstDraft(draft);
  return draft;
}
export function nativeAstExpression(draft: NativeAstDraft): NativeExpression {
  assertNativeAstDraft(draft);
  const convert = (node: NativeAstDraft): NativeExpression => {
    switch (node.kind) {
      case 'literal': {
        if (node.literalType === 'boolean' && !['true', 'false'].includes(node.value))
          throw Error('literal.boolean-invalid');
        const value: NativeLiteral =
          node.literalType === 'boolean'
            ? { kind: 'literal', literalType: 'boolean', value: node.value === 'true' }
            : { kind: 'literal', literalType: node.literalType, value: node.value };
        const inspected = inspectNativeLiteralToken(value);
        if (!inspected.allowed) throw Error(inspected.code ?? 'literal.invalid');
        return value;
      }
      case 'call':
        return {
          ...node,
          functionId: node.functionId as Extract<NativeExpression, { kind: 'call' }>['functionId'],
          args: node.args.map(convert),
        };
      case 'unary':
      case 'isNull':
        return { ...node, operand: convert(node.operand) };
      case 'binary':
        return { ...node, left: convert(node.left), right: convert(node.right) };
      case 'in':
        return { ...node, operand: convert(node.operand), values: node.values.map(convert) };
      default:
        return clone(node);
    }
  };
  const result = convert(draft);
  // Check complete structure, but do not use parser normalization to rewrite exact evidence.
  nativeExpressionSchema.parse(result);
  return result;
}
export function nativeAstSeed(
  kind: NativeAstDraft['kind'],
  context: DatabaseContext,
  columnId = '',
): NativeAstDraft {
  const number: NativeAstDraft = { kind: 'literal', literalType: 'number', value: '0' };
  switch (kind) {
    case 'literal':
      return number;
    case 'null':
      return { kind };
    case 'column':
      return { kind, columnId };
    case 'call':
      return { kind, functionId: `${context.kind}:abs`, args: [number] };
    case 'unary':
      return { kind, operator: '+', operand: number };
    case 'binary':
      return { kind, operator: '+', left: number, right: clone(number) };
    case 'isNull':
      return { kind, negate: false, operand: columnId ? { kind: 'column', columnId } : number };
    case 'in':
      return {
        kind,
        negate: false,
        operand: columnId ? { kind: 'column', columnId } : number,
        values: [clone(number)],
      };
  }
}
/** Safe tree addressing: only fixed child slots and bounded list positions can be written. */
export function updateNativeAstDraft(
  root: NativeAstDraft,
  path: readonly (string | number)[],
  replacement: NativeAstDraft,
): NativeAstDraft {
  assertNativeAstDraft(root);
  assertNativeAstDraft(replacement);
  if (!path.length) return clone(replacement);
  const result = clone(root);
  let node = result;
  for (let position = 0; position < path.length; position++) {
    const key = path[position],
      last = position === path.length - 1;
    if ((key === 'left' || key === 'right') && node.kind === 'binary') {
      if (last) node[key] = clone(replacement);
      else node = node[key];
    } else if (key === 'operand' && ['unary', 'isNull', 'in'].includes(node.kind)) {
      const holder = node as Extract<NativeAstDraft, { kind: 'unary' | 'isNull' | 'in' }>;
      if (last) holder.operand = clone(replacement);
      else node = holder.operand;
    } else if (
      (key === 'args' && node.kind === 'call') ||
      (key === 'values' && node.kind === 'in')
    ) {
      const list =
        node.kind === 'call' ? node.args : (node as Extract<NativeAstDraft, { kind: 'in' }>).values;
      const index = path[++position];
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= list.length
      )
        throw Error('expression.path-invalid');
      if (position === path.length - 1) list[index] = clone(replacement);
      else node = list[index]!;
    } else throw Error('expression.path-invalid');
  }
  assertNativeAstDraft(result);
  return result;
}
export function nativeAstDecision(
  context: DatabaseContext,
  draft: NativeAstDraft,
  facts: NativeExpressionPolicyFacts,
) {
  try {
    const expression = nativeAstExpression(draft);
    return { ...nativeExpressionDecision(context, expression, facts), expression };
  } catch (error) {
    return {
      allowed: false,
      usable: false,
      code: nativeEditorErrorCode(error, 'expression.draft-invalid'),
    };
  }
}
export function nativeAstFunctionChoices(
  context: DatabaseContext,
  draft: Extract<NativeAstDraft, { kind: 'call' }>,
  facts: NativeExpressionPolicyFacts,
) {
  return nativeBuiltinFunctionIds
    .filter((id) => id.startsWith(context.kind + ':'))
    .map((id) => ({ id, ...nativeAstDecision(context, { ...draft, functionId: id }, facts) }));
}
export function wrapNativeAstDraft(
  node: NativeAstDraft,
  operator: 'AND' | 'OR' | 'NOT' | '+' | '=',
): NativeAstDraft {
  if (operator === 'NOT') return { kind: 'unary', operator, operand: clone(node) };
  return {
    kind: 'binary',
    operator,
    left: clone(node),
    right:
      operator === '='
        ? clone(node)
        : operator === '+'
          ? { kind: 'literal', literalType: 'number', value: '0' }
          : {
              kind: 'literal',
              literalType: 'boolean',
              value: operator === 'AND' ? 'true' : 'false',
            },
  };
}

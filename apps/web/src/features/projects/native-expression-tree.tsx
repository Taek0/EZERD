import './native-advanced-editor.css';
import { useState } from 'react';
import type { DatabaseContext, NativeExpressionPolicyFacts } from '@ezerd/model';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { NativeEditorField } from './native-editor-form.js';
import { PanelSection } from '../../shared/editor/panel.js';
import { nativeEditorConditionText, nativeEditorErrorCode } from './native-editor-diagnostic.js';
import {
  nativeAstKinds,
  nativeAstSeed,
  readNativeAstDraft,
  updateNativeAstDraft,
  nativeAstDecision,
  nativeAstFunctionChoices,
  nativeAstMaxList,
  wrapNativeAstDraft,
  type NativeAstDraft,
} from './native-expression-tree-policy.js';

registerTranslations({
  '식 트리': 'Expression tree',
  '생성하려는 식 선택': 'Select an expression to create',
  '기존 식 묶기': 'Wrap the current expression',
  리터럴: 'Literal',
  '컬럼 참조': 'Column reference',
  함수: 'Function',
  '단항 연산': 'Unary operation',
  '이항 연산': 'Binary operation',
  'NULL 조건': 'NULL condition',
  'IN 값 목록': 'IN value list',
  왼쪽: 'Left',
  오른쪽: 'Right',
  피연산자: 'Operand',
  '함수 인자': 'Function argument',
  '값 추가': 'Add value',
  '인자 추가': 'Add argument',
  위로: 'Move up',
  아래로: 'Move down',
  제거: 'Remove',
  부정: 'Negate',
  '현재 원문 유지': 'Preserve the current original value',
  '엔진에서 허용': 'Allowed by the engine',
  '저장 검증 미완료': 'Saving verification is incomplete',
  '입력 또는 조합을 지원하지 않음': 'Input or combination is unsupported',
  '손상된 식 초안을 보존했습니다. 이 초안은 저장할 수 없으며 원문은 유지됩니다.':
    'The damaged expression draft was preserved. This draft cannot be saved; its original text is retained.',
  '기존 식을 AND로 묶기': 'Wrap the current expression with AND',
  '기존 식을 OR로 묶기': 'Wrap the current expression with OR',
  '기존 식을 NOT으로 묶기': 'Wrap the current expression with NOT',
  '기존 식을 합으로 묶기': 'Wrap the current expression in an addition',
  '기존 식을 비교로 묶기': 'Wrap the current expression in a comparison',
  '완성되지 않은 토큰은 원문 초안으로 남으며 저장되지 않습니다.':
    'Incomplete tokens remain as original draft text and are not saved.',
  연산자: 'Operator',
  '리터럴 종류': 'Literal type',
  값: 'Value',
  컬럼: 'Column',
});
const labels = {
  literal: '리터럴',
  null: 'NULL',
  column: '컬럼 참조',
  call: '함수',
  unary: '단항 연산',
  binary: '이항 연산',
  isNull: 'NULL 조건',
  in: 'IN 값 목록',
};
export function NativeExpressionTreeEditor({
  value,
  onChange,
  database,
  facts,
  disabled = false,
  label = '식 트리',
}: {
  value: string;
  onChange: (value: string) => void;
  database: DatabaseContext;
  facts: NativeExpressionPolicyFacts;
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const [editError, setEditError] = useState('');
  let root: NativeAstDraft;
  try {
    root = readNativeAstDraft(value);
  } catch (error) {
    return (
      <p role="alert">
        {t('손상된 식 초안을 보존했습니다. 이 초안은 저장할 수 없으며 원문은 유지됩니다.')} (
        {nativeEditorConditionText(nativeEditorErrorCode(error, 'expression.draft-invalid'))})
      </p>
    );
  }
  const decision = nativeAstDecision(database, root, facts);
  // A subtree need not have the final target/boolean result. Its parent supplies that constraint.
  const childFacts: NativeExpressionPolicyFacts = {
    columns: facts.columns,
    tableId: facts.tableId,
    purpose: facts.purpose === 'default' ? 'default' : 'index',
    ...(facts.strict !== undefined ? { strict: facts.strict } : {}),
  };
  const visible = facts.columns.filter((c) => c.tableId === facts.tableId && c.scope !== 'logical');
  function edit(path: readonly (string | number)[], next: NativeAstDraft) {
    if (disabled) return;
    try {
      const tree = updateNativeAstDraft(root, path, next);
      onChange(JSON.stringify(tree));
      setEditError('');
    } catch (error) {
      setEditError(nativeEditorErrorCode(error, 'expression.draft-invalid'));
    }
  }
  function nodeFields(
    node: NativeAstDraft,
    path: readonly (string | number)[],
    title: string,
  ): React.ReactNode {
    const field = (
      name: string,
      current: string,
      update: (value: string) => NativeAstDraft,
      choices?: readonly { value: string; label: string; disabled?: boolean }[],
    ) => (
      <NativeEditorField
        label={name}
        value={current}
        onChange={(v) => edit(path, update(v))}
        {...(choices ? { choices } : {})}
        disabled={disabled}
      />
    );
    const columnId = facts.purpose === 'default' ? '' : (visible[0]?.id ?? '');
    const child = (
      part: NativeAstDraft,
      slot: string | readonly (string | number)[],
      name: string,
    ) => (
      <PanelSection
        className="native-expression-branch"
        title={`${t(name)} · ${t(labels[part.kind])}`}
        defaultOpen={part.kind === 'column' || part.kind === 'literal' || part.kind === 'null'}
      >
        {nodeFields(part, [...path, ...(typeof slot === 'string' ? [slot] : slot)], name)}
      </PanelSection>
    );
    const local = nativeAstDecision(database, node, childFacts);
    const wrapAllowed = (operator: Parameters<typeof wrapNativeAstDraft>[1]) =>
      nativeAstDecision(database, wrapNativeAstDraft(node, operator), childFacts).allowed;
    const operators =
      node.kind === 'binary'
        ? ['+', '-', '*', '/', '%', '=', '<>', '<', '<=', '>', '>=', 'AND', 'OR']
        : ['NOT', '+', '-'];
    const operatorChoices = (operators as string[]).map((operator) => {
      const check = nativeAstDecision(
        database,
        { ...node, operator } as NativeAstDraft,
        childFacts,
      );
      return {
        value: operator,
        label: operator,
        disabled: operator !== ('operator' in node ? node.operator : '') && !check.allowed,
      };
    });
    const list = (items: NativeAstDraft[], kind: 'args' | 'values') => (
      <>
        {items.map((item, i) => (
          <div key={i}>
            {child(item, [kind, i], `${t(kind === 'args' ? '함수 인자' : '값')} ${i + 1}`)}
            <Button
              disabled={disabled || i === 0}
              onClick={() => {
                const next = [...items];
                [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                edit(path, { ...node, [kind]: next } as NativeAstDraft);
              }}
            >
              {t('위로')}
            </Button>
            <Button
              disabled={disabled || i === items.length - 1}
              onClick={() => {
                const next = [...items];
                [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                edit(path, { ...node, [kind]: next } as NativeAstDraft);
              }}
            >
              {t('아래로')}
            </Button>
            <Button
              disabled={disabled}
              onClick={() =>
                edit(path, { ...node, [kind]: items.filter((_, j) => i !== j) } as NativeAstDraft)
              }
            >
              {t('제거')}
            </Button>
          </div>
        ))}
        <Button
          disabled={disabled || items.length >= nativeAstMaxList}
          onClick={() =>
            edit(path, {
              ...node,
              [kind]: [...items, nativeAstSeed('literal', database)],
            } as NativeAstDraft)
          }
        >
          {t(kind === 'args' ? '인자 추가' : '값 추가')}
        </Button>
      </>
    );
    return (
      <fieldset disabled={disabled} key={JSON.stringify(path)}>
        <legend>{t(title)}</legend>
        {field(
          '생성하려는 식 선택',
          node.kind,
          (kind) => nativeAstSeed(kind as NativeAstDraft['kind'], database, columnId),
          nativeAstKinds.map((kind) => ({
            value: kind,
            label: t(labels[kind]),
            disabled: kind === 'column' && facts.purpose === 'default',
          })),
        )}
        {node.kind === 'literal' && (
          <>
            {field(
              '리터럴 종류',
              node.literalType,
              (literalType) => ({ ...node, literalType: literalType as typeof node.literalType }),
              (['string', 'number', 'boolean', 'binary', 'json', 'typedText'] as const).map(
                (type) => {
                  const sample = {
                    string: 'text',
                    number: '0',
                    boolean: 'true',
                    binary: '00',
                    json: '{}',
                    typedText: '2024-01-01',
                  }[type];
                  const allowed = nativeAstDecision(
                    database,
                    { kind: 'literal', literalType: type, value: sample },
                    childFacts,
                  );
                  return {
                    value: type,
                    label: type,
                    disabled:
                      type !== node.literalType &&
                      (!allowed.allowed ||
                        ('result' in allowed && allowed.result?.family === 'unsupported')),
                  };
                },
              ),
            )}
            {field('값', node.value, (text) => ({ ...node, value: text }))}
          </>
        )}
        {node.kind === 'column' &&
          field('컬럼', node.columnId, (columnId) => ({ ...node, columnId }), [
            { value: '', label: '—' },
            ...visible.map((c) => ({
              value: c.id,
              label: c.physical.name || c.logical.name || c.id,
              disabled: facts.purpose === 'default',
            })),
            ...(!visible.some((c) => c.id === node.columnId) && node.columnId
              ? [
                  {
                    value: node.columnId,
                    label: `${node.columnId} · ${t('현재 원문 유지')}`,
                    disabled: true,
                  },
                ]
              : []),
          ])}
        {node.kind === 'call' && (
          <>
            {field('함수', node.functionId, (functionId) => ({ ...node, functionId }), [
              ...nativeAstFunctionChoices(database, node, childFacts).map((c) => ({
                value: c.id,
                label: `${c.id.split(':')[1]}${c.allowed ? '' : ` · ${nativeEditorConditionText(c.code)}`}`,
                disabled: c.id !== node.functionId && !c.allowed,
              })),
              ...(!nativeAstFunctionChoices(database, node, childFacts).some(
                (choice) => choice.id === node.functionId,
              )
                ? [
                    {
                      value: node.functionId,
                      label: `${node.functionId} · ${t('현재 원문 유지')}`,
                      disabled: true,
                    },
                  ]
                : []),
            ])}
            {list(node.args, 'args')}
          </>
        )}
        {(node.kind === 'unary' || node.kind === 'binary') &&
          field(
            '연산자',
            node.operator,
            (operator) => ({ ...node, operator }) as NativeAstDraft,
            operatorChoices,
          )}
        {node.kind === 'binary' && (
          <>
            {child(node.left, 'left', '왼쪽')}
            {child(node.right, 'right', '오른쪽')}
          </>
        )}
        {(node.kind === 'unary' || node.kind === 'isNull' || node.kind === 'in') &&
          child(node.operand, 'operand', '피연산자')}
        {(node.kind === 'isNull' || node.kind === 'in') &&
          field('부정', String(node.negate), (negate) => ({ ...node, negate: negate === 'true' }), [
            { value: 'false', label: 'false' },
            { value: 'true', label: 'true' },
          ])}
        {node.kind === 'in' && list(node.values, 'values')}
        <PanelSection title={t('기존 식 묶기')}>
          <Button
            disabled={disabled || !wrapAllowed('AND')}
            onClick={() =>
              edit(path, {
                kind: 'binary',
                operator: 'AND',
                left: structuredClone(node),
                right: { kind: 'literal', literalType: 'boolean', value: 'true' },
              })
            }
          >
            {t('기존 식을 AND로 묶기')}
          </Button>
          <Button
            disabled={disabled || !wrapAllowed('OR')}
            onClick={() =>
              edit(path, {
                kind: 'binary',
                operator: 'OR',
                left: structuredClone(node),
                right: { kind: 'literal', literalType: 'boolean', value: 'false' },
              })
            }
          >
            {t('기존 식을 OR로 묶기')}
          </Button>
          <Button
            disabled={disabled || !wrapAllowed('NOT')}
            onClick={() =>
              edit(path, { kind: 'unary', operator: 'NOT', operand: structuredClone(node) })
            }
          >
            {t('기존 식을 NOT으로 묶기')}
          </Button>
          <Button
            disabled={disabled || !wrapAllowed('+')}
            onClick={() =>
              edit(path, {
                kind: 'binary',
                operator: '+',
                left: structuredClone(node),
                right: { kind: 'literal', literalType: 'number', value: '0' },
              })
            }
          >
            {t('기존 식을 합으로 묶기')}
          </Button>
          <Button
            disabled={disabled || !wrapAllowed('=')}
            onClick={() => edit(path, wrapNativeAstDraft(node, '='))}
          >
            {t('기존 식을 비교로 묶기')}
          </Button>
        </PanelSection>
        {!local.allowed && <p role="status">{nativeEditorConditionText(local.code)}</p>}
      </fieldset>
    );
  }
  return (
    <section className="native-expression-editor" aria-label={t(label)}>
      {nodeFields(root, [], label)}
      <p role="status">
        {t(decision.allowed ? '엔진에서 허용' : '입력 또는 조합을 지원하지 않음')}
        {!decision.usable && ` · ${t('저장 검증 미완료')}`}{' '}
        {decision.code && nativeEditorConditionText(decision.code)}
      </p>
      <p>{t('완성되지 않은 토큰은 원문 초안으로 남으며 저장되지 않습니다.')}</p>
      {editError && <p role="alert">{nativeEditorConditionText(editError)}</p>}
    </section>
  );
}

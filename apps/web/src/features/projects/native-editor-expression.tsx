import type { NativeColumn, NativeExpression } from '@ezerd/model';
import { nativeExpressionSchema } from '@ezerd/contracts';
import { NativeEditorField } from './native-editor-form.js';

export function nativeExpressionInputs(expression?: NativeExpression): Record<string, string> {
  if (
    expression?.kind === 'binary' &&
    expression.left.kind === 'column' &&
    expression.right.kind === 'literal'
  )
    return {
      expressionColumn: expression.left.columnId,
      expressionOperator: expression.operator,
      expressionLiteralType: expression.right.literalType,
      expressionValue: String(expression.right.value),
    };
  return {
    expressionColumn: '',
    expressionOperator: '>',
    expressionLiteralType: 'number',
    expressionValue: '0',
  };
}
export function nativeExpressionFromInputs(values: Record<string, string>): NativeExpression {
  return nativeExpressionSchema.parse({
    kind: 'binary',
    operator: values.expressionOperator,
    left: { kind: 'column', columnId: values.expressionColumn },
    right: {
      kind: 'literal',
      literalType: values.expressionLiteralType,
      value:
        values.expressionLiteralType === 'boolean'
          ? values.expressionValue === 'true'
          : values.expressionValue,
    },
  });
}
export function NativeExpressionFields({
  values,
  change,
  columns,
  disabled = false,
}: {
  values: Record<string, string>;
  change: (field: string, value: string) => void;
  columns: NativeColumn[];
  disabled?: boolean;
}) {
  return (
    <>
      <NativeEditorField
        label="컬럼"
        value={values.expressionColumn ?? ''}
        disabled={disabled}
        onChange={(value) => change('expressionColumn', value)}
        choices={[
          { value: '', label: '—' },
          ...columns.map((column) => ({
            value: column.id,
            label: column.physical.name || column.logical.name || column.id,
          })),
        ]}
      />
      <NativeEditorField
        label="연산자"
        value={values.expressionOperator ?? '>'}
        disabled={disabled}
        onChange={(value) => change('expressionOperator', value)}
        choices={['=', '<>', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', 'AND', 'OR'].map(
          (value) => ({ value, label: value }),
        )}
      />
      <NativeEditorField
        label="리터럴 종류"
        value={values.expressionLiteralType ?? 'number'}
        disabled={disabled}
        onChange={(value) => change('expressionLiteralType', value)}
        choices={['string', 'number', 'boolean', 'binary', 'json', 'typedText'].map((value) => ({
          value,
          label: value,
        }))}
      />
      <NativeEditorField
        label="값"
        value={values.expressionValue ?? '0'}
        disabled={disabled}
        onChange={(value) => change('expressionValue', value)}
        {...(values.expressionLiteralType === 'boolean'
          ? { choices: ['true', 'false'].map((value) => ({ value, label: value })) }
          : {})}
      />
    </>
  );
}

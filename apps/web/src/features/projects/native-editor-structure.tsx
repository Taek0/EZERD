import { PanelSection } from '../../shared/editor/panel.js';
import { useState } from 'react';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import {
  createNativeTable,
  createNativeColumn,
  nativeExpressionDisplay,
  planNativeDeletion,
  createNativeForeignKeyFromPrimaryKey,
  type NativeDesignDocument,
  type NativeTable,
  type NativeDeletionCollection,
} from '@ezerd/model';
import { AnimatedDetails, Button, Checkbox, IconButton } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  NativeEditorField,
  NativeEditorForm,
  type NativeEditorContext,
} from './native-editor-form.js';
import {
  NativeExpressionFields,
  nativeExpressionFromInputs,
  nativeExpressionInputs,
} from './native-editor-expression.js';
import { nativeEditorPolicy } from './native-editor-policy.js';
import type { NativeWebCommand } from './native-save.js';
import { nativeKeyColumnPolicies, nativeKeyInput } from './native-editor-option-policy.js';
import { NativeAdvancedEditor } from './NativeAdvancedEditor.js';
import {
  nativeConstraintOptionsInitial,
  nativeConstraintOptionsPatch,
  nativeConstraintOptionsDecision,
  nativeEnumOptionsDecision,
} from './native-constraint-options.js';
import {
  NativeConstraintOptionFields,
  NativeEnumOptionSummary,
} from './native-constraint-option-fields.js';
import { NativeLabelFields } from './NativeLabelFields.js';
import { serializeNativeLabels, nativeLabelsForCommand } from './native-label-draft.js';
import { nativeEditorConditionText, nativeEditorErrorCode } from './native-editor-diagnostic.js';

registerTranslations({
  '물리·논리 범위를 선택하고 이름을 입력하세요.':
    'Choose the physical or logical scope and enter a name.',
  '구조 편집': 'Edit structure',
  '새 테이블': 'New table',
  '새 컬럼': 'New column',
  '새 키': 'New key',
  '새 인덱스': 'New index',
  '새 CHECK': 'New CHECK',
  '새 ENUM': 'New ENUM',
  '새 외래 키': 'New foreign key',
  '기존 객체 수정': 'Edit an existing object',
  '객체 삭제': 'Delete object',
  대상: 'Target',
  범위: 'Scope',
  '키 종류': 'Key kind',
  '컬럼 추가': 'Add column',
  위로: 'Move up',
  아래로: 'Move down',
  제거: 'Remove',
  '컬럼 순서': 'Column order',
  '삭제 영향': 'Deletion impact',
  '삭제 영향을 확인했습니다.': 'I reviewed the deletion impact.',
  '생성 컬럼 연쇄 삭제': 'Cascade deletion to generated columns',
  '논리 초안은 저장할 수 있습니다. 신규 물리 기능은 검증 완료 후 사용할 수 있습니다.':
    'Logical drafts can be saved. New physical features require completed verification.',
  '기존 식 유지': 'Preserve existing expression',
  '구조화 식으로 변경': 'Change to a structured expression',
  '원본 속성': 'Original properties',
  '현재 설계 형식에서는 관계의 테이블 변경을 지원하지 않습니다.':
    'This design format does not support changing the relationship tables.',
  '현재 설계 형식에서는 물리 FK만 제거할 수 없습니다.':
    'This design format does not support removing only the physical foreign key.',
  'PK / UNIQUE와 FK 컬럼을 같은 수로 선택하세요.':
    'Select the same number of PK / UNIQUE and FK columns.',
  'PK에서 컬럼 자동 생성': 'Generate columns from primary key',
  '직접 컬럼 연결': 'Map existing columns',
  '참조 테이블': 'Referenced table',
  '참조 키': 'Referenced key',
  '삭제 차단 항목': 'Deletion blockers',
  '키 후보': 'Key candidates',
  '엔진에서 허용': 'Allowed by the engine',
  '제품 검증 미완료': 'Product verification is incomplete',
  '현재 원문 유지': 'Preserve the current original value',
});

const list = (value: string | undefined) => (value ? value.split('\n') : []);
const bool = [
  { value: 'false', label: 'false' },
  { value: 'true', label: 'true' },
];
export function NativeOrderedColumns({
  value,
  change,
  document,
  tableId,
  disabled = false,
  label = '컬럼 순서',
  keyKind,
}: {
  value: string;
  change: (value: string) => void;
  document: NativeDesignDocument;
  tableId: string;
  disabled?: boolean;
  label?: string;
  keyKind?: 'primary' | 'unique' | undefined;
}) {
  const { t } = useI18n();
  const ids = list(value);
  const columns = (document.columns ?? []).filter(
    (item) => item.tableId === tableId && item.scope !== 'logical',
  );
  const table = document.tables?.find((item) => item.id === tableId);
  const eligibility =
    keyKind && table ? nativeKeyColumnPolicies(document, table, keyKind, ids) : undefined;
  const canAdd = (id: string) =>
    !ids.includes(id) &&
    (!eligibility || !!eligibility.find((item) => item.column.id === id)?.productUsable);
  return (
    <fieldset disabled={disabled}>
      <legend>{t(label)}</legend>
      {ids.map((id, position) => (
        <div key={position}>
          <NativeEditorField
            label={`${position + 1}`}
            value={id}
            onChange={(value) =>
              change(ids.map((item, index) => (index === position ? value : item)).join('\n'))
            }
            choices={[
              { value: '', label: '—' },
              ...(eligibility ? eligibility.map((item) => item.column) : columns).map((column) => ({
                value: column.id,
                label: `${column.physical.name || column.logical.name || column.id}${eligibility ? ` · ${t(eligibility.find((item) => item.column.id === column.id)?.engineAllowed ? '엔진에서 허용' : '이 DB에서 지원하지 않음')}` : ''}`,
                disabled:
                  column.id !== id &&
                  (ids.includes(column.id) ||
                    (eligibility &&
                      !eligibility.find((item) => item.column.id === column.id)?.productUsable)),
              })),
              ...(!columns.some((column) => column.id === id)
                ? [{ value: id, label: `${id} · ${t('현재 원문 유지')}`, disabled: true }]
                : []),
            ]}
          />
          <Button
            disabled={position === 0}
            onClick={() => {
              const next = [...ids];
              [next[position - 1], next[position]] = [next[position]!, next[position - 1]!];
              change(next.join('\n'));
            }}
          >
            {t('위로')}
          </Button>
          <Button
            disabled={position === ids.length - 1}
            onClick={() => {
              const next = [...ids];
              [next[position + 1], next[position]] = [next[position]!, next[position + 1]!];
              change(next.join('\n'));
            }}
          >
            {t('아래로')}
          </Button>
          <Button onClick={() => change(ids.filter((_, index) => index !== position).join('\n'))}>
            {t('제거')}
          </Button>
        </div>
      ))}
      <Button
        disabled={ids.length >= 32 || !columns.some((column) => canAdd(column.id))}
        onClick={() =>
          change([...ids, columns.find((column) => canAdd(column.id))?.id ?? ''].join('\n'))
        }
      >
        {t('컬럼 추가')}
      </Button>
      {eligibility && (
        <div role="status">
          <p>{t('키 후보')}</p>
          <ul>
            {eligibility.map((item) => (
              <li key={item.column.id}>
                {item.column.physical.name || item.column.id} ·{' '}
                {t(item.engineAllowed ? '엔진에서 허용' : '이 DB에서 지원하지 않음')}
                {!item.productUsable && ` · ${t('제품 검증 미완료')}`}
                {item.code && ` · ${nativeEditorConditionText(item.code)}`}
                {item.eligibility.estimatedBytes !== undefined &&
                  ` · ${item.eligibility.estimatedBytes} bytes`}
                {item.eligibility.conditions.length > 0 &&
                  ` · ${item.eligibility.conditions.map(nativeEditorConditionText).join(' · ')}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}

export type NativeStructureAction =
  'table' | 'column' | 'key' | 'index' | 'check' | 'enum' | 'foreignKey';
export function nativeStructureCommands(
  document: NativeDesignDocument,
  table: NativeTable | undefined,
  action: NativeStructureAction,
  values: Record<string, string>,
): NativeWebCommand[] {
  const policy = nativeEditorPolicy(document, table);
  if (action !== 'table' && action !== 'enum' && !table)
    throw new Error('document.owner-table-not-found');
  if (action === 'key' && table)
    nativeKeyInput(
      document,
      table,
      values.keyKind === 'primary' ? 'primary' : 'unique',
      list(values.columnIds),
    );
  if (action === 'index' && table && values.unique === 'true')
    nativeKeyInput(document, table, 'unique', list(values.columnIds));
  if (!['table', 'column'].includes(action) || values.scope !== 'logical') {
    const feature =
      action === 'key'
        ? values.keyKind === 'unique'
          ? 'unique'
          : 'primaryKey'
        : action === 'enum'
          ? 'enumType'
          : action;
    const decision = policy.feature(feature as Parameters<typeof policy.feature>[0]);
    if (!decision.usable) throw new Error(decision.code ?? 'feature.not-implemented');
  }
  if (
    (action === 'key' || (action === 'index' && values.unique === 'true')) &&
    table &&
    nativeKeyInput(
      document,
      table,
      action === 'key' && values.keyKind === 'primary' ? 'primary' : 'unique',
      list(values.columnIds),
    ).some((item) => !item.productUsable)
  )
    throw new Error('key.not-ready');
  const scope = values.scope ?? 'physical';
  let command: unknown;
  const id = values.id;
  const name = values.name ?? '';
  if (action === 'table') {
    const value = createNativeTable(
      document.database,
      id!,
      values.domainId || null,
      scope as 'logical' | 'physical' | 'both',
    );
    value.physical.name = name;
    value.logical.name = values.logicalName ?? '';
    command = { type: 'add_table', value };
  } else if (action === 'column') {
    const value = createNativeColumn(document.database, table!, id!);
    value.scope = scope as 'logical' | 'physical' | 'both';
    if (table!.scope !== 'both' && value.scope !== table!.scope)
      throw new Error('document.scope-mismatch');
    value.physical.name = name;
    value.logical.name = values.logicalName ?? '';
    command = { type: 'add_column', value };
  } else if (action === 'key')
    command = {
      type: 'add_key',
      value: {
        id,
        name,
        tableId: table!.id,
        scope,
        kind: values.keyKind,
        columnIds: list(values.columnIds),
        ...nativeConstraintOptionsPatch('key', values),
      },
    };
  else if (action === 'index')
    command = {
      type: 'add_index',
      value: {
        id,
        name,
        tableId: table!.id,
        scope,
        unique: values.unique === 'true',
        parts: list(values.columnIds).map((columnId) => ({
          expression: { kind: 'column', columnId },
          direction: values.direction,
        })),
        options:
          document.database.kind === 'postgresql'
            ? { database: 'postgresql', method: 'btree' }
            : document.database.kind === 'mysql'
              ? { database: 'mysql', kind: 'btree' }
              : { database: 'sqlite' },
      },
    };
  else if (action === 'check')
    command = {
      type: 'add_check',
      value: {
        id,
        name,
        tableId: table!.id,
        scope,
        expression: nativeExpressionFromInputs(values),
      },
    };
  else if (action === 'enum')
    command = {
      type: 'add_enum',
      value: {
        id,
        name,
        schema: values.schema,
        values: nativeLabelsForCommand(values, {}, 'enumLabelsJSON', 'enumValues', []),
      },
    };
  else if (values.foreignMode === 'derived') {
    const key = document.keys?.find(
      (key) =>
        key.id === values.primaryKeyId &&
        key.tableId === values.targetTableId &&
        key.kind === 'primary',
    );
    if (!key) throw new Error('foreign-key.primary-key-not-found');
    const columnIds = list(values.generatedColumnIds);
    if (columnIds.length !== key.columnIds.length) throw new Error('foreign-key.columns-invalid');
    command = {
      type: 'create_foreign_key',
      primaryTableId: key.tableId,
      foreignTableId: table!.id,
      primaryKeyId: key.id,
      relationId: id,
      columnIds,
    };
  } else
    command = {
      type: 'add_foreign_key',
      value: {
        id,
        sourceTableId: table!.id,
        targetTableId: values.targetTableId,
        scope,
        logical: { name: values.logicalName ?? '', cardinality: 'one-to-many', required: false },
        physical: {
          name,
          sourceColumnIds: list(values.columnIds),
          targetColumnIds: list(values.targetColumnIds),
          onDelete: values.onDelete,
          onUpdate: values.onUpdate,
        },
        ...nativeConstraintOptionsPatch('foreignKey', values),
      },
    };
  const parsed = nativeEditorCommandSchema.parse(command);
  if (parsed.type === 'add_enum') {
    const decision = nativeEnumOptionsDecision(
      document,
      parsed.value.id,
      parsed.value.name,
      parsed.value.schema,
      serializeNativeLabels(parsed.value.values),
    );
    if (!decision.allowed || !decision.usable)
      throw Error(decision.code ?? 'feature.not-implemented');
  }
  const options = nativeConstraintOptionsPatch(action === 'key' ? 'key' : 'foreignKey', values);
  if (['key', 'foreignKey'].includes(action) && Object.keys(options).length) {
    if (
      action === 'foreignKey' &&
      options.deferrable &&
      !policy.feature('deferrableForeignKey').usable
    )
      throw Error(policy.feature('deferrableForeignKey').code);
    if (action === 'key' && options.nullsNotDistinct && !policy.feature('nullsNotDistinct').usable)
      throw Error(policy.feature('nullsNotDistinct').code);
    if (parsed.type === 'add_key' || parsed.type === 'add_foreign_key') {
      const decision = nativeConstraintOptionsDecision(
        document,
        action === 'key' ? 'key' : 'foreignKey',
        parsed.value,
        options,
      );
      if (!decision.allowed || !decision.usable)
        throw Error(decision.code ?? 'feature.not-implemented');
    }
    if (parsed.type === 'create_foreign_key') {
      const { type: _type, ...input } = parsed;
      const candidate = createNativeForeignKeyFromPrimaryKey(document, input),
        relation = candidate.tableRelations!.find((r) => r.id === parsed.relationId)!;
      const decision = nativeConstraintOptionsDecision(candidate, 'foreignKey', relation, options);
      if (!decision.allowed || !decision.usable)
        throw Error(decision.code ?? 'feature.not-implemented');
      return [
        parsed,
        nativeEditorCommandSchema.parse({
          type: 'patch_foreign_key',
          id: parsed.relationId,
          patch: options,
        }),
      ];
    }
  }
  return [parsed];
}

function NativeCreateForm({
  context,
  document,
  table,
  action,
  initialValues,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table?: NativeTable;
  action: NativeStructureAction;
  initialValues?: Record<string, string>;
}) {
  const { t } = useI18n();
  const policy = nativeEditorPolicy(document, table);
  // IDs belong to the durable input; retries do not regenerate objects.
  const [id] = useState(() => crypto.randomUUID());
  const initial = {
    scope:
      action === 'table'
        ? 'logical'
        : action === 'column'
          ? table?.scope === 'physical'
            ? 'physical'
            : 'logical'
          : 'physical',
    name: '',
    logicalName: '',
    domainId: table?.domainId ?? '',
    keyKind: 'primary',
    columnIds: '',
    unique: 'false',
    direction: 'asc',
    schema: 'public',
    enumLabelsJSON: serializeNativeLabels([]),
    targetTableId: '',
    targetColumnIds: '',
    primaryKeyId: '',
    generatedColumnIds: '',
    foreignMode: 'mapped',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    ...nativeConstraintOptionsInitial(),
    ...nativeExpressionInputs(),
    ...initialValues,
    // Contextual defaults never replace this form's durable identity.
    id,
  };
  const title = {
    table: '새 테이블',
    column: '새 컬럼',
    key: '새 키',
    index: '새 인덱스',
    check: '새 CHECK',
    enum: '새 ENUM',
    foreignKey: '새 외래 키',
  }[action];
  return (
    <NativeEditorForm
      context={context}
      draftKey={`create:${action}:${table?.id ?? 'project'}`}
      title={t(title)}
      initial={initial}
      disabled={(values) => {
        if (
          ['table', 'column'].includes(action) &&
          values.scope === 'logical' &&
          (action === 'table' || table?.scope !== 'physical')
        )
          return false;
        const feature =
          action === 'key'
            ? values.keyKind === 'unique'
              ? 'unique'
              : 'primaryKey'
            : action === 'enum'
              ? 'enumType'
              : action;
        return !policy.feature(feature as Parameters<typeof policy.feature>[0]).usable;
      }}
      build={(values) => nativeStructureCommands(document, table, action, values)}
    >
      {(values, change) => {
        const feature =
          action === 'key'
            ? values.keyKind === 'unique'
              ? 'unique'
              : 'primaryKey'
            : action === 'enum'
              ? 'enumType'
              : action;
        const decision = policy.feature(feature as Parameters<typeof policy.feature>[0]);
        const logical =
          ['table', 'column'].includes(action) &&
          values.scope === 'logical' &&
          (action === 'table' || table?.scope !== 'physical');
        const disabled = !logical && !decision.usable;
        const field = (
          key: string,
          label: string,
          choices?: Parameters<typeof NativeEditorField>[0]['choices'],
          multiline = false,
        ) => (
          <NativeEditorField
            label={label}
            value={values[key] ?? ''}
            onChange={(value) => change(key, value)}
            {...(choices ? { choices } : {})}
            multiline={multiline}
          />
        );
        return (
          <>
            {['table', 'column'].includes(action) && (
              <>
                <p>
                  {t(
                    policy.feature(action === 'table' ? 'table' : 'column').usable
                      ? '물리·논리 범위를 선택하고 이름을 입력하세요.'
                      : '논리 초안은 저장할 수 있습니다. 신규 물리 기능은 검증 완료 후 사용할 수 있습니다.',
                  )}
                </p>
                {field(
                  'scope',
                  '범위',
                  ['logical', 'physical', 'both'].map((value) => ({
                    value,
                    label: value,
                    disabled:
                      value === 'logical'
                        ? action === 'column' && table?.scope === 'physical'
                        : !decision.usable,
                  })),
                )}
              </>
            )}
            {disabled && (
              <p role="status">
                {t(decision.supported ? '미구현 또는 실행 검증 미완료' : '이 DB에서 지원하지 않음')}{' '}
                ({decision.code})
              </p>
            )}
            <fieldset disabled={disabled}>
              {field('name', '물리 이름')}
              {['table', 'column', 'foreignKey'].includes(action) &&
                field('logicalName', '논리 이름')}
              {action === 'table' &&
                field('domainId', '도메인', [
                  { value: '', label: t('미소속') },
                  ...document.domains.map((domain) => ({ value: domain.id, label: domain.name })),
                ])}
              {action === 'key' &&
                field(
                  'keyKind',
                  '키 종류',
                  ['primary', 'unique'].map((value) => ({ value, label: value })),
                )}
              {action === 'key' && (
                <NativeConstraintOptionFields
                  document={document}
                  kind="key"
                  keyKind={values.keyKind ?? 'primary'}
                  values={values}
                  change={change}
                  disabled={disabled || context.busy}
                />
              )}
              {['key', 'index'].includes(action) && table && (
                <NativeOrderedColumns
                  value={values.columnIds ?? ''}
                  change={(value) => change('columnIds', value)}
                  document={document}
                  tableId={table.id}
                  keyKind={
                    action === 'key'
                      ? values.keyKind === 'primary'
                        ? 'primary'
                        : 'unique'
                      : values.unique === 'true'
                        ? 'unique'
                        : undefined
                  }
                />
              )}
              {action === 'index' && (
                <>
                  {field('unique', 'UNIQUE', bool)}
                  {field(
                    'direction',
                    '순서',
                    ['asc', 'desc'].map((value) => ({ value, label: value })),
                  )}
                </>
              )}
              {action === 'check' && table && (
                <NativeExpressionFields
                  values={values}
                  change={change}
                  columns={(document.columns ?? []).filter(
                    (column) => column.tableId === table.id && column.scope !== 'logical',
                  )}
                />
              )}
              {action === 'enum' && (
                <>
                  {field('schema', '스키마')}
                  <NativeLabelFields
                    value={values.enumLabelsJSON ?? ''}
                    legacyDraft={values.enumValues !== undefined}
                    onChange={(raw) => change('enumLabelsJSON', raw)}
                    disabled={disabled || context.busy}
                  />
                  <NativeEnumOptionSummary
                    document={document}
                    id={values.id!}
                    name={values.name ?? ''}
                    schema={values.schema ?? ''}
                    text={values.enumLabelsJSON ?? ''}
                  />
                </>
              )}
              {action === 'foreignKey' && table && (
                <>
                  <NativeConstraintOptionFields
                    document={document}
                    kind="foreignKey"
                    values={values}
                    change={change}
                    disabled={disabled || context.busy}
                  />
                  {field('foreignMode', '입력 방식', [
                    { value: 'mapped', label: t('직접 컬럼 연결') },
                    { value: 'derived', label: t('PK에서 컬럼 자동 생성') },
                  ])}
                  <NativeEditorField
                    label="참조 테이블"
                    value={values.targetTableId ?? ''}
                    onChange={(value) => {
                      change('targetTableId', value);
                      change('targetColumnIds', '');
                      change('primaryKeyId', '');
                      change('generatedColumnIds', '');
                    }}
                    choices={[
                      { value: '', label: '—' },
                      ...(document.tables ?? [])
                        .filter((item) => item.scope !== 'logical')
                        .map((item) => ({ value: item.id, label: item.physical.name || item.id })),
                    ]}
                  />
                  {values.foreignMode === 'derived' ? (
                    <NativeEditorField
                      label="참조 키"
                      value={values.primaryKeyId ?? ''}
                      onChange={(value) => {
                        const key = document.keys?.find((item) => item.id === value);
                        change('primaryKeyId', value);
                        change(
                          'generatedColumnIds',
                          (key?.columnIds ?? []).map(() => crypto.randomUUID()).join('\n'),
                        );
                      }}
                      choices={[
                        { value: '', label: '—' },
                        ...(document.keys ?? [])
                          .filter(
                            (item) =>
                              item.tableId === values.targetTableId &&
                              item.kind === 'primary' &&
                              !item.deferrable &&
                              item.scope !== 'logical',
                          )
                          .map((key) => ({ value: key.id, label: key.name || key.id })),
                      ]}
                    />
                  ) : (
                    <>
                      <NativeOrderedColumns
                        value={values.columnIds ?? ''}
                        change={(value) => change('columnIds', value)}
                        document={document}
                        tableId={table.id}
                      />
                      <NativeOrderedColumns
                        value={values.targetColumnIds ?? ''}
                        change={(value) => change('targetColumnIds', value)}
                        document={document}
                        tableId={values.targetTableId ?? ''}
                        label="참조 컬럼 순서"
                      />
                      {field('onDelete', 'ON DELETE', actions(document))}
                      {field('onUpdate', 'ON UPDATE', actions(document))}
                    </>
                  )}
                </>
              )}
            </fieldset>
            {/* The outer submit is also guarded in the builder, including programmatic submission. */}
          </>
        );
      }}
    </NativeEditorForm>
  );
}
const actions = (document: NativeDesignDocument) =>
  ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].map((value) => ({
    value,
    label: value,
    disabled: document.database.kind === 'mysql' && value === 'SET DEFAULT',
  }));

export function nativeConstraintInitial(
  document: NativeDesignDocument,
  collection: NativeDeletionCollection,
  id: string,
): Record<string, string> {
  const item = document[collection]?.find((item) => item.id === id);
  if (!item) throw new Error('document.object-not-found');
  const result: Record<string, string> = {
    name: 'name' in item ? item.name : '',
    originalJSON: JSON.stringify(item),
    columnIds: '',
    expressionMode: 'preserve',
    ...nativeExpressionInputs(),
  };
  if (collection === 'keys') {
    const key = document.keys!.find((item) => item.id === id)!;
    result.keyKind = key.kind;
    result.columnIds = key.columnIds.join('\n');
    Object.assign(result, nativeConstraintOptionsInitial(key));
  }
  if (collection === 'indexes') {
    const index = document.indexes!.find((item) => item.id === id)!;
    result.unique = String(index.unique);
    result.direction = index.parts[0]?.direction ?? 'asc';
    result.columnIds = index.parts
      .filter((part) => part.expression.kind === 'column')
      .map((part) => (part.expression as { columnId: string }).columnId)
      .join('\n');
  }
  if (collection === 'checks')
    Object.assign(
      result,
      nativeExpressionInputs(document.checks!.find((item) => item.id === id)!.expression),
    );
  if (collection === 'enums') {
    const enumeration = document.enums!.find((item) => item.id === id)!;
    result.schema = enumeration.schema;
    result.enumLabelsJSON = serializeNativeLabels(enumeration.values);
  }
  if (collection === 'tableRelations') {
    const relation = document.tableRelations!.find((item) => item.id === id)!;
    result.name = relation.physical?.name ?? '';
    result.logicalName = relation.logical.name;
    result.logicalDescription = relation.logical.description ?? '';
    result.cardinality = relation.logical.cardinality;
    result.required = String(relation.logical.required);
    for (const side of ['sourceCardinality', 'targetCardinality'] as const) {
      const value = relation.logical[side];
      result[side] = value ? `${value.min}:${value.max}` : 'fallback';
    }
    result.sourceTableId = relation.sourceTableId;
    result.targetTableId = relation.targetTableId;
    result.physicalMode = relation.physical ? 'present' : 'none';
    result.mappingCount = String(relation.physical?.sourceColumnIds.length ?? 0);
    result.columnIds = relation.physical?.sourceColumnIds.join('\n') ?? '';
    result.targetColumnIds = relation.physical?.targetColumnIds.join('\n') ?? '';
    result.onDelete = relation.physical?.onDelete ?? 'NO ACTION';
    result.onUpdate = relation.physical?.onUpdate ?? 'NO ACTION';
    Object.assign(result, nativeConstraintOptionsInitial(relation));
  }
  return result;
}
export function nativeConstraintCommands(
  document: NativeDesignDocument,
  collection: NativeDeletionCollection,
  id: string,
  values: Record<string, string>,
  before: Record<string, string>,
): NativeWebCommand[] {
  const item = document[collection]?.find((item) => item.id === id);
  if (!item) throw new Error('document.object-not-found');
  const patch: Record<string, unknown> = {};
  const policy = nativeEditorPolicy(
    document,
    document.tables?.find(
      (table) =>
        table.id ===
        ('tableId' in item ? item.tableId : 'sourceTableId' in item ? item.sourceTableId : ''),
    ),
  );
  const changed = (key: string) => values[key] !== before[key];
  const requireFeature = (feature: Parameters<typeof policy.feature>[0]) => {
    const decision = policy.feature(feature);
    if (!decision.usable) throw new Error(decision.code ?? 'feature.not-implemented');
  };
  if (collection === 'tableRelations') {
    const logical: Record<string, unknown> = {};
    if (changed('logicalName')) logical.name = values.logicalName;
    if (changed('logicalDescription')) logical.description = values.logicalDescription;
    if (changed('cardinality')) logical.cardinality = values.cardinality;
    if (changed('required')) {
      if (!['true', 'false'].includes(values.required ?? '')) throw Error('native.input-invalid');
      logical.required = values.required === 'true';
    }
    for (const side of ['sourceCardinality', 'targetCardinality'] as const) {
      if (!changed(side)) continue;
      const [min, max] = (values[side] ?? '').split(':');
      if (!['0', '1'].includes(min ?? '') || !['1', 'many'].includes(max ?? ''))
        throw Error('relation.cardinality-invalid');
      logical[side] = { min: Number(min), max: max === 'many' ? 'many' : 1 };
    }
    if (Object.keys(logical).length) patch.logical = logical;
    for (const side of ['sourceTableId', 'targetTableId'] as const)
      if (changed(side)) {
        const table = document.tables?.find((table) => table.id === values[side]);
        if (!table) throw Error('foreign-key.table-not-found');
        patch[side] = values[side];
      }
    const physical: Record<string, unknown> = {};
    if (changed('name')) physical.name = values.name;
    for (const [field, input] of [
      ['sourceColumnIds', 'columnIds'],
      ['targetColumnIds', 'targetColumnIds'],
      ['onDelete', 'onDelete'],
      ['onUpdate', 'onUpdate'],
    ] as const)
      if (changed(input)) {
        requireFeature('foreignKey');
        physical[field] =
          input.endsWith('ColumnIds') || input === 'columnIds'
            ? list(values[input])
            : values[input];
      }
    const relation = document.tableRelations!.find((r) => r.id === id)!;
    if (changed('physicalMode') && values.physicalMode === 'none') patch.physical = null;
    else if (Object.keys(physical).length) {
      if (!relation.physical) throw Error('foreign-key.physical-key-required');
      const sources =
        (physical.sourceColumnIds as string[] | undefined) ?? relation.physical.sourceColumnIds;
      const targets =
        (physical.targetColumnIds as string[] | undefined) ?? relation.physical.targetColumnIds;
      if (
        !sources.length ||
        sources.length !== targets.length ||
        new Set(sources).size !== sources.length ||
        new Set(targets).size !== targets.length
      )
        throw Error('foreign-key.columns-invalid');
      if (
        sources.some(
          (id) =>
            !document.columns?.some(
              (column) =>
                column.id === id &&
                column.tableId === (values.sourceTableId ?? relation.sourceTableId) &&
                column.scope !== 'logical',
            ),
        ) ||
        targets.some(
          (id) =>
            !document.columns?.some(
              (column) =>
                column.id === id &&
                column.tableId === (values.targetTableId ?? relation.targetTableId) &&
                column.scope !== 'logical',
            ),
        )
      )
        throw Error('foreign-key.columns-invalid');
      patch.physical = physical;
    }
    const options = nativeConstraintOptionsPatch('foreignKey', values, before, relation);
    if (Object.keys(options).length) {
      requireFeature('foreignKey');
      if (options.deferrable) requireFeature('deferrableForeignKey');
      const decision = nativeConstraintOptionsDecision(
        document,
        'foreignKey',
        {
          ...relation,
          ...(relation.physical ? { physical: { ...relation.physical, ...physical } } : {}),
        },
        options,
      );
      if (!decision.allowed || !decision.usable)
        throw Error(decision.code ?? 'feature.not-implemented');
      Object.assign(patch, options);
    }
  } else {
    if (changed('name')) patch.name = values.name;
    if (collection === 'keys') {
      if (changed('columnIds') || changed('keyKind')) {
        const key = document.keys!.find((item) => item.id === id)!;
        const table = document.tables?.find((item) => item.id === key.tableId);
        if (!table) throw new Error('key.table-not-found');
        nativeKeyInput(
          document,
          table,
          values.keyKind === 'primary' ? 'primary' : 'unique',
          list(values.columnIds),
        );
      }
      if (changed('columnIds') || changed('keyKind'))
        requireFeature(values.keyKind === 'primary' ? 'primaryKey' : 'unique');
      if (
        (changed('columnIds') || changed('keyKind')) &&
        policy
          .keyColumns(values.keyKind === 'primary' ? 'primary' : 'unique')
          .some((item) => list(values.columnIds).includes(item.column.id) && !item.productUsable)
      )
        throw new Error('key.not-ready');
      if (changed('columnIds')) patch.columnIds = list(values.columnIds);
      if (changed('keyKind')) patch.kind = values.keyKind;
      const key = document.keys!.find((k) => k.id === id)!;
      const options = nativeConstraintOptionsPatch('key', values, before, key);
      if (Object.keys(options).length) {
        requireFeature(values.keyKind === 'primary' ? 'primaryKey' : 'unique');
        if (options.nullsNotDistinct) requireFeature('nullsNotDistinct');
        const decision = nativeConstraintOptionsDecision(
          document,
          'key',
          { ...key, ...patch } as typeof key,
          options,
        );
        if (!decision.allowed || !decision.usable)
          throw Error(decision.code ?? 'feature.not-implemented');
        Object.assign(patch, options);
      }
    } else if (collection === 'indexes') {
      if (changed('columnIds') || changed('direction') || changed('unique'))
        requireFeature('index');
      if (changed('unique')) patch.unique = values.unique === 'true';
      if (changed('columnIds')) {
        const index = document.indexes!.find((item) => item.id === id)!;
        if (
          index.parts.some(
            (part) => part.expression.kind !== 'column' || part.prefixLength !== undefined,
          )
        )
          throw new Error('native.index-parts-review-required');
        patch.parts = list(values.columnIds).map((columnId) => ({
          expression: { kind: 'column', columnId },
          direction: values.direction,
        }));
      } else if (changed('direction')) {
        patch.parts = document
          .indexes!.find((item) => item.id === id)!
          .parts.map((part) => ({ ...part, direction: values.direction }));
      }
    } else if (collection === 'checks' && values.expressionMode !== 'preserve') {
      requireFeature('check');
      patch.expression = nativeExpressionFromInputs(values);
    } else if (collection === 'enums') {
      const labelsChanged = changed('enumLabelsJSON') || changed('enumValues');
      const labels = labelsChanged
        ? nativeLabelsForCommand(
            values,
            before,
            'enumLabelsJSON',
            'enumValues',
            document.enums!.find((e) => e.id === id)!.values,
          )
        : undefined;
      if (changed('schema') || labelsChanged) requireFeature('enumType');
      if (labelsChanged) {
        const current = document.enums!.find((e) => e.id === id)!;
        const decision = nativeEnumOptionsDecision(
          document,
          id,
          values.name ?? current.name,
          values.schema ?? current.schema,
          serializeNativeLabels(labels!),
        );
        if (!decision.allowed || !decision.usable)
          throw Error(decision.code ?? 'feature.not-implemented');
      }
      if (changed('schema')) patch.schema = values.schema;
      if (labels) patch.values = labels;
    }
  }
  if (!Object.keys(patch).length) return [];
  const type = (
    {
      keys: 'patch_key',
      indexes: 'patch_index',
      checks: 'patch_check',
      enums: 'patch_enum',
      tableRelations: 'patch_foreign_key',
    } as Partial<Record<NativeDeletionCollection, string>>
  )[collection];
  if (!type) throw new Error('native.command-invalid');
  return [nativeEditorCommandSchema.parse({ type, id, patch })];
}

function NativeRelationMappingFields({
  document,
  id,
  values,
  change,
  disabled,
}: {
  document: NativeDesignDocument;
  id: string;
  values: Record<string, string>;
  change: (key: string, value: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const relation = document.tableRelations!.find((item) => item.id === id)!;
  const physical = values.physicalMode !== 'none' && !!relation.physical;
  const supported = (patch: Record<string, unknown>) =>
    nativeEditorCommandSchema.safeParse({ type: 'patch_foreign_key', id, patch }).success;
  const sources = list(values.columnIds),
    targets = list(values.targetColumnIds);
  const requestedCount = Number(values.mappingCount ?? '0');
  const maximum = Math.max(
    sources.length,
    targets.length,
    Math.min(
      (document.columns ?? []).filter(
        (column) =>
          column.tableId === (values.sourceTableId ?? relation.sourceTableId) &&
          column.scope !== 'logical',
      ).length,
      (document.columns ?? []).filter(
        (column) =>
          column.tableId === (values.targetTableId ?? relation.targetTableId) &&
          column.scope !== 'logical',
      ).length,
    ),
  );
  const count = Math.min(
    maximum,
    Math.max(
      sources.length,
      targets.length,
      Number.isSafeInteger(requestedCount) && requestedCount >= 0 ? requestedCount : 0,
    ),
  );
  function pair(index: number, side: 'columnIds' | 'targetColumnIds', value: string) {
    const ids = side === 'columnIds' ? sources : targets;
    change(
      side,
      Array.from({ length: count }, (_, at) => (at === index ? value : (ids[at] ?? ''))).join('\n'),
    );
  }
  return (
    <>
      {(['targetTableId', 'sourceTableId'] as const).map((side) => (
        <NativeEditorField
          key={side}
          label={side === 'targetTableId' ? '출발 테이블 (PK)' : '대상 테이블 (FK)'}
          value={values[side] ?? relation[side]}
          disabled={disabled || !supported({ [side]: relation[side] })}
          choices={(document.tables ?? [])
            .filter((table) => !physical || table.scope !== 'logical')
            .map((table) => ({
              value: table.id,
              label: `${document.domains.find((domain) => domain.id === table.domainId)?.name ?? t('미지정')} / ${table.physical.name || table.logical.name}`,
            }))}
          onChange={(value) => {
            change(side, value);
            if (physical) {
              change('columnIds', '');
              change('targetColumnIds', '');
            }
          }}
        />
      ))}
      {!supported({ sourceTableId: relation.sourceTableId }) && (
        <p className="panel-note">
          {t('현재 설계 형식에서는 관계의 테이블 변경을 지원하지 않습니다.')}
        </p>
      )}
      {physical ? (
        <>
          <Button
            disabled={disabled || !supported({ physical: null })}
            onClick={() => change('physicalMode', 'none')}
          >
            {t('FK 정의 제거')}
          </Button>
          {!supported({ physical: null }) && (
            <p className="panel-note">{t('현재 설계 형식에서는 물리 FK만 제거할 수 없습니다.')}</p>
          )}
          <p className="panel-note">
            {t('출발 PK / UNIQUE 컬럼 → 대상 FK 컬럼 순서로 대응합니다.')}
          </p>
          {Array.from({ length: count }, (_, index) => (
            <div className="table-mapping" key={index}>
              <span>{index + 1}</span>
              {(['targetColumnIds', 'columnIds'] as const).map((side) => (
                <NativeEditorField
                  key={side}
                  label={`${side === 'columnIds' ? 'FK' : 'PK / UNIQUE'} ${t('컬럼')} ${index + 1}`}
                  value={(side === 'columnIds' ? sources : targets)[index] ?? ''}
                  disabled={disabled}
                  choices={[
                    { value: '', label: t('선택') },
                    ...(document.columns ?? [])
                      .filter(
                        (column) =>
                          column.tableId ===
                            (side === 'columnIds'
                              ? (values.sourceTableId ?? relation.sourceTableId)
                              : (values.targetTableId ?? relation.targetTableId)) &&
                          column.scope !== 'logical',
                      )
                      .map((column) => ({
                        value: column.id,
                        label: column.physical.name || column.logical.name,
                      })),
                  ]}
                  onChange={(value) => pair(index, side, value)}
                />
              ))}
              <IconButton
                aria-label={t('매핑 {x0} 삭제', { x0: index + 1 })}
                disabled={disabled}
                onClick={() => {
                  change('columnIds', sources.filter((_, at) => at !== index).join('\n'));
                  change('targetColumnIds', targets.filter((_, at) => at !== index).join('\n'));
                  change('mappingCount', String(count - 1));
                }}
              >
                ×
              </IconButton>
            </div>
          ))}
          <Button
            disabled={disabled || count >= maximum}
            onClick={() => {
              change('mappingCount', String(count + 1));
            }}
          >
            {t('+ 컬럼 매핑')}
          </Button>
          {(sources.length !== targets.length ||
            !sources.length ||
            sources.some((id) => !id) ||
            targets.some((id) => !id)) && (
            <p role="status" className="field-help">
              {t('PK / UNIQUE와 FK 컬럼을 같은 수로 선택하세요.')}
            </p>
          )}
        </>
      ) : (
        <p>{t('물리 FK 없음')}</p>
      )}
    </>
  );
}

export function NativeConstraintForm({
  context,
  document,
  collection,
  id,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  collection: NativeDeletionCollection;
  id: string;
}) {
  const { t } = useI18n();
  const item = document[collection]?.find((item) => item.id === id)!;
  const tableId =
    'tableId' in item ? item.tableId : 'sourceTableId' in item ? item.sourceTableId : '';
  const policy = nativeEditorPolicy(
    document,
    document.tables?.find((table) => table.id === tableId),
  );
  const feature =
    collection === 'keys'
      ? 'kind' in item && item.kind === 'primary'
        ? 'primaryKey'
        : 'unique'
      : collection === 'enums'
        ? 'enumType'
        : collection === 'tableRelations'
          ? 'foreignKey'
          : collection === 'indexes'
            ? 'index'
            : 'check';
  const disabled = !policy.feature(feature).usable;
  return (
    <NativeEditorForm
      context={context}
      draftKey={`constraint:${collection}:${id}`}
      title={t('기존 객체 수정')}
      initial={nativeConstraintInitial(document, collection, id)}
      disabled={(values) =>
        collection === 'tableRelations' &&
        values.physicalMode === 'present' &&
        Number(values.mappingCount ?? '0') >
          Math.min(list(values.columnIds).length, list(values.targetColumnIds).length)
      }
      build={(values, before) => {
        try {
          return nativeConstraintCommands(document, collection, id, values, before);
        } catch (error) {
          throw Error(nativeEditorConditionText(nativeEditorErrorCode(error)));
        }
      }}
    >
      {(values, change) => {
        const relationValues =
          collection === 'tableRelations'
            ? { ...nativeConstraintInitial(document, collection, id), ...values }
            : values;
        const field = (
          key: string,
          label: string,
          blocked = disabled,
          choices?: Parameters<typeof NativeEditorField>[0]['choices'],
          multiline = false,
        ) => (
          <NativeEditorField
            label={label}
            value={relationValues[key] ?? ''}
            disabled={blocked}
            onChange={(value) => change(key, value)}
            {...(choices ? { choices } : {})}
            multiline={multiline}
          />
        );
        return (
          <>
            {collection !== 'tableRelations' && field('name', '이름', false)}
            <AnimatedDetails>
              <summary>{t('원본 속성')}</summary>
              <pre>{JSON.stringify(item, null, 2)}</pre>
            </AnimatedDetails>
            {disabled && (
              <p>
                {t('미구현 또는 실행 검증 미완료')} ({policy.feature(feature).code})
              </p>
            )}
            {collection === 'keys' &&
              field(
                'keyKind',
                '키 종류',
                disabled,
                ['primary', 'unique'].map((value) => ({ value, label: value })),
              )}
            {collection === 'keys' && (
              <NativeConstraintOptionFields
                document={document}
                kind="key"
                keyKind={values.keyKind ?? 'primary'}
                values={values}
                change={change}
                current={document.keys!.find((k) => k.id === id)!}
                disabled={disabled || context.busy}
              />
            )}
            {['keys', 'indexes'].includes(collection) && (
              <NativeOrderedColumns
                value={values.columnIds ?? ''}
                change={(value) => change('columnIds', value)}
                document={document}
                tableId={tableId}
                keyKind={
                  collection === 'keys'
                    ? values.keyKind === 'primary'
                      ? 'primary'
                      : 'unique'
                    : collection === 'indexes' && values.unique === 'true'
                      ? 'unique'
                      : undefined
                }
                disabled={
                  disabled ||
                  (collection === 'indexes' &&
                    'parts' in item &&
                    item.parts.some(
                      (part) =>
                        part.expression.kind !== 'column' || part.prefixLength !== undefined,
                    ))
                }
              />
            )}
            {collection === 'indexes' && (
              <>
                {field('unique', 'UNIQUE', disabled, bool)}
                {field(
                  'direction',
                  '순서',
                  disabled,
                  ['asc', 'desc'].map((value) => ({ value, label: value })),
                )}
              </>
            )}
            {collection === 'checks' && 'expression' in item && (
              <>
                <p>{nativeExpressionDisplay(item.expression, document)}</p>
                {field('expressionMode', '식', disabled, [
                  { value: 'preserve', label: t('기존 식 유지') },
                  { value: 'compare', label: t('구조화 식으로 변경') },
                ])}
                {values.expressionMode === 'compare' && (
                  <NativeExpressionFields
                    values={values}
                    change={change}
                    disabled={disabled}
                    columns={(document.columns ?? []).filter(
                      (column) => column.tableId === tableId && column.scope !== 'logical',
                    )}
                  />
                )}
              </>
            )}
            {collection === 'enums' && (
              <>
                {field('schema', '스키마')}
                <NativeLabelFields
                  value={values.enumLabelsJSON ?? ''}
                  legacyDraft={values.enumValues !== undefined}
                  onChange={(raw) => change('enumLabelsJSON', raw)}
                  disabled={disabled || context.busy}
                />
                <NativeEnumOptionSummary
                  document={document}
                  id={id}
                  name={values.name ?? ''}
                  schema={values.schema ?? ''}
                  text={values.enumLabelsJSON ?? ''}
                />
              </>
            )}
            {collection === 'tableRelations' && 'targetTableId' in item && (
              <>
                {field('logicalName', '관계명', false)}
                {field('logicalDescription', '관계 설명', false, undefined, true)}
                {relationValues.sourceCardinality === 'fallback' &&
                  relationValues.targetCardinality === 'fallback' &&
                  field('cardinality', '카디널리티', false, [
                    { value: 'one-to-one', label: '1 : 1' },
                    { value: 'one-to-many', label: '1 : N' },
                    { value: 'many-to-many', label: 'N : M' },
                  ])}
                {(['targetCardinality', 'sourceCardinality'] as const).map((side) => {
                  const fallback =
                    side === 'sourceCardinality'
                      ? { min: 0, max: relationValues.cardinality === 'one-to-one' ? 1 : 'many' }
                      : {
                          min: relationValues.required === 'true' ? 1 : 0,
                          max: relationValues.cardinality === 'many-to-many' ? 'many' : 1,
                        };
                  return field(
                    side,
                    side === 'targetCardinality' ? '출발 끝점 (PK)' : '대상 끝점 (FK)',
                    false,
                    [
                      ...(values[side] === 'fallback'
                        ? [
                            {
                              value: 'fallback',
                              label: `${t('기본값')} · ${fallback.min}..${fallback.max === 'many' ? 'N' : '1'}`,
                            },
                          ]
                        : []),
                      { value: '0:1', label: '0..1' },
                      { value: '1:1', label: '1' },
                      { value: '0:many', label: '0..N' },
                      { value: '1:many', label: '1..N' },
                    ],
                  );
                })}
                {relationValues.targetCardinality === 'fallback' && (
                  <label className="table-check">
                    <Checkbox
                      checked={relationValues.required === 'true'}
                      aria-label={t('관계 필수')}
                      onChange={(event) => change('required', String(event.target.checked))}
                    />
                    {t('관계 필수')}
                  </label>
                )}
                <AnimatedDetails className="table-relation-advanced">
                  <summary>{t('고급 설정 · 테이블, FK 매핑')}</summary>
                  <NativeRelationMappingFields
                    document={document}
                    id={id}
                    values={relationValues}
                    change={change}
                    disabled={disabled || context.busy}
                  />
                </AnimatedDetails>
                {relationValues.physicalMode !== 'none' && (
                  <>
                    {field('name', 'FK 이름', false)}
                    <NativeConstraintOptionFields
                      document={document}
                      kind="foreignKey"
                      values={relationValues}
                      change={change}
                      current={document.tableRelations!.find((r) => r.id === id)!}
                      disabled={disabled || context.busy}
                    />
                    {field('onDelete', 'ON DELETE', disabled, actions(document))}
                    {field('onUpdate', 'ON UPDATE', disabled, actions(document))}
                  </>
                )}
              </>
            )}
          </>
        );
      }}
    </NativeEditorForm>
  );
}

export function NativeDeleteForm({
  context,
  document,
  collection,
  id,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  collection: NativeDeletionCollection;
  id: string;
}) {
  const { t } = useI18n();
  return (
    <NativeEditorForm
      context={context}
      title={t('객체 삭제')}
      draftKey={`delete:${collection}:${id}`}
      initial={{
        cascade: 'false',
        confirm: 'false',
        originalJSON: JSON.stringify(document[collection]?.find((item) => item.id === id)),
      }}
      build={(values) => {
        if (values.confirm !== 'true') throw new Error('deletion.review-required');
        const plan = planNativeDeletion(document, [{ collection, id }], {
          cascadeGeneratedColumns: values.cascade === 'true',
        });
        if (plan.blockers.length) throw new Error('deletion.blocked');
        return [
          {
            type: 'delete_objects',
            targets: [{ collection, id }],
            cascadeGeneratedColumns: values.cascade === 'true',
          },
        ];
      }}
    >
      {(values, change) => {
        const plan = planNativeDeletion(document, [{ collection, id }], {
          cascadeGeneratedColumns: values.cascade === 'true',
        });
        return (
          <>
            <NativeEditorField
              label="생성 컬럼 연쇄 삭제"
              value={values.cascade ?? 'false'}
              onChange={(value) => {
                change('cascade', value);
                change('confirm', 'false');
              }}
              choices={bool}
            />
            <h4>{t('삭제 영향')}</h4>
            <ul>
              {plan.removed.map((item) => (
                <li key={`${item.collection}:${item.id}`}>
                  {item.collection}: {item.id}
                </li>
              ))}
              {plan.logicalOnlyRelationIds.map((id) => (
                <li key={id}>{id} → logical</li>
              ))}
            </ul>
            {!!plan.blockers.length && (
              <>
                <h4>{t('삭제 차단 항목')}</h4>
                <ul>
                  {plan.blockers.map((item, index) => (
                    <li key={index}>
                      {item.code}: {item.objectId} ({item.referencedIds.join(', ')})
                    </li>
                  ))}
                </ul>
              </>
            )}
            <NativeEditorField
              label="삭제 영향을 확인했습니다."
              value={values.confirm ?? 'false'}
              onChange={(value) => change('confirm', value)}
              choices={bool}
              disabled={!!plan.blockers.length}
            />
          </>
        );
      }}
    </NativeEditorForm>
  );
}

export function NativeStructureEditor({
  context,
  document,
  table,
  initialSelection,
  focused = false,
  initialValues,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table?: NativeTable;
  initialSelection?: { action: NativeStructureAction | 'patch' | 'delete'; target: string };
  /** A contextual inspector action; keeps the same durable form and command policy. */
  focused?: boolean;
  initialValues?: Record<string, string>;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<NativeStructureAction | 'patch' | 'delete'>(
    initialSelection?.action ?? 'table',
  );
  const [target, setTarget] = useState(initialSelection?.target ?? '');
  const objects = (
    ['tables', 'columns', 'keys', 'indexes', 'checks', 'enums', 'tableRelations'] as const
  ).flatMap((collection) =>
    (document[collection] ?? [])
      .filter(
        (item) =>
          collection === 'enums' ||
          !table ||
          ('tableId' in item
            ? item.tableId === table.id
            : 'sourceTableId' in item
              ? item.sourceTableId === table.id || item.targetTableId === table.id
              : item.id === table.id),
      )
      .map((item) => ({
        collection,
        id: item.id,
        label:
          'physical' in item && item.physical
            ? item.physical.name
            : 'name' in item
              ? item.name
              : item.id,
      })),
  );
  const selected = objects.find((item) => JSON.stringify([item.collection, item.id]) === target);
  const create = !['patch', 'delete'].includes(action);
  const mountingKey = `${context.userId}:${context.snapshot.project.id}:${context.snapshot.project.version}:${context.snapshot.sequence}:${context.snapshot.project.databaseRevision}`;
  return (
    <PanelSection
      className="native-property-editor"
      title={t(
        focused
          ? (
              {
                table: '새 테이블 만들기',
                column: '컬럼 추가',
                key: '키 · PK / UNIQUE',
                index: '인덱스',
                check: 'CHECK',
                enum: 'ENUM',
                foreignKey: '테이블 관계',
                patch: '속성 편집',
                delete: '삭제 영향 확인',
              } as const
            )[action]
          : '구조 편집',
      )}
      defaultOpen={!!initialSelection}
    >
      {!focused && (
        <NativeEditorField
          label="구조 편집"
          value={action}
          onChange={(value) => setAction(value as typeof action)}
          choices={(
            [
              ['table', '새 테이블'],
              ['column', '새 컬럼'],
              ['key', '새 키'],
              ['index', '새 인덱스'],
              ['check', '새 CHECK'],
              ['enum', '새 ENUM'],
              ['foreignKey', '새 외래 키'],
              ['patch', '기존 객체 수정'],
              ['delete', '객체 삭제'],
            ] as const
          ).map(([value, label]) => ({
            value,
            label: t(label),
            disabled:
              (!table && !['table', 'enum', 'delete', 'patch'].includes(value)) ||
              (value === 'enum' &&
                !nativeEditorPolicy(document, table).feature('enumType').supported),
          }))}
          disabled={context.busy}
        />
      )}
      {create ? (
        <NativeCreateForm
          key={`${mountingKey}:${action}:${table?.id ?? ''}`}
          context={context}
          document={document}
          {...(table ? { table } : {})}
          action={action as NativeStructureAction}
          {...(initialValues ? { initialValues } : {})}
        />
      ) : (
        <>
          {!focused && (
            <NativeEditorField
              label="대상"
              value={target}
              onChange={setTarget}
              choices={[
                { value: '', label: '—' },
                ...objects
                  .filter(
                    (item) =>
                      action === 'delete' || !['tables', 'columns'].includes(item.collection),
                  )
                  .map((item) => ({
                    value: JSON.stringify([item.collection, item.id]),
                    label: `${item.collection}: ${item.label || item.id}`,
                  })),
              ]}
              disabled={context.busy}
            />
          )}
          {selected &&
            (action === 'delete' ? (
              <NativeDeleteForm
                key={`${mountingKey}:${target}`}
                context={context}
                document={document}
                collection={selected.collection}
                id={selected.id}
              />
            ) : (
              <NativeConstraintForm
                key={`${mountingKey}:${target}`}
                context={context}
                document={document}
                collection={selected.collection}
                id={selected.id}
              />
            ))}
        </>
      )}
      {table && !focused && (
        <NativeAdvancedEditor
          key={`${context.userId}:${context.snapshot.project.id}:${table.id}`}
          context={context}
          document={document}
          table={table}
        />
      )}
    </PanelSection>
  );
}

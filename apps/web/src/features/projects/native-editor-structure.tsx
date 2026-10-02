import { useState } from 'react';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import {
  createNativeTable,
  createNativeColumn,
  nativeExpressionDisplay,
  planNativeDeletion,
  type NativeDesignDocument,
  type NativeTable,
  type NativeDeletionCollection,
} from '@ezerd/model';
import { Button } from '../../components/ui/index.js';
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

registerTranslations({
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
                {!item.productUsable && ` · ${t('제품 검증 미완료')}`} ({item.code})
                {item.eligibility.estimatedBytes !== undefined &&
                  ` · ${item.eligibility.estimatedBytes} bytes`}
                {item.eligibility.conditions.length > 0 &&
                  ` · ${item.eligibility.conditions.join(', ')}`}
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
      value: { id, name, schema: values.schema, values: list(values.enumValues) },
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
      },
    };
  return [nativeEditorCommandSchema.parse(command)];
}

function NativeCreateForm({
  context,
  document,
  table,
  action,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table?: NativeTable;
  action: NativeStructureAction;
}) {
  const { t } = useI18n();
  const policy = nativeEditorPolicy(document, table);
  // IDs belong to the durable input; retries do not regenerate objects.
  const [id] = useState(() => crypto.randomUUID());
  const initial = {
    id,
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
    enumValues: '',
    targetTableId: '',
    targetColumnIds: '',
    primaryKeyId: '',
    generatedColumnIds: '',
    foreignMode: 'mapped',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    ...nativeExpressionInputs(),
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
                    '논리 초안은 저장할 수 있습니다. 신규 물리 기능은 검증 완료 후 사용할 수 있습니다.',
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
                  {field('enumValues', '값 목록 (한 줄에 하나)', undefined, true)}
                </>
              )}
              {action === 'foreignKey' && table && (
                <>
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
    result.enumValues = enumeration.values.join('\n');
  }
  if (collection === 'tableRelations') {
    const relation = document.tableRelations!.find((item) => item.id === id)!;
    result.name = relation.physical?.name ?? '';
    result.logicalName = relation.logical.name;
    result.columnIds = relation.physical?.sourceColumnIds.join('\n') ?? '';
    result.targetColumnIds = relation.physical?.targetColumnIds.join('\n') ?? '';
    result.onDelete = relation.physical?.onDelete ?? 'NO ACTION';
    result.onUpdate = relation.physical?.onUpdate ?? 'NO ACTION';
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
    if (changed('logicalName')) patch.logical = { name: values.logicalName };
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
    if (Object.keys(physical).length) patch.physical = physical;
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
      if (changed('schema') || changed('enumValues')) requireFeature('enumType');
      if (changed('schema')) patch.schema = values.schema;
      if (changed('enumValues')) patch.values = list(values.enumValues);
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

function NativeConstraintForm({
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
      build={(values, before) => nativeConstraintCommands(document, collection, id, values, before)}
    >
      {(values, change) => {
        const field = (
          key: string,
          label: string,
          blocked = disabled,
          choices?: Parameters<typeof NativeEditorField>[0]['choices'],
          multiline = false,
        ) => (
          <NativeEditorField
            label={label}
            value={values[key] ?? ''}
            disabled={blocked}
            onChange={(value) => change(key, value)}
            {...(choices ? { choices } : {})}
            multiline={multiline}
          />
        );
        return (
          <>
            {field('name', '이름', false)}
            <details>
              <summary>{t('원본 속성')}</summary>
              <pre>{JSON.stringify(item, null, 2)}</pre>
            </details>
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
            {['keys', 'indexes', 'tableRelations'].includes(collection) && (
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
                {field('enumValues', '값 목록 (한 줄에 하나)', disabled, undefined, true)}
              </>
            )}
            {collection === 'tableRelations' && 'targetTableId' in item && (
              <>
                {field('logicalName', '논리 이름', false)}
                <NativeOrderedColumns
                  value={values.targetColumnIds ?? ''}
                  change={(value) => change('targetColumnIds', value)}
                  document={document}
                  tableId={item.targetTableId}
                  disabled={disabled}
                  label="참조 컬럼 순서"
                />
                {field('onDelete', 'ON DELETE', disabled, actions(document))}
                {field('onUpdate', 'ON UPDATE', disabled, actions(document))}
              </>
            )}
          </>
        );
      }}
    </NativeEditorForm>
  );
}

function NativeDeleteForm({
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
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table?: NativeTable;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<NativeStructureAction | 'patch' | 'delete'>('table');
  const [target, setTarget] = useState('');
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
    <details className="native-property-editor">
      <summary>{t('구조 편집')}</summary>
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
          disabled: !table && !['table', 'enum', 'delete', 'patch'].includes(value),
        }))}
        disabled={context.busy}
      />
      {create ? (
        <NativeCreateForm
          key={`${mountingKey}:${action}:${table?.id ?? ''}`}
          context={context}
          document={document}
          {...(table ? { table } : {})}
          action={action as NativeStructureAction}
        />
      ) : (
        <>
          <NativeEditorField
            label="대상"
            value={target}
            onChange={setTarget}
            choices={[
              { value: '', label: '—' },
              ...objects
                .filter(
                  (item) => action === 'delete' || !['tables', 'columns'].includes(item.collection),
                )
                .map((item) => ({
                  value: JSON.stringify([item.collection, item.id]),
                  label: `${item.collection}: ${item.label || item.id}`,
                })),
            ]}
            disabled={context.busy}
          />
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
      {table && (
        <NativeAdvancedEditor
          key={`${context.userId}:${context.snapshot.project.id}:${table.id}`}
          context={context}
          document={document}
          table={table}
        />
      )}
    </details>
  );
}

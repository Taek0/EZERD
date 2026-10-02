import { useState } from 'react';
import type { NativeDesignDocument, NativeTable, NativeIndex } from '@ezerd/model';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { nativeDurableId } from './native-durable-queue.js';
import {
  NativeEditorForm,
  NativeEditorField,
  type NativeEditorContext,
} from './native-editor-form.js';
import { NativeExpressionTreeEditor } from './native-expression-tree.js';
import { NativeIndexOptionsEditor } from './native-index-options.js';
import {
  readNativeIndexDraft,
  nativeIndexDraft,
  nativeIndexCandidate,
  nativeExpressionInitial,
  nativeExpressionCandidate,
  nativeAdvancedCommands,
  nativeAdvancedExpressionFacts,
  nativeAdvancedOriginalLabel,
  nativeAdvancedSelectionValid,
  nativeIndexOptionProbe,
  type NativeExpressionTarget,
  type NativeAdvancedCandidate,
} from './native-advanced-policy.js';
import { nativeAstSeed, type NativeAstDraft } from './native-expression-tree-policy.js';

registerTranslations({
  '고급 인덱스·식 편집': 'Advanced index and expression editing',
  '고급 편집 대상': 'Advanced editing target',
  '새 고급 인덱스': 'New advanced index',
  '새 복합 CHECK': 'New compound CHECK',
  '기본값 식': 'Default expression',
  '생성 식': 'Generated expression',
  '인덱스 키 식': 'Index key expression',
  '인덱스 키 추가': 'Add index key',
  '접두 길이': 'Prefix length',
  정렬: 'Sort direction',
  '고유 인덱스': 'Unique index',
  '물리 이름': 'Physical name',
  '원문 보존': 'Preserve original',
  '구조화 식으로 명시 교체': 'Explicitly replace with a structured expression',
  '생성 식 저장 방식': 'Generated expression storage',
  '식 적용 방식': 'Expression action',
  '기존 기본값·생성 규칙을 제거하거나 덮어쓰는 변경은 명시 선택한 필드에만 적용됩니다.':
    'Removal or replacement of an existing default or generation applies only to the explicitly selected field.',
  '식 제거': 'Remove expression',
  '현재 원문': 'Current original',
  '정책에서 허용': 'Allowed by policy',
  '현재 저장 경로 검증 미완료': 'Verification of the current saving path is incomplete',
  '현재 원문을 유지합니다.': 'The current original is preserved.',
  '입력 또는 조합을 지원하지 않음': 'Input or combination is unsupported',
  '고급 초안을 보존했습니다. 입력 초기화 또는 보관 다시 시도를 사용하세요.':
    'The advanced draft was preserved. Reset input or retry preserving it.',
  '고급 편집은 현재 DB의 물리 테이블에서만 가능합니다.':
    'Advanced editing is available only for a physical table in the current database.',
  '현재 설계에서 복구할 편집 대상을 찾을 수 없습니다. 보관된 초안은 그대로 유지됩니다.':
    'The recovery target was not found in the current design. The archived draft is retained.',
  범위: 'Scope',
});
function NativeAdvancedStatus({ status }: { status: NativeAdvancedCandidate }) {
  const { t } = useI18n();
  return (
    <div role="status">
      <p>
        {t(
          status.preserved
            ? '현재 원문을 유지합니다.'
            : status.allowed
              ? '정책에서 허용'
              : '입력 또는 조합을 지원하지 않음',
        )}
        {!status.preserved && !status.usable && ` · ${t('현재 저장 경로 검증 미완료')}`}{' '}
        {status.code && `(${status.code})`}
      </p>
      {status.issues.some((i) => i.severity === 'error') && (
        <details>
          <summary>{t('진단')}</summary>
          <ul>
            {status.issues
              .filter((i) => i.severity === 'error')
              .map((issue, i) => (
                <li key={i}>
                  {issue.objectId ?? '—'} · {issue.path} · {issue.code}
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}
export function NativeAdvancedIndexForm({
  context,
  document,
  table,
  index,
  readOnly = false,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table: NativeTable;
  index?: NativeIndex;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [newId] = useState(nativeDurableId);
  const id = index?.id ?? newId;
  const initial = {
    id,
    indexDraftJSON: JSON.stringify(nativeIndexDraft(document, table, index)),
    originalJSON: JSON.stringify(index ?? null),
  };
  function evaluate(
    values: Record<string, string>,
    before: Record<string, string> = initial,
  ): NativeAdvancedCandidate {
    try {
      const persistedId = values.id ?? '';
      if (
        values.id !== before.id ||
        (index && persistedId !== index.id) ||
        values.originalJSON !== before.originalJSON ||
        JSON.stringify(document.indexes?.find((i) => i.id === persistedId) ?? null) !==
          before.originalJSON
      )
        throw Error('native.advanced-source-changed');
      return nativeIndexCandidate(
        document,
        table,
        persistedId,
        readNativeIndexDraft(values.indexDraftJSON ?? ''),
        !!index,
      );
    } catch (error) {
      return {
        allowed: false,
        usable: false,
        preserved: false,
        issues: [],
        code: error instanceof Error ? error.message : 'index.draft-invalid',
      };
    }
  }
  return (
    <fieldset disabled={readOnly || context.busy}>
      <NativeEditorForm
        context={context}
        draftKey={`advanced:index:${table.id}:${index?.id ?? 'new'}`}
        title={t(index ? '인덱스 키 식' : '새 고급 인덱스')}
        initial={initial}
        disabled={(values) => readOnly || !evaluate(values).usable}
        build={(values, before) => nativeAdvancedCommands(evaluate(values, before), readOnly)}
      >
        {(values, change) => {
          let draft: ReturnType<typeof readNativeIndexDraft>;
          try {
            draft = readNativeIndexDraft(values.indexDraftJSON ?? '');
          } catch (error) {
            return (
              <p role="alert">
                {t('고급 초안을 보존했습니다. 입력 초기화 또는 보관 다시 시도를 사용하세요.')} (
                {error instanceof Error ? error.message : 'index.draft-invalid'})
              </p>
            );
          }
          const update = (next: typeof draft) => {
            if (!readOnly && !context.busy) change('indexDraftJSON', JSON.stringify(next));
          };
          const replacePart = (position: number, part: (typeof draft.parts)[number]) =>
            update({ ...draft, parts: draft.parts.map((old, i) => (i === position ? part : old)) });
          return (
            <>
              <NativeEditorField
                label="물리 이름"
                value={draft.name}
                onChange={(name) => update({ ...draft, name })}
                disabled={readOnly || context.busy}
              />
              <NativeEditorField
                label="고유 인덱스"
                value={draft.unique}
                onChange={(unique) => update({ ...draft, unique })}
                disabled={readOnly || context.busy}
                choices={[
                  { value: 'false', label: 'false' },
                  { value: 'true', label: 'true' },
                ]}
              />
              {draft.parts.map((part, position) => (
                <fieldset key={position} disabled={readOnly || context.busy}>
                  <legend>
                    {t('인덱스 키 식')} {position + 1}
                  </legend>
                  <NativeExpressionTreeEditor
                    database={document.database}
                    facts={nativeAdvancedExpressionFacts(document, table, 'index')}
                    value={JSON.stringify(part.expression)}
                    onChange={(text) =>
                      replacePart(position, {
                        ...part,
                        expression: JSON.parse(text) as NativeAstDraft,
                      })
                    }
                    disabled={readOnly || context.busy}
                  />
                  <NativeEditorField
                    label="정렬"
                    value={part.direction}
                    onChange={(direction) =>
                      replacePart(position, {
                        ...part,
                        direction: direction as typeof part.direction,
                      })
                    }
                    choices={['asc', 'desc'].map((direction) => ({
                      value: direction,
                      label: direction.toUpperCase(),
                      disabled:
                        direction !== part.direction &&
                        !nativeIndexOptionProbe(
                          document,
                          table,
                          {
                            ...draft,
                            parts: draft.parts.map((p, i) =>
                              i === position
                                ? { ...p, direction: direction as typeof p.direction }
                                : p,
                            ),
                          },
                          index?.id,
                        ).allowed,
                    }))}
                    disabled={readOnly || context.busy}
                  />
                  {document.database.kind === 'mysql' && (
                    <NativeEditorField
                      label="접두 길이"
                      value={part.prefix}
                      onChange={(prefix) => replacePart(position, { ...part, prefix })}
                      disabled={
                        readOnly ||
                        context.busy ||
                        (part.prefix === '' &&
                          (draft.options.database !== 'mysql' ||
                            draft.options.kind !== 'btree' ||
                            part.expression.kind !== 'column'))
                      }
                    />
                  )}
                  <Button
                    disabled={readOnly || context.busy || position === 0}
                    onClick={() => {
                      const parts = [...draft.parts];
                      [parts[position - 1], parts[position]] = [
                        parts[position]!,
                        parts[position - 1]!,
                      ];
                      update({ ...draft, parts });
                    }}
                  >
                    {t('위로')}
                  </Button>
                  <Button
                    disabled={readOnly || context.busy || position === draft.parts.length - 1}
                    onClick={() => {
                      const parts = [...draft.parts];
                      [parts[position + 1], parts[position]] = [
                        parts[position]!,
                        parts[position + 1]!,
                      ];
                      update({ ...draft, parts });
                    }}
                  >
                    {t('아래로')}
                  </Button>
                  <Button
                    disabled={readOnly || context.busy}
                    onClick={() =>
                      update({ ...draft, parts: draft.parts.filter((_, i) => position !== i) })
                    }
                  >
                    {t('제거')}
                  </Button>
                </fieldset>
              ))}
              <Button
                disabled={readOnly || context.busy || draft.parts.length >= 32}
                onClick={() =>
                  update({
                    ...draft,
                    parts: [
                      ...draft.parts,
                      {
                        expression: nativeAstSeed(
                          'column',
                          document.database,
                          (document.columns ?? []).find(
                            (c) => c.tableId === table.id && c.scope !== 'logical',
                          )?.id ?? '',
                        ),
                        direction: 'asc',
                        prefix: '',
                      },
                    ],
                  })
                }
              >
                {t('인덱스 키 추가')}
              </Button>
              <NativeIndexOptionsEditor
                document={document}
                table={table}
                value={draft}
                onChange={update}
                indexId={index?.id}
                disabled={readOnly || context.busy}
              />
              <NativeAdvancedStatus status={evaluate(values)} />
            </>
          );
        }}
      </NativeEditorForm>
    </fieldset>
  );
}
export function NativeAdvancedExpressionForm({
  context,
  document,
  table,
  target: providedTarget,
  readOnly = false,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table: NativeTable;
  target: NativeExpressionTarget;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [createdId] = useState(nativeDurableId);
  const target =
    providedTarget.kind === 'check' && providedTarget.create
      ? { ...providedTarget, id: createdId }
      : providedTarget;
  const initial = nativeExpressionInitial(document, table, target);
  const column =
    target.kind === 'check' ? undefined : document.columns?.find((c) => c.id === target.columnId);
  const title =
    target.kind === 'check' ? '새 복합 CHECK' : target.kind === 'default' ? '기본값 식' : '생성 식';
  const key = target.kind === 'check' ? (target.create ? 'new' : target.id) : target.columnId;
  const evaluate = (values: Record<string, string>, before: Record<string, string> = initial) =>
    nativeExpressionCandidate(document, table, target, values, before);
  return (
    <fieldset disabled={readOnly || context.busy}>
      <NativeEditorForm
        context={context}
        draftKey={`advanced:expression:${table.id}:${target.kind}:${key}`}
        title={t(title)}
        initial={initial}
        disabled={(values) => readOnly || !evaluate(values).usable}
        build={(values, before) => nativeAdvancedCommands(evaluate(values, before), readOnly)}
      >
        {(values, change) => (
          <>
            <p>
              {t('현재 원문')}: {nativeAdvancedOriginalLabel(document, target) || '—'}
            </p>
            <NativeEditorField
              label="식 적용 방식"
              value={values.mode ?? 'preserve'}
              onChange={(value) => change('mode', value)}
              disabled={readOnly || context.busy}
              choices={[
                {
                  value: 'preserve',
                  label: t('원문 보존'),
                  disabled: target.kind === 'check' && target.create,
                },
                { value: 'replace', label: t('구조화 식으로 명시 교체') },
                ...(target.kind === 'check' ? [] : [{ value: 'clear', label: t('식 제거') }]),
              ]}
            />
            <p>
              {t(
                '기존 기본값·생성 규칙을 제거하거나 덮어쓰는 변경은 명시 선택한 필드에만 적용됩니다.',
              )}
            </p>
            {target.kind === 'check' && (
              <NativeEditorField
                label="물리 이름"
                value={values.name ?? ''}
                onChange={(name) => change('name', name)}
                disabled={readOnly || context.busy || values.mode === 'preserve'}
              />
            )}
            {target.kind === 'computed' && (
              <NativeEditorField
                label="생성 식 저장 방식"
                value={values.storage ?? 'stored'}
                onChange={(storage) => change('storage', storage)}
                disabled={readOnly || context.busy || values.mode !== 'replace'}
                choices={['stored', 'virtual'].map((storage) => ({
                  value: storage,
                  label: storage,
                  disabled: storage !== values.storage && !evaluate({ ...values, storage }).allowed,
                }))}
              />
            )}
            {values.mode === 'replace' && (
              <NativeExpressionTreeEditor
                database={document.database}
                facts={nativeAdvancedExpressionFacts(
                  document,
                  table,
                  target.kind === 'computed' ? 'computed' : target.kind,
                  column,
                )}
                value={values.expressionDraftJSON ?? ''}
                onChange={(text) => change('expressionDraftJSON', text)}
                disabled={readOnly || context.busy}
              />
            )}
            <NativeAdvancedStatus status={evaluate(values)} />
          </>
        )}
      </NativeEditorForm>
    </fieldset>
  );
}
/** A separate bounded editor; the caller supplies the same durable context as the existing forms. */
export function NativeAdvancedEditor({
  context,
  document,
  table,
  readOnly = false,
  initialSelection,
  recoveryRevision,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table: NativeTable;
  readOnly?: boolean;
  initialSelection?: string;
  recoveryRevision?: string;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(initialSelection ?? 'index:new');
  const [newCheckId] = useState(nativeDurableId);
  const selectionValid = nativeAdvancedSelectionValid(document, table, selected);
  const readonly =
    readOnly ||
    context.snapshot.project.status !== 'active' ||
    table.scope === 'logical' ||
    context.snapshot.project.databaseKind !== document.database.kind ||
    context.snapshot.project.databaseProfileId !== document.database.profileId;
  const choices = [
    { value: 'index:new', label: t('새 고급 인덱스') },
    { value: 'check:new', label: t('새 복합 CHECK') },
    ...(document.indexes ?? [])
      .filter((i) => i.tableId === table.id)
      .map((i) => ({ value: JSON.stringify(['index', i.id]), label: `INDEX · ${i.name || i.id}` })),
    ...(document.checks ?? [])
      .filter((c) => c.tableId === table.id)
      .map((c) => ({ value: JSON.stringify(['check', c.id]), label: `CHECK · ${c.name || c.id}` })),
    ...(document.columns ?? [])
      .filter((c) => c.tableId === table.id && c.scope !== 'logical')
      .flatMap((c) =>
        ['default', 'computed'].map((kind) => ({
          value: JSON.stringify([kind, c.id]),
          label: `${t(kind === 'default' ? '기본값 식' : '생성 식')} · ${c.physical.name || c.logical.name || c.id}`,
        })),
      ),
  ];
  let target: NativeExpressionTarget | undefined;
  let index: NativeIndex | undefined;
  let isIndex = false;
  if (selected === 'index:new') isIndex = true;
  else if (selected === 'check:new') target = { kind: 'check', id: newCheckId, create: true };
  else if (selectionValid) {
    const [kind, id] = JSON.parse(selected) as [string, string];
    if (kind === 'index') {
      index = document.indexes?.find((i) => i.id === id && i.tableId === table.id);
      isIndex = !!index;
    } else if (kind === 'check') target = { kind: 'check', id, create: false };
    else if (kind === 'default' || kind === 'computed') target = { kind, columnId: id };
  }
  const mountingKey = `${context.userId}:${context.snapshot.project.id}:${table.id}:${selected}:${context.snapshot.project.databaseRevision}:${context.snapshot.project.version}:${context.snapshot.sequence}:${recoveryRevision ?? ''}`;
  return (
    <details className="native-property-editor" open={initialSelection ? true : undefined}>
      <summary>{t('고급 인덱스·식 편집')}</summary>
      {readonly && <p role="status">{t('고급 편집은 현재 DB의 물리 테이블에서만 가능합니다.')}</p>}
      {!selectionValid && (
        <p role="alert">
          {t('현재 설계에서 복구할 편집 대상을 찾을 수 없습니다. 보관된 초안은 그대로 유지됩니다.')}
        </p>
      )}
      <NativeEditorField
        label="고급 편집 대상"
        value={selected}
        onChange={setSelected}
        disabled={context.busy}
        choices={choices}
      />
      {isIndex && selectionValid && (
        <NativeAdvancedIndexForm
          key={mountingKey}
          context={context}
          document={document}
          table={table}
          {...(index ? { index } : {})}
          readOnly={readonly}
        />
      )}
      {target && selectionValid && (
        <NativeAdvancedExpressionForm
          key={mountingKey}
          context={context}
          document={document}
          table={table}
          target={target}
          readOnly={readonly}
        />
      )}
    </details>
  );
}

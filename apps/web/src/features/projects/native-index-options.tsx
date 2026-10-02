import type { NativeDesignDocument, NativeTable } from '@ezerd/model';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { NativeEditorField } from './native-editor-form.js';
import { NativeExpressionTreeEditor } from './native-expression-tree.js';
import {
  nativeAdvancedExpressionFacts,
  nativeIndexDraft,
  nativeIndexMethodChoices,
  nativeIndexOptionProbe,
  type NativeIndexDraft,
} from './native-advanced-policy.js';
import { nativeAstSeed, type NativeAstDraft } from './native-expression-tree-policy.js';

registerTranslations({
  '인덱스 방식': 'Index method',
  '고급 인덱스 옵션': 'Advanced index options',
  '조건 인덱스': 'Partial index',
  '조건 식 추가': 'Add a predicate',
  '조건 식 제거': 'Remove the predicate',
  '포함 컬럼': 'Included columns',
  '컬럼 추가': 'Add column',
  'NULL을 같은 값으로 취급': 'Treat NULL values as equal',
  '보이지 않는 인덱스': 'Invisible index',
  '현재 다른 DB 옵션 원문을 보존합니다.':
    'The original options for another database are preserved.',
  '현재 DB 옵션으로 명시 교체': 'Explicitly replace with options for the current database',
  '현재 원문 유지': 'Preserve the current original value',
});
export function NativeIndexOptionsEditor({
  document,
  table,
  value,
  onChange,
  disabled = false,
  indexId,
}: {
  document: NativeDesignDocument;
  table: NativeTable;
  value: NativeIndexDraft;
  onChange: (value: NativeIndexDraft) => void;
  disabled?: boolean;
  indexId?: string | undefined;
}) {
  const { t } = useI18n();
  const options = value.options;
  const change = (next: NativeIndexDraft['options']) => {
    if (!disabled) onChange({ ...value, options: next });
  };
  if (options.database !== document.database.kind)
    return (
      <div role="status">
        <p>{t('현재 다른 DB 옵션 원문을 보존합니다.')}</p>
        <Button
          disabled={disabled}
          onClick={() => change(nativeIndexDraft(document, table).options)}
        >
          {t('현재 DB 옵션으로 명시 교체')}
        </Button>
      </div>
    );
  const methodChoices = nativeIndexMethodChoices(document, table, value, indexId);
  const allowedOptions = (next: NativeIndexDraft['options']) =>
    nativeIndexOptionProbe(document, table, { ...value, options: next }, indexId).allowed;
  const columns = (document.columns ?? []).filter(
    (c) => c.tableId === table.id && c.scope !== 'logical',
  );
  const predicate = 'predicate' in options ? options.predicate : undefined;
  const updatePredicate = (next: NativeAstDraft | null) => {
    if (options.database === 'postgresql' || options.database === 'sqlite')
      change({ ...options, predicate: next });
  };
  const booleanChoices = [
    { value: 'false', label: 'false' },
    { value: 'true', label: 'true' },
  ];
  const field = (
    label: string,
    current: string,
    update: (v: string) => void,
    choices?: readonly { value: string; label: string; disabled?: boolean }[],
  ) => (
    <NativeEditorField
      label={label}
      value={current}
      onChange={update}
      disabled={disabled}
      {...(choices ? { choices } : {})}
    />
  );
  return (
    <fieldset disabled={disabled}>
      <legend>{t('고급 인덱스 옵션')}</legend>
      {options.database === 'postgresql' && (
        <>
          {field(
            '인덱스 방식',
            options.method,
            (method) => change({ ...options, method: method as typeof options.method }),
            methodChoices.map((p) => ({
              value: p.method,
              label: `${p.method}${p.allowed ? '' : ` · ${p.code}`}`,
              disabled: p.method !== options.method && !p.allowed,
            })),
          )}
          {field(
            'NULL을 같은 값으로 취급',
            options.nullsNotDistinct,
            (v) => change({ ...options, nullsNotDistinct: v }),
            booleanChoices.map((c) => ({
              ...c,
              disabled:
                c.value !== options.nullsNotDistinct &&
                !allowedOptions({ ...options, nullsNotDistinct: c.value }),
            })),
          )}
          <fieldset>
            <legend>{t('포함 컬럼')}</legend>
            {options.includeColumnIds.map((id, i) => (
              <div key={i}>
                {field(
                  `${i + 1}`,
                  id,
                  (id) =>
                    change({
                      ...options,
                      includeColumnIds: options.includeColumnIds.map((old, j) =>
                        j === i ? id : old,
                      ),
                    }),
                  [
                    ...columns.map((c) => ({
                      value: c.id,
                      label: c.physical.name || c.logical.name || c.id,
                      disabled: c.id !== id && options.includeColumnIds.includes(c.id),
                    })),
                    ...(!columns.some((c) => c.id === id)
                      ? [{ value: id, label: `${id} · ${t('현재 원문 유지')}`, disabled: true }]
                      : []),
                  ],
                )}
                <Button
                  disabled={disabled || i === 0}
                  onClick={() => {
                    const ids = [...options.includeColumnIds];
                    [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
                    change({ ...options, includeColumnIds: ids });
                  }}
                >
                  {t('위로')}
                </Button>
                <Button
                  disabled={disabled || i === options.includeColumnIds.length - 1}
                  onClick={() => {
                    const ids = [...options.includeColumnIds];
                    [ids[i + 1], ids[i]] = [ids[i]!, ids[i + 1]!];
                    change({ ...options, includeColumnIds: ids });
                  }}
                >
                  {t('아래로')}
                </Button>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    change({
                      ...options,
                      includeColumnIds: options.includeColumnIds.filter((_, j) => j !== i),
                    })
                  }
                >
                  {t('제거')}
                </Button>
              </div>
            ))}
            <Button
              disabled={
                disabled ||
                options.includeColumnIds.length >= 32 ||
                !allowedOptions({
                  ...options,
                  includeColumnIds: [
                    ...options.includeColumnIds,
                    columns.find((c) => !options.includeColumnIds.includes(c.id))?.id ?? '',
                  ],
                }) ||
                !columns.some((c) => !options.includeColumnIds.includes(c.id))
              }
              onClick={() => {
                const id = columns.find((c) => !options.includeColumnIds.includes(c.id))?.id;
                if (id) change({ ...options, includeColumnIds: [...options.includeColumnIds, id] });
              }}
            >
              {t('컬럼 추가')}
            </Button>
          </fieldset>
        </>
      )}
      {options.database === 'mysql' && (
        <>
          {field(
            '인덱스 방식',
            options.kind,
            (kind) => change({ ...options, kind: kind as typeof options.kind }),
            methodChoices.map((p) => ({
              value: p.method,
              label: `${p.method}${p.allowed ? '' : ` · ${p.code}`}`,
              disabled: p.method !== options.kind && !p.allowed,
            })),
          )}
          {field(
            '보이지 않는 인덱스',
            options.invisible,
            (v) => change({ ...options, invisible: v }),
            booleanChoices,
          )}
        </>
      )}
      {(options.database === 'postgresql' || options.database === 'sqlite') && (
        <section aria-label={t('조건 인덱스')}>
          {predicate ? (
            <>
              <NativeExpressionTreeEditor
                label="조건 인덱스"
                database={document.database}
                facts={nativeAdvancedExpressionFacts(document, table, 'predicate')}
                value={JSON.stringify(predicate)}
                onChange={(text) => updatePredicate(JSON.parse(text) as NativeAstDraft)}
                disabled={disabled}
              />
              <Button disabled={disabled} onClick={() => updatePredicate(null)}>
                {t('조건 식 제거')}
              </Button>
            </>
          ) : (
            <Button
              disabled={disabled}
              onClick={() =>
                updatePredicate({
                  kind: 'isNull',
                  negate: true,
                  operand: nativeAstSeed('column', document.database, columns[0]?.id ?? ''),
                })
              }
            >
              {t('조건 식 추가')}
            </Button>
          )}
        </section>
      )}
    </fieldset>
  );
}

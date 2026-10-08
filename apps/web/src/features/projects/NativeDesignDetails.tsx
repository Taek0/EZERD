import type { NativeDesignDocument, NativeTable } from '@ezerd/model';
import {
  nativeColumnTypeDisplay,
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  nativeExpressionDisplay,
} from '@ezerd/model';
import { PanelSection } from '../../shared/editor/panel.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { useNativeLogicalMode } from './NativeLogicalMode.js';
import './native-design-details.css';
registerTranslations({
  '설명 없음': 'No description',
  선택: 'Optional',
  '컬럼이 없습니다.': 'No columns.',
  '기본값·생성·DB 옵션': 'Defaults, generation and database options',
});
export interface NativeDesignDetailsProps {
  document: NativeDesignDocument;
  table: NativeTable;
  mode: 'physical' | 'logical';
}
/** Read-only detail view. Logical visibility is supplied by NativeLogicalModeProvider. */
export function NativeDesignDetails({
  document,
  table,
  mode: requestedMode,
}: NativeDesignDetailsProps) {
  const { t } = useI18n();
  const { enabled } = useNativeLogicalMode();
  const mode = enabled ? requestedMode : 'physical';
  const visible = (scope: string) => scope === 'both' || scope === mode;
  const options = table.physical.options;
  const columnName = (id: string) => {
    const column = document.columns?.find((c) => c.id === id);
    return column?.physical.name || column?.logical.name || id;
  };
  if (!enabled && table.scope === 'logical') return null;
  return (
    <PanelSection className="native-design-details" title={t('상세 설계 정보')}>
      <p>{mode === 'physical' ? table.physical.comment : table.logical.definition}</p>
      {mode === 'physical' && (
        <dl className="native-options">
          <dt>{t('DB 옵션')}</dt>
          <dd>
            {table.physical.namespace.kind === 'postgresSchema'
              ? table.physical.namespace.name || 'public'
              : table.physical.namespace.kind === 'legacyNamespace'
                ? table.physical.namespace.original
                : ''}
            {options?.database === 'mysql'
              ? ` InnoDB ${options.charset ?? ''} ${options.collation ?? ''}`
              : options?.database === 'sqlite'
                ? `${options.strict ? ' STRICT' : ''}${options.withoutRowid ? ' WITHOUT ROWID' : ''}`
                : ''}
          </dd>
        </dl>
      )}
      <div className="native-design-columns">
        {(document.columns ?? [])
          .filter((column) => column.tableId === table.id && visible(column.scope))
          .map((column) => (
            <article className="native-design-column" key={column.id} data-object-id={column.id}>
              <header>
                <strong>
                  {mode === 'physical'
                    ? column.physical.name || column.logical.name
                    : column.logical.name || column.physical.name}
                </strong>
                <span>
                  {mode === 'physical'
                    ? column.physical.nullable
                      ? 'NULL'
                      : 'NOT NULL'
                    : column.logical.required
                      ? t('필수')
                      : t('선택')}
                </span>
              </header>
              <dl>
                <dt>{mode === 'physical' ? t('타입') : t('의미 타입')}</dt>
                <dd>
                  {mode === 'physical'
                    ? nativeColumnTypeDisplay(column.physical.type, document.enums) ||
                      t('타입 없음')
                    : column.logical.semanticType || '—'}
                </dd>
              </dl>
              <p>
                {(mode === 'physical' ? column.physical.comment : column.logical.definition) ||
                  t('설명 없음')}
              </p>
              {mode === 'physical' && (
                <details>
                  <summary>{t('기본값·생성·DB 옵션')}</summary>
                  <dl>
                    <dt>{t('기본값')}</dt>
                    <dd>{nativeDefaultDisplay(column.physical.defaultValue, document) || '—'}</dd>
                    <dt>{t('생성')}</dt>
                    <dd>{nativeGenerationDisplay(column.physical.generation, document) || '—'}</dd>
                    <dt>{t('DB 옵션')}</dt>
                    <dd>
                      {column.physical.options.database === 'mysql'
                        ? (column.physical.options.charset ?? '') +
                          ' ' +
                          (column.physical.options.collation ?? '') +
                          (column.physical.options.onUpdate
                            ? ' ON UPDATE ' +
                              nativeExpressionDisplay(column.physical.options.onUpdate, document)
                            : '')
                        : column.physical.options.collation || '—'}
                    </dd>
                  </dl>
                </details>
              )}
              <details>
                <summary>{t('추가 속성')}</summary>
                <dl>
                  {(['common', mode] as const).flatMap((scope) =>
                    Object.entries(column.customProperties[scope]).map(([key, value]) => (
                      <div key={scope + key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    )),
                  )}
                </dl>
              </details>
            </article>
          ))}
        {!(document.columns ?? []).some(
          (column) => column.tableId === table.id && visible(column.scope),
        ) && <p>{t('컬럼이 없습니다.')}</p>}
      </div>
      <details>
        <summary>{t('추가 속성')}</summary>
        {Object.entries(table.customProperties.common).map(([key, value]) => (
          <p key={`common-${key}`}>
            {key}: {value}
          </p>
        ))}
        {Object.entries(table.customProperties[mode]).map(([key, value]) => (
          <p key={key}>
            {key}: {value}
          </p>
        ))}
      </details>

      <h3>{t('인덱스')}</h3>
      <ul>
        {(document.indexes ?? [])
          .filter((index) => index.tableId === table.id && visible(index.scope))
          .map((index) => (
            <li key={index.id}>
              {index.unique ? 'UNIQUE ' : ''}
              {index.name} (
              {index.parts
                .map(
                  (part) =>
                    `${nativeExpressionDisplay(part.expression, document)} ${part.direction.toUpperCase()}${part.prefixLength !== undefined ? ` (${part.prefixLength})` : ''}`,
                )
                .join(', ')}
              ) ·{' '}
              {index.options.database === 'postgresql'
                ? index.options.method
                : index.options.database === 'mysql'
                  ? index.options.kind
                  : 'SQLite'}
              {'predicate' in index.options && index.options.predicate
                ? ` WHERE ${nativeExpressionDisplay(index.options.predicate, document)}`
                : ''}
              {index.options.database === 'postgresql' && index.options.includeColumnIds?.length
                ? ` INCLUDE (${index.options.includeColumnIds.map(columnName).join(', ')})`
                : ''}
              {index.options.database === 'postgresql' && index.options.nullsNotDistinct
                ? ' NULLS NOT DISTINCT'
                : ''}
              {index.options.database === 'mysql' && index.options.invisible ? ' INVISIBLE' : ''}
            </li>
          ))}
      </ul>
      <h3>CHECK</h3>
      <ul>
        {(document.checks ?? [])
          .filter((check) => check.tableId === table.id && visible(check.scope))
          .map((check) => (
            <li key={check.id}>
              {check.name}: {nativeExpressionDisplay(check.expression, document)}
            </li>
          ))}
      </ul>
      <h3>ENUM</h3>
      <ul>
        {(document.enums ?? []).map((item) => (
          <li key={item.id}>
            {item.schema ? `${item.schema}.` : ''}
            {item.name}: {item.values.map((value) => JSON.stringify(value)).join(', ')}
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

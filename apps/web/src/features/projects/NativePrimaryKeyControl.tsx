import './native-property-editor.css';
import { useRef, useState } from 'react';
import type { NativeColumn, NativeDesignDocument } from '@ezerd/model';
import { Checkbox } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { nativePrimaryKeyPlan } from './native-primary-key.js';
import { nativeDurableId } from './native-durable-queue.js';
import { nativeEditorConditionText } from './native-editor-diagnostic.js';
import type { NativeEditorContext } from './native-editor-form.js';
registerTranslations({
  '기본 키(PK)': 'Primary key (PK)',
  '이 PK를 참조하는 FK가 있습니다. 관계의 참조 키를 먼저 변경하세요.':
    'This primary key is referenced by a foreign key. Change the referenced key first.',
  '자동 증가 컬럼을 지원하는 키가 필요합니다. 다른 키를 먼저 준비하세요.':
    'The auto-increment column needs a supporting key. Prepare another key first.',
  'WITHOUT ROWID 테이블은 기본 키를 유지해야 합니다.':
    'A WITHOUT ROWID table must retain its primary key.',
});

export function NativePrimaryKeyControl({
  document,
  column,
  context,
}: {
  document: NativeDesignDocument;
  column: NativeColumn;
  context: NativeEditorContext;
}) {
  const { t } = useI18n(),
    [sending, setSending] = useState(false),
    [error, setError] = useState('');
  const active = useRef(false),
    [newId] = useState(nativeDurableId);
  const checked = !!document.keys?.some(
    (key) =>
      key.tableId === column.tableId &&
      key.scope !== 'logical' &&
      key.kind === 'primary' &&
      key.columnIds.includes(column.id),
  );
  const preview = nativePrimaryKeyPlan(document, column.id, !checked, newId);
  const reason =
    preview.code === 'foreign-key.target-key-required'
      ? t('이 PK를 참조하는 FK가 있습니다. 관계의 참조 키를 먼저 변경하세요.')
      : preview.code === 'deletion.generation-key-required'
        ? t('자동 증가 컬럼을 지원하는 키가 필요합니다. 다른 키를 먼저 준비하세요.')
        : preview.code === 'deletion.primary-key-required'
          ? t('WITHOUT ROWID 테이블은 기본 키를 유지해야 합니다.')
          : preview.code
            ? nativeEditorConditionText(preview.code)
            : '';
  return (
    <div className="native-primary-key-control">
      <label className="native-primary-key-label" title={reason}>
        <Checkbox
          aria-label={t('기본 키(PK)')}
          checked={checked}
          disabled={context.busy || sending || !!preview.code}
          onChange={async (event) => {
            if (active.current || context.busy) return;
            const plan = nativePrimaryKeyPlan(document, column.id, event.target.checked, newId);
            if (plan.code) {
              setError(nativeEditorConditionText(plan.code));
              return;
            }
            active.current = true;
            setSending(true);
            setError('');
            try {
              const accepted = await context.onSave(plan.commands, {
                version: context.snapshot.project.version,
                sequence: context.snapshot.sequence,
                databaseRevision: context.snapshot.project.databaseRevision,
              });
              if (!accepted)
                setError(t('변경 요청이 적용되지 않았습니다. 최신 이력을 확인해 주세요.'));
            } catch {
              setError(t('변경 요청이 적용되지 않았습니다. 최신 이력을 확인해 주세요.'));
            } finally {
              active.current = false;
              setSending(false);
            }
          }}
        />
        {t('기본 키(PK)')}
      </label>
      {reason && (
        <p className="field-help" role="status">
          {reason}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

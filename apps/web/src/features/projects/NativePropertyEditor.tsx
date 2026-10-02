import { useState } from 'react';
import type { NativeColumn, NativeTable } from '@ezerd/model';
import { Button, Input } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  loadNativeDraft,
  storeNativeDraft,
  discardNativeDraft,
  rebaseNativeDraft,
  type NativePropertyDraft,
  type NativeSaveExpected,
  type NativeWebCommand,
} from './native-save.js';
import type { ProjectDocumentState } from '@ezerd/contracts';
registerTranslations({
  '속성 편집': 'Edit properties',
  '물리 이름': 'Physical name',
  '물리 설명': 'Physical comment',
  '논리 이름': 'Logical name',
  '논리 정의': 'Logical definition',
  '저장 요청': 'Save changes',
  '형식 정보와 기존 타입·기본값·생성 규칙은 유지됩니다.':
    'Format information and existing types, defaults and generation rules are preserved.',
  '최신 저장 내용과 비교 후 수정': 'Review edits against the latest saved design',
  '저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.':
    'The saved revision changed. Review your preserved input against the latest design.',
});
export function NativePropertyEditor({
  table,
  column,
  busy,
  onSave,
  userId,
  snapshot,
}: {
  table: NativeTable;
  column?: NativeColumn;
  busy: boolean;
  onSave: (commands: NativeWebCommand[], expected: NativeSaveExpected) => Promise<boolean>;
  userId: string;
  snapshot: ProjectDocumentState;
}) {
  const { t } = useI18n();
  const original = column ?? table;
  const kind = column ? 'column' : 'table';
  const [storageError, setStorageError] = useState('');
  const fresh = (): NativePropertyDraft => ({
    userId,
    projectId: snapshot.project.id,
    kind,
    objectId: original.id,
    expected: {
      version: snapshot.project.version,
      sequence: snapshot.sequence,
      databaseRevision: snapshot.project.databaseRevision,
    },
    values: {
      physicalName: original.physical.name,
      comment: original.physical.comment,
      logicalName: original.logical.name,
      definition: original.logical.definition,
    },
    before: {
      physicalName: original.physical.name,
      comment: original.physical.comment,
      logicalName: original.logical.name,
      definition: original.logical.definition,
    },
  });
  const [draft, setDraft] = useState(() => {
    try {
      return typeof localStorage !== 'undefined'
        ? (loadNativeDraft(userId, snapshot.project.id, kind, original.id) ?? fresh())
        : fresh();
    } catch {
      return fresh();
    }
  });
  const { physicalName, comment, logicalName, definition } = draft.values;
  function change(field: keyof NativePropertyDraft['values'], value: string) {
    const next = { ...draft, values: { ...draft.values, [field]: value } };
    setDraft(next);
    try {
      storeNativeDraft(next);
      setStorageError('');
    } catch {
      setStorageError('변경 입력을 보관하지 못했습니다. 저장 공간을 확인해 주세요.');
    }
  }
  const dirty =
    physicalName !== draft.before.physicalName ||
    comment !== draft.before.comment ||
    logicalName !== draft.before.logicalName ||
    definition !== draft.before.definition;
  const stale =
    draft.expected.version !== snapshot.project.version ||
    draft.expected.sequence !== snapshot.sequence ||
    draft.expected.databaseRevision !== snapshot.project.databaseRevision;
  async function submit() {
    const patch = {
      physical: {
        ...(physicalName !== draft.before.physicalName ? { name: physicalName } : {}),
        ...(comment !== draft.before.comment ? { comment } : {}),
      },
      logical: {
        ...(logicalName !== draft.before.logicalName ? { name: logicalName } : {}),
        ...(definition !== draft.before.definition ? { definition } : {}),
      },
    };
    const saved = await onSave(
      [
        column
          ? { type: 'patch_column', id: column.id, patch }
          : { type: 'patch_table', id: table.id, patch },
      ],
      draft.expected,
    );
    if (saved)
      discardNativeDraft(userId, snapshot.project.id, kind, original.id, localStorage, draft);
  }
  return (
    <form
      className="native-property-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy}>
        {storageError && <p role="alert">{storageError}</p>}
        {stale && (
          <div className="native-draft-review">
            <p>{t('저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.')}</p>
            <dl>
              <dt>{t('물리 이름')}</dt>
              <dd>{original.physical.name}</dd>
              <dt>{t('물리 설명')}</dt>
              <dd>{original.physical.comment}</dd>
              <dt>{t('논리 이름')}</dt>
              <dd>{original.logical.name}</dd>
              <dt>{t('논리 정의')}</dt>
              <dd>{original.logical.definition}</dd>
            </dl>
            <Button
              onClick={() => {
                const latest = fresh();
                const next = rebaseNativeDraft(draft, latest.expected, latest.values);
                try {
                  storeNativeDraft(next);
                  setDraft(next);
                  setStorageError('');
                } catch {
                  setStorageError('변경 입력을 보관하지 못했습니다. 저장 공간을 확인해 주세요.');
                }
              }}
            >
              {t('최신 저장 내용과 비교 후 수정')}
            </Button>
          </div>
        )}
        <legend>{t('속성 편집')}</legend>
        <label>
          {t('물리 이름')}
          <Input
            value={physicalName}
            maxLength={120}
            onChange={(event) => change('physicalName', event.target.value)}
          />
        </label>
        <label>
          {t('물리 설명')}
          <textarea
            value={comment}
            maxLength={10000}
            onChange={(event) => change('comment', event.target.value)}
          />
        </label>
        <label>
          {t('논리 이름')}
          <Input
            value={logicalName}
            maxLength={120}
            onChange={(event) => change('logicalName', event.target.value)}
          />
        </label>
        <label>
          {t('논리 정의')}
          <textarea
            value={definition}
            maxLength={10000}
            onChange={(event) => change('definition', event.target.value)}
          />
        </label>
        <p>{t('형식 정보와 기존 타입·기본값·생성 규칙은 유지됩니다.')}</p>
        <Button type="submit" disabled={!dirty || busy || !!storageError || stale}>
          {t('저장 요청')}
        </Button>
      </fieldset>
    </form>
  );
}

import { PanelSection } from '../../shared/editor/panel.js';
import { useEffect, useRef, useState } from 'react';
import type { NativeColumn, NativeTable } from '@ezerd/model';
import { Button, Input } from '../../components/ui/index.js';
import { NativeAutoTextarea } from './native-editor-form.js';
import { NativePrimaryKeyControl } from './NativePrimaryKeyControl.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  loadNativeDraft,
  storeNativeDraft,
  discardNativeDraft,
  resetNativeDraft,
  rebaseNativeDraft,
  type NativePropertyDraft,
  type NativeSaveExpected,
  type NativeWebCommand,
} from './native-save.js';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { NativeFormatEditor } from './native-editor-format.js';
import { useNativeExportBlocker } from './native-export-state.js';
import { nativeDraftMemoryState } from './native-durable-drafts.js';
import { message } from '../../shared/api/client.js';
registerTranslations({
  '속성 편집': 'Edit properties',
  'DB 옵션 · 표시': 'Database options and appearance',
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
  mode,
}: {
  mode?: 'physical' | 'logical';
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
  const [loaded] = useState(() => {
    try {
      return {
        draft: loadNativeDraft(userId, snapshot.project.id, kind, original.id) ?? fresh(),
        error: nativeDraftMemoryState(userId, snapshot.project.id).storageFailure
          ? 'native.draft-storage-failed'
          : '',
      };
    } catch {
      return {
        draft: fresh(),
        error: '변경 입력을 보관하지 못했습니다. 저장 공간을 확인해 주세요.',
      };
    }
  });
  const [draft, setDraft] = useState(loaded.draft);
  const currentDraft = useRef(loaded.draft);
  const [storageError, setStorageError] = useState(loaded.error);
  const [outstanding, setOutstanding] = useState(0);
  const [ackSequence, setAckSequence] = useState(-1);
  const observedSequence = useRef(snapshot.sequence);
  observedSequence.current = snapshot.sequence;
  const { physicalName, comment, logicalName, definition } = draft.values;
  function change(field: keyof NativePropertyDraft['values'], value: string) {
    const next = {
      ...currentDraft.current,
      values: { ...currentDraft.current.values, [field]: value },
    };
    persist(next);
  }
  function persist(next: NativePropertyDraft) {
    currentDraft.current = next;
    setDraft(next);
    try {
      storeNativeDraft(next);
      setStorageError('');
    } catch {
      setStorageError('변경 입력을 보관하지 못했습니다. 저장 공간을 확인해 주세요.');
    }
  }
  useEffect(() => {
    if (outstanding || snapshot.sequence <= ackSequence) return;
    try {
      const current = currentDraft.current;
      if (current.expected.databaseRevision !== snapshot.project.databaseRevision) return;
      const latest = fresh();
      if (
        current.expected.version === latest.expected.version &&
        current.expected.sequence === latest.expected.sequence
      )
        return;
      const next = rebaseNativeDraft(current, latest.expected, latest.values);
      const changed = Object.keys(next.values).some(
        (key) =>
          next.values[key as keyof typeof next.values] !==
          next.before[key as keyof typeof next.before],
      );
      if (changed) persist(next);
      else {
        discardNativeDraft(userId, snapshot.project.id, kind, original.id, undefined, current);
        currentDraft.current = next;
        setDraft(next);
      }
    } catch (error) {
      setStorageError(message(error));
    }
  }, [
    snapshot.project.version,
    snapshot.sequence,
    snapshot.project.databaseRevision,
    outstanding,
    ackSequence,
  ]);
  const dirty =
    physicalName !== draft.before.physicalName ||
    comment !== draft.before.comment ||
    logicalName !== draft.before.logicalName ||
    definition !== draft.before.definition;
  useNativeExportBlocker(
    userId,
    snapshot.project.id,
    dirty,
    !!storageError,
    `property:${kind}:${original.id}`,
  );
  const stale = draft.expected.databaseRevision !== snapshot.project.databaseRevision;
  async function submit() {
    if (busy || stale || storageError || !dirty) return;
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
    let queued = false;
    try {
      storeNativeDraft(draft);
      queued = true;
      setOutstanding((count) => count + 1);
      const completion = onSave(
        [
          column
            ? { type: 'patch_column', id: column.id, patch }
            : { type: 'patch_table', id: table.id, patch },
        ],
        draft.expected,
      );
      const baseline = { ...draft, before: { ...draft.values } };
      persist(baseline);
      const saved = await completion;
      if (saved) setAckSequence(observedSequence.current);
      if (!saved && currentDraft.current === baseline) persist(draft);
      if (saved && currentDraft.current === baseline) {
        discardNativeDraft(userId, snapshot.project.id, kind, original.id, undefined, baseline);
        const next = { ...draft, before: { ...draft.values } };
        currentDraft.current = next;
        setDraft(next);
      }
    } catch (error) {
      setStorageError(message(error));
    } finally {
      if (queued) setOutstanding((count) => count - 1);
    }
  }
  return (
    <>
      <form
        className="native-property-editor inspector-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy}>
          {storageError && (
            <>
              <p role="alert">{storageError}</p>
              <p role="status">
                {t(
                  '입력은 이 탭의 메모리에 보관되었습니다. 탭을 닫기 전에 보관을 다시 시도해 주세요.',
                )}
              </p>
              <Button onClick={() => persist(currentDraft.current)}>
                {t('입력 보관 다시 시도')}
              </Button>
            </>
          )}
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
                disabled={draft.expected.databaseRevision !== snapshot.project.databaseRevision}
                onClick={() => {
                  try {
                    const latest = fresh();
                    persist(
                      rebaseNativeDraft(currentDraft.current, latest.expected, latest.values),
                    );
                  } catch (error) {
                    setStorageError(message(error));
                  }
                }}
              >
                {t('최신 저장 내용과 비교 후 수정')}
              </Button>
            </div>
          )}
          <legend>{t('속성 편집')}</legend>
          <label hidden={mode === 'logical'}>
            {t(mode ? (column ? '컬럼명' : '테이블명') : '물리 이름')}
            <Input
              value={physicalName}
              maxLength={120}
              onChange={(event) => change('physicalName', event.target.value)}
            />
          </label>
          <label hidden={mode === 'logical'}>
            {t(mode ? '설명' : '물리 설명')}
            <NativeAutoTextarea
              value={comment}
              maxLength={10000}
              onChange={(event) => change('comment', event.target.value)}
            />
          </label>
          <label hidden={mode === 'physical'}>
            {t('논리 이름')}
            <Input
              value={logicalName}
              maxLength={120}
              onChange={(event) => change('logicalName', event.target.value)}
            />
          </label>
          <label hidden={mode === 'physical'}>
            {t('논리 정의')}
            <NativeAutoTextarea
              value={definition}
              maxLength={10000}
              onChange={(event) => change('definition', event.target.value)}
            />
          </label>
          <p>{t('형식 정보와 기존 타입·기본값·생성 규칙은 유지됩니다.')}</p>
          <Button
            variant="primary"
            type="submit"
            disabled={!dirty || busy || !!storageError || stale}
          >
            {t('저장 요청')}
          </Button>
          <Button
            onClick={() => {
              try {
                resetNativeDraft(userId, snapshot.project.id, kind, original.id);
                const next = fresh();
                currentDraft.current = next;
                setDraft(next);
                setStorageError('');
              } catch (error) {
                setStorageError(message(error));
              }
            }}
          >
            {t('입력 초기화')}
          </Button>
        </fieldset>
      </form>
      {snapshot.native.status === 'available' && (
        <PanelSection
          title={t(
            mode === 'logical'
              ? '논리 속성 · 추가 속성'
              : column
                ? '타입 · NULL · 기본값'
                : 'DB 옵션 · 표시',
          )}
          defaultOpen={!!column}
        >
          <NativeFormatEditor
            key={`format:${userId}:${snapshot.project.id}:${kind}:${original.id}:${snapshot.project.databaseRevision}`}
            context={{ userId, snapshot, busy, onSave }}
            document={snapshot.native.document}
            table={table}
            {...(mode ? { mode } : {})}
            {...(column ? { column } : {})}
          />
          {column && mode !== 'logical' && (
            <NativePrimaryKeyControl
              document={snapshot.native.document}
              column={column}
              context={{ userId, snapshot, busy, onSave }}
            />
          )}
        </PanelSection>
      )}
    </>
  );
}

import './native-property-editor.css';
import { useNativeLogicalMode } from './NativeLogicalMode.js';
import { useNativeAutosave } from './use-native-autosave.js';
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
  rebaseNativeDraft,
  type NativePropertyDraft,
  type NativeSaveExpected,
  type NativeWebCommand,
} from './native-save.js';
import {
  nativeColumnPatchSchema,
  nativeTablePatchSchema,
  type ProjectDocumentState,
} from '@ezerd/contracts';
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
  const { enabled: logicalEnabled } = useNativeLogicalMode();
  if (!logicalEnabled) mode = 'physical';
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
  const observed = useRef({ sequence: snapshot.sequence, values: fresh().values });
  observed.current = { sequence: snapshot.sequence, values: fresh().values };
  const { physicalName, comment, logicalName, definition } = draft.values;
  function change(field: keyof NativePropertyDraft['values'], value: string) {
    const next = {
      ...currentDraft.current,
      values: { ...currentDraft.current.values, [field]: value },
    };
    persist(next);
    autosave.markChanged();
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
  const valid = (column ? nativeColumnPatchSchema : nativeTablePatchSchema).safeParse({
    physical: { name: physicalName, comment },
    logical: { name: logicalName, definition },
  }).success;
  const autosave = useNativeAutosave({
    blocked: busy || stale || !!storageError || !dirty || outstanding > 0 || !valid,
    getBlocked: (draining) => {
      const current = currentDraft.current;
      const values = current.values;
      return (
        (!draining && (busy || outstanding > 0)) ||
        !!storageError ||
        current.expected.databaseRevision !== snapshot.project.databaseRevision ||
        !Object.keys(values).some(
          (key) =>
            values[key as keyof typeof values] !== current.before[key as keyof typeof values],
        ) ||
        !(column ? nativeColumnPatchSchema : nativeTablePatchSchema).safeParse({
          physical: { name: values.physicalName, comment: values.comment },
          logical: { name: values.logicalName, definition: values.definition },
        }).success
      );
    },
    save: submit,
  });
  async function submit(draining = false) {
    const draft = currentDraft.current;
    const { physicalName, comment, logicalName, definition } = draft.values;
    if (
      (!draining && (busy || outstanding)) ||
      draft.expected.databaseRevision !== snapshot.project.databaseRevision ||
      storageError
    )
      return;
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
    if (!(column ? nativeColumnPatchSchema : nativeTablePatchSchema).safeParse(patch).success)
      return;
    if (!Object.keys(patch.physical).length && !Object.keys(patch.logical).length) return;
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
      const saved = await completion;
      if (saved) {
        const latest = observed.current;
        const reflected = (Object.keys(draft.values) as (keyof typeof draft.values)[])
          .filter((key) => draft.values[key] !== draft.before[key])
          .every((key) => latest.values[key] === draft.values[key]);
        setAckSequence(reflected ? draft.expected.sequence : latest.sequence);
        const current = currentDraft.current;
        const next = { ...current, before: { ...draft.values } };
        if (current === draft) {
          discardNativeDraft(userId, snapshot.project.id, kind, original.id, undefined, draft);
          currentDraft.current = next;
          setDraft(next);
        } else persist(next);
      }
    } catch (error) {
      setStorageError(message(error));
    } finally {
      if (queued) setOutstanding((count) => count - 1);
    }
  }
  return (
    <>
      <div className="native-property-editor inspector-fields" {...autosave.compositionProps}>
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
                {logicalEnabled && (
                  <>
                    <dt>{t('논리 이름')}</dt>
                    <dd>{original.logical.name}</dd>
                    <dt>{t('논리 정의')}</dt>
                    <dd>{original.logical.definition}</dd>
                  </>
                )}
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
          <label hidden={mode === 'logical'}>
            {t(mode ? (column ? '컬럼명' : '테이블명') : '물리 이름')}
            <Input
              value={physicalName}
              maxLength={120}
              onChange={(event) => change('physicalName', event.target.value)}
            />
          </label>
          {column && mode !== 'logical' && snapshot.native.status === 'available' ? (
            <NativeFormatEditor
              key={`format:${userId}:${snapshot.project.id}:${kind}:${original.id}:${snapshot.project.databaseRevision}`}
              context={{ userId, snapshot, busy, onSave }}
              document={snapshot.native.document}
              table={table}
              column={column}
              {...(mode ? { mode } : {})}
              afterType={
                <>
                  <label>
                    {t(mode ? '설명' : '물리 설명')}
                    <NativeAutoTextarea
                      value={comment}
                      maxLength={10000}
                      onChange={(event) => change('comment', event.target.value)}
                    />
                  </label>
                  <NativePrimaryKeyControl
                    document={snapshot.native.document}
                    column={column}
                    context={{ userId, snapshot, busy, onSave }}
                  />
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
                </>
              }
            />
          ) : (
            <>
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
            </>
          )}
        </fieldset>
      </div>
      {snapshot.native.status === 'available' && (!column || mode === 'logical') && (
        <PanelSection
          title={t(
            mode === 'logical'
              ? '논리 속성 · 추가 속성'
              : column
                ? '타입 · NULL · 기본값'
                : 'DB 옵션 · 표시',
          )}
          defaultOpen={false}
        >
          <NativeFormatEditor
            key={`format:${userId}:${snapshot.project.id}:${kind}:${original.id}:${snapshot.project.databaseRevision}`}
            context={{ userId, snapshot, busy, onSave }}
            document={snapshot.native.document}
            table={table}
            {...(mode ? { mode } : {})}
            {...(column ? { column } : {})}
          />
        </PanelSection>
      )}
    </>
  );
}

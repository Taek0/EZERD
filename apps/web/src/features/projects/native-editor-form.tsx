import { useRef, useState, type ReactNode } from 'react';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { message } from '../../shared/api/client.js';
import {
  loadNativeEditorDraft,
  storeNativeEditorDraft,
  discardNativeEditorDraft,
  rebaseNativeEditorDraft,
  type NativeEditorDraft,
  type NativeEditorDraftRef,
} from './native-editor-draft.js';
import type { NativeSaveExpected, NativeWebCommand } from './native-save.js';

export type NativeEditorSave = (
  commands: NativeWebCommand[],
  expected: NativeSaveExpected,
  draft?: NativeEditorDraftRef,
) => Promise<boolean>;
export interface NativeEditorContext {
  userId: string;
  snapshot: ProjectDocumentState;
  busy: boolean;
  onSave: NativeEditorSave;
}
registerTranslations({
  '최신 내용': 'Latest values',
  '입력 초기화': 'Reset input',
  'DB 설정이 변경되었습니다. 입력을 확인하고 초기화해 주세요.':
    'Database context changed. Review and reset this input.',
  '미검증 기능은 새로 사용할 수 없습니다. 현재 값은 보존됩니다.':
    'Unverified features cannot be added. Current values are preserved.',
  '미구현 또는 실행 검증 미완료': 'Implementation or execution verification is incomplete',
  '이 DB에서 지원하지 않음': 'Unsupported by this database',
});

/** One form has one durable input revision; a matching accepted ACK alone consumes it. */
export function NativeEditorForm({
  context,
  draftKey,
  title,
  initial,
  build,
  disabled = false,
  children,
}: {
  context: NativeEditorContext;
  draftKey: string;
  title: string;
  initial: Record<string, string>;
  build: (values: Record<string, string>, before: Record<string, string>) => NativeWebCommand[];
  disabled?: boolean | ((values: Record<string, string>) => boolean);
  children: (
    values: Record<string, string>,
    change: (field: string, value: string) => void,
  ) => ReactNode;
}) {
  const { t } = useI18n();
  const { userId, snapshot } = context;
  const expected = {
    version: snapshot.project.version,
    sequence: snapshot.sequence,
    databaseRevision: snapshot.project.databaseRevision,
  };
  const fresh = (): NativeEditorDraft => ({
    userId,
    projectId: snapshot.project.id,
    key: draftKey,
    revision: crypto.randomUUID(),
    expected,
    before: { ...initial },
    values: { ...initial },
  });
  const [loaded] = useState(() => {
    try {
      return {
        draft:
          typeof localStorage === 'undefined'
            ? fresh()
            : (loadNativeEditorDraft(userId, snapshot.project.id, draftKey) ?? fresh()),
        error: '',
      };
    } catch (error) {
      return { draft: fresh(), error: message(error) };
    }
  });
  const [draft, setDraft] = useState(loaded.draft);
  const currentDraft = useRef(loaded.draft);
  const [storageError, setStorageError] = useState(loaded.error);
  const [error, setError] = useState('');
  const stale =
    draft.expected.version !== expected.version ||
    draft.expected.sequence !== expected.sequence ||
    draft.expected.databaseRevision !== expected.databaseRevision;
  const changedContext = draft.expected.databaseRevision !== expected.databaseRevision;
  const blocked = typeof disabled === 'function' ? disabled(draft.values) : disabled;
  function persist(next: NativeEditorDraft) {
    currentDraft.current = next;
    setDraft(next);
    try {
      storeNativeEditorDraft(next);
      setStorageError('');
    } catch (error) {
      setStorageError(message(error));
    }
  }
  async function submit() {
    if (context.busy || stale || blocked || storageError) return;
    setError('');
    try {
      const commands = build(draft.values, draft.before);
      if (!commands.length) return;
      storeNativeEditorDraft(draft);
      if (
        await context.onSave(commands, draft.expected, { key: draft.key, revision: draft.revision })
      ) {
        discardNativeEditorDraft(userId, snapshot.project.id, draft);
        const next = fresh();
        currentDraft.current = next;
        setDraft(next);
      }
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <form
      className="native-property-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={context.busy}>
        <legend>{title}</legend>
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
        {stale && (
          <div role="status">
            <p>
              {t(
                changedContext
                  ? 'DB 설정이 변경되었습니다. 입력을 확인하고 초기화해 주세요.'
                  : '저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.',
              )}
            </p>
            <details>
              <summary>{t('최신 내용')}</summary>
              <dl>
                {Object.entries(initial).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <Button
              disabled={changedContext}
              onClick={() => {
                try {
                  persist(rebaseNativeEditorDraft(draft, expected, initial));
                } catch (error) {
                  setError(message(error));
                }
              }}
            >
              {t('최신 저장 내용과 비교 후 수정')}
            </Button>
          </div>
        )}
        {children(draft.values, (field, value) => {
          const current = currentDraft.current;
          persist({
            ...current,
            revision: crypto.randomUUID(),
            values: { ...current.values, [field]: value },
          });
        })}
        {blocked && <p>{t('미검증 기능은 새로 사용할 수 없습니다. 현재 값은 보존됩니다.')}</p>}
        <Button type="submit" disabled={context.busy || stale || blocked || !!storageError}>
          {t('저장 요청')}
        </Button>
        <Button
          disabled={!!storageError}
          onClick={() => {
            discardNativeEditorDraft(userId, snapshot.project.id, draft);
            const next = fresh();
            currentDraft.current = next;
            setDraft(next);
            setError('');
          }}
        >
          {t('입력 초기화')}
        </Button>
      </fieldset>
    </form>
  );
}

export function NativeEditorField({
  label,
  value,
  onChange,
  choices,
  disabled = false,
  multiline = false,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  choices?: readonly { value: string; label: string; disabled?: boolean | undefined }[];
  disabled?: boolean;
  multiline?: boolean;
  type?: string;
}) {
  const { t } = useI18n();
  return (
    <label>
      {t(label)}
      {choices ? (
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value} disabled={choice.disabled}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type={type}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

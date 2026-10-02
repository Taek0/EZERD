import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import '../collaboration/translations.js';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  MAX_PROJECT_TRANSFER_BYTES,
  type Project,
  type NativeTransferRead,
} from '@ezerd/contracts';
import { message } from '../../shared/api/client.js';
import { Button, Input } from '../../components/ui/index.js';
import {
  parseProjectTransfer,
  projectTransferDocument,
  importProjectTransfer,
  projectTransferGuard,
  currentTransferUserId,
} from './project-transfer.js';
import { exportCurrentProjectFile, type ProjectExportOptions } from './project-versioned-export.js';
import './project-transfer.css';
registerTranslations({
  '원본 native 설계와 DB 문맥을 유지합니다. 미검증 기능과 legacy 가져오기는 서버 정책에 따라 차단될 수 있습니다.':
    'The original native design and database context are retained. Unverified features and legacy imports may be blocked by server policy.',
  '기존 타입·기본값·스키마 원문을 legacy로 보존합니다.':
    'Original types, defaults and schemas are preserved as legacy data.',
});

/** Always fetch the server snapshot. Browser drafts and private preferences are excluded. */
export function exportProjectFile(
  projectId: string,
  options: ProjectExportOptions = {},
): Promise<void> {
  return exportCurrentProjectFile(projectId, options);
}

export function ProjectImportButton({
  onImported,
  workspaceId,
  disabled = false,
  renderTrigger,
  userId,
}: {
  onImported: (project: Project) => void;
  disabled?: boolean;
  workspaceId: string;
  renderTrigger?: (open: () => void, disabled: boolean) => ReactNode;
  userId?: string | undefined;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<NativeTransferRead | null>(null);
  const [checkSelection, setCheckSelection] = useState<(() => void) | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const live = useRef({ workspaceId, disabled, userId });
  live.current = { workspaceId, disabled, userId };
  const mounted = useRef(true);
  const readTicket = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const currentScope = () =>
    mounted.current && !live.current.disabled
      ? {
          workspaceId: live.current.workspaceId,
          userId: live.current.userId ?? currentTransferUserId() ?? '',
        }
      : null;
  useEffect(() => {
    readTicket.current++;
    setFile(null);
    setCheckSelection(null);
    setError('');
    setReading(false);
  }, [workspaceId, userId]);
  let visibleFile = file;
  if (visibleFile) {
    try {
      checkSelection?.();
    } catch {
      visibleFile = null;
    }
  }
  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => {
          if (!disabled && !reading) input.current?.click();
        }, disabled || reading)
      ) : (
        <Button disabled={disabled || reading} onClick={() => input.current?.click()}>
          {reading ? t('파일 확인 중…') : t('프로젝트 가져오기')}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept=".json,.ezerd.json,application/json"
        hidden
        aria-label={t('프로젝트 JSON 파일')}
        onChange={async (event) => {
          const selected = event.target.files?.[0];
          event.target.value = '';
          if (!selected) return;
          const ticket = ++readTicket.current;
          setError('');
          setReading(true);
          const scope = currentScope();
          if (!scope) {
            setReading(false);
            return;
          }
          const assertCurrent = projectTransferGuard({ scope, currentScope });
          try {
            if (selected.size > MAX_PROJECT_TRANSFER_BYTES)
              throw new Error(t('프로젝트 파일은 2 MB까지 가져올 수 있습니다.'));
            const text = await selected.text();
            assertCurrent();
            if (ticket !== readTicket.current) return;
            setFile(parseProjectTransfer(text));
            setCheckSelection(() => assertCurrent);
          } catch (e) {
            if (mounted.current && ticket === readTicket.current) setError(message(e));
          } finally {
            if (mounted.current && ticket === readTicket.current) setReading(false);
          }
        }}
      />
      {error && (
        <p className="notice error project-transfer-error" role="alert">
          {error}
        </p>
      )}
      {visibleFile && (
        <ProjectImportDialog
          file={visibleFile}
          userId={userId ?? currentTransferUserId() ?? ''}
          workspaceId={workspaceId}
          assertCurrent={
            checkSelection ??
            (() => {
              throw new Error('project-transfer.scope-changed');
            })
          }
          onCancel={() => setFile(null)}
          onImported={(project) => {
            setFile(null);
            onImported(project);
          }}
        />
      )}
    </>
  );
}

function ProjectImportDialog({
  file,
  workspaceId,
  onCancel,
  onImported,
  assertCurrent,
  userId,
}: {
  file: NativeTransferRead;
  workspaceId: string;
  onCancel: () => void;
  onImported: (project: Project) => void;
  assertCurrent: () => void;
  userId: string;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [name, setName] = useState(file.project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const inputId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="project-transfer-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting.current) onCancel();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setBusy(true);
          setError('');
          try {
            const project = await importProjectTransfer(file, name, workspaceId, {
              assertCurrent,
              userId,
            });
            assertCurrent();
            onImported(project);
          } catch (e) {
            setError(message(e));
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <h2 id={titleId}>{t('프로젝트 가져오기')}</h2>
        <p>{t('설계 데이터를 새 프로젝트로 만듭니다.')}</p>
        <label htmlFor={inputId}>{t('프로젝트 이름')}</label>
        <Input
          id={inputId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={120}
          disabled={busy}
          autoFocus
        />
        <ProjectTransferSummary file={file} />
        <p className="project-transfer-hint">
          {t('계정, PIN, 대화, 변경 이력 및 개인 화면 설정은 포함되지 않습니다.')}
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="project-transfer-actions">
          <Button type="button" disabled={busy} onClick={onCancel}>
            {t('취소')}
          </Button>
          <Button
            type="submit"
            disabled={
              busy || !name.trim() || ('native' in file && file.native.status === 'unavailable')
            }
          >
            {busy ? t('가져오는 중…') : t('새 프로젝트로 가져오기')}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
/** Static, complete source counts and labelled diagnostics; never count a lossy v1 projection. */
export function ProjectTransferSummary({ file }: { file: NativeTransferRead }) {
  const { t } = useI18n();
  const doc = projectTransferDocument(file);
  const counts: [string, number][] = [
    ['도메인', doc.domains.length],
    ['테이블', doc.tables?.length ?? 0],
    ['컬럼', doc.columns?.length ?? 0],
    ['관계', doc.domainRelations.length + (doc.tableRelations?.length ?? 0)],
    ['ENUM', doc.enums?.length ?? 0],
    ['메모', doc.notes.length],
    ['저장된 뷰', doc.views?.length ?? 0],
  ];
  if (doc.schemaVersion === 2)
    counts.push(['INDEX', doc.indexes?.length ?? 0], ['CHECK', doc.checks?.length ?? 0]);
  return (
    <>
      <p>
        {`JSON v${file.formatVersion} · ${file.project.databaseKind ?? 'postgresql'}`}
        {file.formatVersion === 2 && ` · ${file.project.databaseProfileId}`}
      </p>
      <dl className="project-transfer-counts">
        {counts.map(([label, count]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      {file.formatVersion === 2 && (
        <p>
          {t(
            '원본 native 설계와 DB 문맥을 유지합니다. 미검증 기능과 legacy 가져오기는 서버 정책에 따라 차단될 수 있습니다.',
          )}
        </p>
      )}
      {'native' in file &&
        file.native.status === 'available' &&
        file.native.migrationIssues.length > 0 && (
          <p role="status">
            {t('기존 타입·기본값·스키마 원문을 legacy로 보존합니다.')} (
            {file.native.migrationIssues.length})
          </p>
        )}
      {'native' in file && file.native.status === 'unavailable' && (
        <p role="alert">{file.native.code}</p>
      )}
    </>
  );
}

import { translate as t, useI18n } from '../../shared/i18n/index.js';
import '../collaboration/translations.js';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MAX_PROJECT_TRANSFER_BYTES,
  projectSchema,
  projectTransferSchema,
  type Project,
  type ProjectTransfer,
} from '@ezerd/contracts';
import { body, message, request } from '../../shared/api/client.js';
import { Button, Input } from '../../components/ui/index.js';
import { parseProjectTransfer, projectTransferFilename } from './project-transfer.js';
import './project-transfer.css';

/** Always fetch the server snapshot. Browser drafts and private preferences are excluded. */
export async function exportProjectFile(projectId: string): Promise<void> {
  let file: ProjectTransfer;
  try {
    file = projectTransferSchema.parse(
      await request(`/api/projects/${encodeURIComponent(projectId)}/export`, { cache: 'no-store' }),
    );
  } catch {
    throw new Error(
      t('서버의 최신 저장 내용을 가져올 수 없습니다. 연결을 확인한 뒤 다시 내보내 주세요.'),
    );
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file)], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = projectTransferFilename(file.project.name);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProjectImportButton({
  onImported,
  disabled = false,
}: {
  onImported: (project: Project) => void;
  disabled?: boolean;
}) {
  useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ProjectTransfer | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  return (
    <>
      <Button disabled={disabled || reading} onClick={() => input.current?.click()}>
        {reading ? t('파일 확인 중…') : t('프로젝트 가져오기')}
      </Button>
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
          setError('');
          setReading(true);
          try {
            if (selected.size > MAX_PROJECT_TRANSFER_BYTES)
              throw new Error(t('프로젝트 파일은 2 MB까지 가져올 수 있습니다.'));
            setFile(parseProjectTransfer(await selected.text()));
          } catch (e) {
            setError(message(e));
          } finally {
            setReading(false);
          }
        }}
      />
      {error && (
        <p className="notice error project-transfer-error" role="alert">
          {error}
        </p>
      )}
      {file && (
        <ProjectImportDialog
          file={file}
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
  onCancel,
  onImported,
}: {
  file: ProjectTransfer;
  onCancel: () => void;
  onImported: (project: Project) => void;
}) {
  useI18n();
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
  const doc = file.document;
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
            const transfer = projectTransferSchema.parse({
              ...file,
              project: { name: name.trim() },
            });
            const project = projectSchema.parse(
              await request('/api/projects/import', body('POST', transfer)),
            );
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
        <dl className="project-transfer-counts">
          <div>
            <dt>{t('도메인')}</dt>
            <dd>{doc.domains.length}</dd>
          </div>
          <div>
            <dt>{t('테이블')}</dt>
            <dd>{doc.tables?.length ?? 0}</dd>
          </div>
          <div>
            <dt>{t('컬럼')}</dt>
            <dd>{doc.columns?.length ?? 0}</dd>
          </div>
          <div>
            <dt>{t('관계')}</dt>
            <dd>{doc.domainRelations.length + (doc.tableRelations?.length ?? 0)}</dd>
          </div>
          <div>
            <dt>ENUM</dt>
            <dd>{doc.enums?.length ?? 0}</dd>
          </div>
          <div>
            <dt>{t('메모')}</dt>
            <dd>{doc.notes.length}</dd>
          </div>
          <div>
            <dt>{t('저장된 뷰')}</dt>
            <dd>{doc.views?.length ?? 0}</dd>
          </div>
        </dl>
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
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? t('가져오는 중…') : t('새 프로젝트로 가져오기')}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

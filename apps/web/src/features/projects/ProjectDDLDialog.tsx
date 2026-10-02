import { useEffect, useRef, useState } from 'react';
import type { ProjectDDLExport } from '@ezerd/contracts';
import { getDatabaseProfile } from '@ezerd/model';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { message } from '../../shared/api/client.js';
import './project-ddl.css';
registerTranslations({
  'DDL 내보내기': 'Export DDL',
  'SQL 다운로드': 'Download SQL',
  '새 SQL 만들기': 'Regenerate SQL',
  '프로젝트 전체 물리 설계': 'Entire project physical design',
  '설계 버전': 'Design version',
  '물리 설계의 확인 항목을 수정한 뒤 다시 내보내 주세요.':
    'Review the physical design issues and export again.',
  'MySQL 실행 연결의 문자집합과 SQL mode를 설정합니다.':
    'Sets the MySQL execution connection character set and SQL mode.',
  'SQLite 설명은 SQL 주석으로 보존됩니다.': 'SQLite descriptions are preserved as SQL comments.',
  '기존 타입·기본값·네임스페이스를 확인해 주세요.':
    'Review the original types, defaults and namespaces.',
  '프로젝트 형식을 업그레이드하고 물리 설계를 확인해 주세요.':
    'Upgrade the project format and review its physical design.',
  '이름과 컬럼·참조를 완성해 주세요.': 'Complete the names, columns and references.',
  '현재 DB에서 사용 가능한 타입·기능을 선택해 주세요.':
    'Choose types and features available for the current database.',
  '설계가 변경되었습니다. 새 SQL을 만들어 주세요.': 'The design changed. Regenerate SQL.',
  '프로젝트가 변경되었습니다. 최신 프로젝트에서 다시 내보내 주세요.':
    'The project changed. Export again from the current project.',
  '보관된 미저장 입력 또는 미확인 저장 요청을 확인한 뒤 다시 내보내 주세요.':
    'Review unsaved input or unconfirmed save requests before exporting.',
});
export function ProjectDDLDialog({
  result,
  onClose,
  onRegenerate,
  onDownload,
  objectName,
  onFocusIssue,
}: {
  result: ProjectDDLExport;
  onClose: () => void;
  onRegenerate: () => Promise<void>;
  onDownload: () => Promise<void>;
  objectName?: (id: string) => string;
  onFocusIssue?: (id: string) => void;
}) {
  const { t } = useI18n(),
    dialog = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const profile = getDatabaseProfile(result.database);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const describe = (code: string, fallback?: string | number | boolean) =>
    code === 'ddl.mysql-session-settings'
      ? t('MySQL 실행 연결의 문자집합과 SQL mode를 설정합니다.')
      : code === 'ddl.comments-as-sql-comments'
        ? t('SQLite 설명은 SQL 주석으로 보존됩니다.')
        : code.startsWith('legacy.')
          ? t('기존 타입·기본값·네임스페이스를 확인해 주세요.')
          : code === 'document.native-upgrade-required'
            ? t('프로젝트 형식을 업그레이드하고 물리 설계를 확인해 주세요.')
            : code.endsWith('not-implemented')
              ? t('현재 DB에서 사용 가능한 타입·기능을 선택해 주세요.')
              : typeof fallback === 'string'
                ? fallback
                : t('이름과 컬럼·참조를 완성해 주세요.');
  async function act(callback: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await callback();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'ddl.snapshot-changed'
          ? t('설계가 변경되었습니다. 새 SQL을 만들어 주세요.')
          : message(cause),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="project-ddl-dialog"
      aria-labelledby="project-ddl-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="project-ddl-title">{t('DDL 내보내기')}</h2>
      <p>
        {result.projectName} ·{' '}
        {profile.kind === 'postgresql'
          ? 'PostgreSQL'
          : profile.kind === 'mysql'
            ? 'MySQL'
            : 'SQLite'}{' '}
        {profile.targetVersion} · {t('설계 버전')} {result.version}
      </p>
      <p>
        {t('프로젝트 전체 물리 설계')} · {result.filename} · UTF-8
      </p>
      {!result.canExport && (
        <p role="alert">{t('물리 설계의 확인 항목을 수정한 뒤 다시 내보내 주세요.')}</p>
      )}
      <ul>
        {result.issues.map((issue, i) => (
          <li key={i}>
            {issue.objectId && onFocusIssue ? (
              <Button
                onClick={() => {
                  onFocusIssue(issue.objectId!);
                  onClose();
                }}
              >
                {objectName?.(issue.objectId) || issue.objectId}:{' '}
                {describe(issue.code, issue.params.message)}
              </Button>
            ) : (
              <>
                {issue.objectId && (objectName?.(issue.objectId) || issue.objectId) + ': '}
                {describe(issue.code, issue.params.message)}
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <Button disabled={busy} onClick={() => void act(onRegenerate)}>
          {t('새 SQL 만들기')}
        </Button>
        <Button disabled={busy || !result.canExport} onClick={() => void act(onDownload)}>
          {t('SQL 다운로드')}
        </Button>
        <Button disabled={busy} onClick={onClose}>
          {t('닫기')}
        </Button>
      </div>
    </dialog>
  );
}

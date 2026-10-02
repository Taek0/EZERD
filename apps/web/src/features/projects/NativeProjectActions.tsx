import { useState } from 'react';
import { Dropdown, IconButton } from '../../components/ui/index.js';
import { message } from '../../shared/api/client.js';
import { useI18n } from '../../shared/i18n/index.js';
import { useNativeExportBlocked } from './native-export-state.js';
export function NativeProjectActions({
  onExportProject,
  onExportDDL,
  userId,
  projectId,
}: {
  onExportProject: () => Promise<void>;
  onExportDDL: () => Promise<void>;
  userId: string;
  projectId: string;
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const blocked = useNativeExportBlocked(userId, projectId);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dropdown
        label={t('공유')}
        trigger={
          <IconButton
            aria-label={t('공유')}
            disabled={busy || blocked}
            aria-busy={busy}
            title={blocked ? t('변경 내용이 저장된 뒤 다시 내보내 주세요.') : t('공유')}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
            </svg>
          </IconButton>
        }
        items={[
          {
            id: 'project-export',
            label: t('프로젝트 내보내기'),
            disabled: busy,
            onAction: () => void run(onExportProject),
          },
          {
            id: 'ddl-export',
            label: t('DDL 내보내기'),
            disabled: busy,
            onAction: () => void run(onExportDDL),
          },
        ]}
      />
      {error && <span role="alert">{error}</span>}
    </>
  );
}

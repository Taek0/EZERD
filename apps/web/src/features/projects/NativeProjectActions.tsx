import './generic-translations.js';
import { useState } from 'react';
import { Dropdown, IconButton } from '../../components/ui/index.js';
import { message } from '../../shared/api/client.js';
import { useI18n } from '../../shared/i18n/index.js';
import { useNativeExportBlocked } from './native-export-state.js';
export function NativeProjectActions({
  onExportProject,
  onExportDDL,
  ddlDisabled = false,
  userId,
  projectId,
  png,
}: {
  onExportProject: () => Promise<void>;
  onExportDDL: () => Promise<void>;
  ddlDisabled?: boolean;
  userId: string;
  projectId: string;
  png?:
    | { run: () => Promise<void>; runPdf?: () => Promise<void>; disabled: boolean; busy: boolean }
    | undefined;
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
            disabled={busy || blocked || png?.busy}
            aria-busy={busy || png?.busy}
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
            label: t(ddlDisabled ? 'DDL 내보내기 · DB 선택 필요' : 'DDL 내보내기'),
            disabled: busy || ddlDisabled,
            onAction: () => {
              if (!ddlDisabled) void run(onExportDDL);
            },
          },
          ...(png
            ? [
                {
                  id: 'png-export',
                  label: t('고화질 PNG'),
                  disabled: busy || png.disabled,
                  onAction: () => void run(png.run),
                },
              ]
            : []),
          ...(png?.runPdf
            ? [
                {
                  id: 'pdf-export',
                  label: t('PDF 내보내기 · 한 페이지'),
                  disabled: busy || png.disabled,
                  onAction: () => void run(png.runPdf!),
                },
              ]
            : []),
        ]}
      />
      {error && <span role="alert">{error}</span>}
    </>
  );
}

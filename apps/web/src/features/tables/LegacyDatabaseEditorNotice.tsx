import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  isNonPostgresLegacy,
  type LegacyDatabaseEditorContext,
} from './legacy-database-editor-policy.js';
registerTranslations({
  '기존 형식의 타입·현재 값은 보존됩니다. DB 전용 타입과 새 기능은 native 설계에서 사용해 주세요.':
    'Existing types and values are preserved. Use a native design for database-specific types and new features.',
  'native 설계로 업그레이드': 'Upgrade to a native design',
});
export function LegacyDatabaseEditorNotice({
  databaseKind,
  onRequestNativeUpgrade,
  readOnly = false,
}: LegacyDatabaseEditorContext & { readOnly?: boolean }) {
  const { t } = useI18n();
  if (!isNonPostgresLegacy(databaseKind)) return null;
  return (
    <div className="panel-note" data-legacy-database={databaseKind}>
      <p>
        {t(
          '기존 형식의 타입·현재 값은 보존됩니다. DB 전용 타입과 새 기능은 native 설계에서 사용해 주세요.',
        )}
      </p>
      <Button
        disabled={readOnly || !onRequestNativeUpgrade}
        onClick={() => {
          if (!readOnly) onRequestNativeUpgrade?.();
        }}
      >
        {t('native 설계로 업그레이드')}
      </Button>
    </div>
  );
}

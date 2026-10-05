import { memo, useState } from 'react';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
export interface NativeDomainFilterValue {
  domainIds: string[];
  unassigned: boolean;
}
registerTranslations({
  '도메인 필터': 'Domain filter',
  '전체 테이블 표시': 'Show all tables',
  미지정: 'Unassigned',
  적용: 'Apply',
  '필터 해제': 'Clear filter',
  '필터는 표시만 바꿉니다. PNG는 저장된 화면을 내보냅니다.':
    'Filters change only the display. PNG exports the saved view.',
});
export const NativeDomainFilter = memo(function NativeDomainFilter({
  domains,
  value,
  onChange,
  disabled = false,
}: {
  domains: { id: string; name: string }[];
  value: NativeDomainFilterValue | null;
  onChange: (value: NativeDomainFilterValue | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<NativeDomainFilterValue>({ domainIds: [], unassigned: true });
  return (
    <details
      className="native-domain-filter"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.removeAttribute('open');
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          event.currentTarget.removeAttribute('open');
      }}
      onToggle={(event) => {
        if (event.currentTarget.open)
          setDraft(value ?? { domainIds: domains.map((d) => d.id), unassigned: true });
      }}
    >
      <summary
        className={value ? 'active' : ''}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {t('도메인 필터')}
        {value ? ` · ${value.domainIds.length}` : ''}
      </summary>
      <div className="native-domain-filter-popover">
        <strong>{t('도메인 필터')}</strong>
        <p>{t('필터는 표시만 바꿉니다. PNG는 저장된 화면을 내보냅니다.')}</p>
        <label>
          <input
            type="checkbox"
            disabled={disabled}
            checked={draft.domainIds.length === domains.length && draft.unassigned}
            onChange={(e) =>
              setDraft({
                domainIds: e.target.checked ? domains.map((d) => d.id) : [],
                unassigned: e.target.checked,
              })
            }
          />
          {t('전체 테이블 표시')}
        </label>
        {domains.map((d) => (
          <label key={d.id}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={draft.domainIds.includes(d.id)}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  domainIds: e.target.checked
                    ? [...prev.domainIds, d.id]
                    : prev.domainIds.filter((id) => id !== d.id),
                }))
              }
            />
            {d.name}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            disabled={disabled}
            checked={draft.unassigned}
            onChange={(e) => setDraft((prev) => ({ ...prev, unassigned: e.target.checked }))}
          />
          {t('미지정')}
        </label>
        <Button
          disabled={disabled}
          onClick={(e) => {
            onChange(draft.domainIds.length === domains.length && draft.unassigned ? null : draft);
            e.currentTarget.closest('details')?.removeAttribute('open');
          }}
        >
          {t('적용')}
        </Button>
        <Button
          disabled={disabled}
          onClick={(e) => {
            onChange(null);
            e.currentTarget.closest('details')?.removeAttribute('open');
          }}
        >
          {t('필터 해제')}
        </Button>
      </div>
    </details>
  );
});

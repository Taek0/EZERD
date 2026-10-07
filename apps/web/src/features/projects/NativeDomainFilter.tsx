import { memo, useState } from 'react';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { UntitledPopover } from '../../components/ui/untitled.js';
import { Button, Checkbox } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
export interface NativeDomainFilterValue {
  domainIds: string[];
  unassigned: boolean;
}
registerTranslations({
  '도메인 뷰': 'Domain view',
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
  domains: { id: string; name: string; color?: string | null | undefined }[];
  value: NativeDomainFilterValue | null;
  onChange: (value: NativeDomainFilterValue | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<NativeDomainFilterValue>({ domainIds: [], unassigned: true });
  const [open, setOpen] = useState(false);
  const [selectAll, setSelectAll] = useState(value === null);
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(value ?? { domainIds: domains.map((d) => d.id), unassigned: true });
          setSelectAll(value === null);
        }
      }}
    >
      <Button
        disabled={disabled}
        aria-label={`${t('도메인 필터')}${value ? ` · ${value.domainIds.length + Number(value.unassigned)}` : ''}`}
        title={
          value
            ? [
                ...domains
                  .filter((domain) => value.domainIds.includes(domain.id))
                  .map((domain) => domain.name),
                ...(value.unassigned ? [t('미지정')] : []),
              ].join(' · ') || t('선택 없음')
            : t('전체 테이블 표시')
        }
        className={`native-toolbar-action domain-view-trigger${value ? ' is-active' : ''}`}
      >
        {t('도메인 필터')}
      </Button>
      <UntitledPopover
        className="domain-view-popover"
        placement="bottom start"
        shouldFlip={false}
        offset={8}
      >
        <Dialog aria-label={t('도메인 필터')} className="combined-view-picker">
          <strong>{t('도메인 필터')}</strong>
          <p className="panel-note">
            {t('필터는 내 화면에만 적용됩니다. 테이블 위치와 편집 내용은 모두 공유됩니다.')}
          </p>
          <div className="combined-domain-options">
            <label className="combined-select-all">
              <Checkbox
                disabled={disabled}
                aria-label={t('전체 테이블 표시')}
                checked={selectAll}
                onChange={(e) => {
                  setSelectAll(e.target.checked);
                  setDraft({
                    domainIds: e.target.checked ? domains.map((d) => d.id) : [],
                    unassigned: e.target.checked,
                  });
                }}
              />
              {t('전체 테이블 표시')}
            </label>
            {domains.map((d) => (
              <label key={d.id}>
                <Checkbox
                  disabled={disabled}
                  aria-label={d.name}
                  checked={draft.domainIds.includes(d.id)}
                  onChange={(e) => {
                    setSelectAll(false);
                    setDraft((prev) => ({
                      ...prev,
                      domainIds: e.target.checked
                        ? [...prev.domainIds, d.id]
                        : prev.domainIds.filter((id) => id !== d.id),
                    }));
                  }}
                />
                <span style={{ color: d.color ?? '#8993a3' }}>●</span>
                {d.name}
              </label>
            ))}
            <label>
              <Checkbox
                disabled={disabled}
                aria-label={t('미지정')}
                checked={draft.unassigned}
                onChange={(e) => {
                  setSelectAll(false);
                  setDraft((prev) => ({ ...prev, unassigned: e.target.checked }));
                }}
              />
              {t('미지정')}
            </label>
          </div>
          <div className="actions">
            <Button
              variant="primary"
              disabled={disabled}
              onClick={() => {
                onChange(selectAll ? null : draft);
                setOpen(false);
              }}
            >
              {t('적용')}
            </Button>
            <Button
              disabled={disabled}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {t('필터 해제')}
            </Button>
            <Button onClick={() => setOpen(false)}>{t('닫기')}</Button>
          </div>
        </Dialog>
      </UntitledPopover>
    </DialogTrigger>
  );
});

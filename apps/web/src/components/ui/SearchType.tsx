/** Untitled UI React Combobox adaptation (MIT © 2025 Untitled UI).
 * Source c981a73bcd6b6c68d2a54070f20f020191212828/components/base/select/combobox.tsx.
 * Uses the same Group/Input/Popover/ListBox tree and shared local recipes. */
import { useEffect, useRef, useState } from 'react';
import { ComboBox, Group, Input, ListBox } from 'react-aria-components';
import { UntitledPopover, UntitledSelectItem } from './untitled.js';
import { useI18n } from '../../shared/i18n/index.js';
import './translations.js';
import './search-type.css';
export function SearchType({
  value,
  onValueChange,
  options,
  label,
  disabled = false,
  autoFocus = false,
  showSearchIcon = true,
  onEditEnd,
  query,
  onQueryChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  showSearchIcon?: boolean;
  onEditEnd?: (reason: 'blur' | 'escape' | 'selection') => void;
  query?: string | undefined;
  onQueryChange?: (query: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const selectInitialFocus = useRef(true);
  const { t } = useI18n();
  const [blocked, setBlocked] = useState(false);
  const [container, setContainer] = useState<HTMLElement>();
  const selectedLabel = options.find((option) => option.value === value)?.label.toUpperCase() ?? '';
  const [inputValue, setInputValue] = useState(selectedLabel);
  useEffect(() => setInputValue(selectedLabel), [value, selectedLabel]);
  useEffect(() => {
    const fieldset = root.current?.closest('fieldset');
    const sync = () => setBlocked(!!fieldset?.disabled);
    sync();
    const observer = new MutationObserver(sync);
    if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] });
    const dialog = root.current?.closest('dialog');
    if (dialog) setContainer(dialog);
    return () => observer.disconnect();
  }, []);
  return (
    <ComboBox
      ref={root}
      className="ui-search-type"
      aria-label={label}
      selectedKey={value}
      inputValue={query ?? inputValue}
      onInputChange={setInputValue}
      onSelectionChange={(key) => {
        if (key !== null) {
          setInputValue(
            options.find((option) => option.value === String(key))?.label.toUpperCase() ?? '',
          );
          onValueChange(String(key));
          onEditEnd?.('selection');
        }
      }}
      onBlur={() => onEditEnd?.('blur')}
      defaultItems={options}
      menuTrigger="focus"
      isDisabled={disabled || blocked}
      allowsCustomValue={false}
    >
      <Group className="ui-input-group">
        {showSearchIcon && (
          <svg
            className="ui-search-type-icon"
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
          >
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
        <Input
          className="ui-input"
          placeholder={t('타입 검색')}
          autoFocus={autoFocus}
          onChange={(event) => {
            selectInitialFocus.current = false;
            onQueryChange?.(event.currentTarget.value);
          }}
          onFocus={(event) => {
            // Opening the popover can restore input focus after the first key.
            // Never reselect text that the user has already started entering.
            if (!selectInitialFocus.current) return;
            selectInitialFocus.current = false;
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && onEditEnd) {
              event.stopPropagation();
              onEditEnd('escape');
            }
          }}
        />
      </Group>
      <UntitledPopover {...(container ? { UNSTABLE_portalContainer: container } : {})}>
        <ListBox<{ value: string; label: string }>
          className="ui-select-list"
          renderEmptyState={() => t('검색 결과가 없습니다.')}
        >
          {(item) => <UntitledSelectItem id={item.value} label={item.label.toUpperCase()} />}
        </ListBox>
      </UntitledPopover>
    </ComboBox>
  );
}

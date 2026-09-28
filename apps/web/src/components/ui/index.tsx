/**
 * EZERD adaptations of Untitled UI React (MIT), copyright (c) 2025 Untitled UI.
 * Upstream c981a73bcd6b6c68d2a54070f20f020191212828. See NOTICE.md.
 * Active upstream-derived runtime trees live in untitled.tsx; CSS recipes in untitled.css.
 */
import { AnimatedDetails } from './AnimatedDetails.js';
import { useI18n } from '../../shared/i18n/index.js';
import './translations.js';
export { AnimatedDetails } from './AnimatedDetails.js';
import {
  Children,
  Fragment,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DetailsHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type ComponentProps,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  Button as AriaButton,
  Select as AriaSelect,
  SelectValue,
  ListBox,
  ListBoxSection,
  Header,
  MenuTrigger,
} from 'react-aria-components';
import {
  cx,
  ChevronDown,
  UntitledButton,
  UntitledInputBase,
  UntitledTextAreaBase,
  CheckboxBase,
  UntitledPopover,
  UntitledSelectItem,
  UntitledMenu as AriaMenu,
  UntitledMenuItem as AriaMenuItem,
  UntitledTooltip,
} from './untitled';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost';
  size?: 'xs' | 'sm' | 'md';
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'sm',
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <UntitledButton
      {...(props as ComponentProps<typeof UntitledButton>)}
      ref={ref}
      type={type}
      isDisabled={!!disabled}
      loading={loading}
      size={size}
      color={variant}
      className={className}
    >
      {children}
    </UntitledButton>
  );
});
export function Tooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
  return <UntitledTooltip content={content}>{children}</UntitledTooltip>;
}
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { 'aria-label': string; tooltip?: string }
>(function IconButton({ tooltip, className, ...props }, ref) {
  const button = <Button {...props} ref={ref} className={cx('ui-icon-button', className)} />;
  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
});
export const Input = UntitledInputBase;
export const Textarea = UntitledTextAreaBase;

interface OptionRecord {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
}
function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : String(child),
    )
    .join('');
}
function readOptions(children: ReactNode, group?: string, groupDisabled = false): OptionRecord[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === Fragment) return readOptions(child.props.children, group, groupDisabled);
    if (child.type === 'optgroup')
      return readOptions(
        child.props.children,
        child.props.label,
        groupDisabled || !!child.props.disabled,
      );
    if (child.type !== 'option') return [];
    const label = child.props.label ?? optionText(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: groupDisabled || !!child.props.disabled,
        ...(group === undefined ? {} : { group }),
      },
    ];
  });
}
export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  | 'onChange'
  | 'value'
  | 'defaultValue'
  | 'multiple'
  | 'size'
  | 'onFocus'
  | 'onBlur'
  | 'onKeyDown'
  | 'onClick'
> {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  invalid?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}
/** The visible control is Untitled's AriaSelect tree, never a native popup.
 * React Aria's hidden select preserves native form/autofill semantics. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    invalid,
    className,
    children,
    value,
    defaultValue,
    onValueChange,
    id,
    name,
    disabled,
    required,
    readOnly,
    placeholder,
    autoComplete,
    autoFocus,
    form,
    style,
    ...props
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const popoverRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [skipExitAnimation, setSkipExitAnimation] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const [fieldsetDisabled, setFieldsetDisabled] = useState(false);
  const blocked = !!disabled || fieldsetDisabled || !!readOnly;
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);
  const options = readOptions(children);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Native modal dialogs live in the top layer: keep overlays inside that dialog.
    setPortalContainer(root.closest('dialog') ?? undefined);
    const fieldsets: HTMLFieldSetElement[] = [];
    let parent = root.parentElement;
    while (parent) {
      if (parent instanceof HTMLFieldSetElement) fieldsets.push(parent);
      parent = parent.parentElement;
    }
    const update = () =>
      setFieldsetDisabled(
        fieldsets.some(
          (fieldset) =>
            fieldset.disabled && !fieldset.querySelector(':scope > legend')?.contains(root),
        ),
      );
    update();
    const observer = new MutationObserver(update);
    fieldsets.forEach((fieldset) =>
      observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] }),
    );
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const root = rootRef.current;
    if (!readOnly || !root) return;
    const preventEdit = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    root.addEventListener('keydown', preventEdit, true);
    return () => root.removeEventListener('keydown', preventEdit, true);
  }, [readOnly]);
  useEffect(() => {
    if (!open) return;
    // RAC's modal Popover contains focus while its exit animation runs. Tab must
    // leave the select in native DOM order, including Shift+Tab and fieldsets.
    // Dismiss synchronously for this key only, then let the browser move focus.
    const dismissOnTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !popoverRef.current?.contains(event.target as Node)) return;
      event.stopImmediatePropagation();
      const trigger = rootRef.current?.querySelector<HTMLButtonElement>('.ui-select');
      flushSync(() => {
        setSkipExitAnimation(true);
        setOpen(false);
      });
      trigger?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', dismissOnTab, true);
    return () => document.removeEventListener('keydown', dismissOnTab, true);
  }, [open]);
  const isInvalid = !!invalid || props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  const entries: { key: string; group?: string; options: OptionRecord[] }[] = [];
  options.forEach((option, index) => {
    const previous = entries[entries.length - 1];
    if (option.group !== undefined && previous?.group === option.group)
      previous.options.push(option);
    else
      entries.push({
        key: `${index}-${option.value}`,
        ...(option.group === undefined ? {} : { group: option.group }),
        options: [option],
      });
  });
  return (
    <AriaSelect
      ref={rootRef}
      className="ui-select-root"
      {...(id ? { id: `${id}-root` } : {})}
      {...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {})}
      {...(props['aria-labelledby'] ? { 'aria-labelledby': props['aria-labelledby'] } : {})}
      {...(props['aria-describedby'] ? { 'aria-describedby': props['aria-describedby'] } : {})}
      {...(name === undefined ? {} : { name })}
      {...(form === undefined ? {} : { form })}
      {...(autoComplete === undefined ? {} : { autoComplete })}
      isDisabled={disabled || fieldsetDisabled}
      isRequired={!!required}
      isInvalid={isInvalid}
      {...(value === undefined ? {} : { selectedKey: String(value) })}
      {...(defaultValue !== undefined
        ? { defaultSelectedKey: String(defaultValue) }
        : value === undefined && options[0]
          ? { defaultSelectedKey: options[0].value }
          : {})}
      onSelectionChange={(key) => {
        if (!blocked && key !== null) onValueChange?.(String(key));
      }}
      isOpen={open && !blocked}
      onOpenChange={(next) => {
        if (next && blocked) return;
        if (next) setSkipExitAnimation(false);
        setOpen(next);
      }}
    >
      <AriaButton
        {...(id ? { id } : {})}
        ref={ref}
        autoFocus={!!autoFocus}
        {...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {})}
        {...(props['aria-labelledby'] ? { 'aria-labelledby': props['aria-labelledby'] } : {})}
        {...(props['aria-describedby'] ? { 'aria-describedby': props['aria-describedby'] } : {})}
        aria-invalid={isInvalid}
        aria-readonly={!!readOnly}
        className={cx('ui-select', className)}
        {...(style ? { style } : {})}
      >
        <SelectValue className="ui-select-value">
          {({ selectedText }) => (
            <>
              <span>{selectedText || placeholder || t('선택')}</span>
              <ChevronDown className="ui-select-chevron" />
            </>
          )}
        </SelectValue>
      </AriaButton>
      <UntitledPopover
        ref={popoverRef}
        shouldSkipAnimation={skipExitAnimation}
        className="ui-select-popover"
        maxHeight={256}
        {...(portalContainer ? { UNSTABLE_portalContainer: portalContainer } : {})}
      >
        <ListBox className="ui-select-listbox" aria-label={props['aria-label'] ?? t('선택 항목')}>
          {entries.map((entry) =>
            entry.group !== undefined ? (
              <ListBoxSection key={entry.key}>
                <Header className="ui-select-group-label">{entry.group}</Header>
                {entry.options.map((option) => (
                  <UntitledSelectItem
                    key={option.value}
                    id={option.value}
                    label={option.label}
                    disabled={option.disabled}
                  />
                ))}
              </ListBoxSection>
            ) : (
              entry.options.map((option) => (
                <UntitledSelectItem
                  key={option.value}
                  id={option.value}
                  label={option.label}
                  disabled={option.disabled}
                />
              ))
            ),
          )}
        </ListBox>
      </UntitledPopover>
    </AriaSelect>
  );
});
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { indeterminate?: boolean }
>(function Checkbox({ indeterminate = false, className, style, ...props }, ref) {
  const localRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (localRef.current) localRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <span className="ui-checkbox-root" style={style}>
      <input
        {...props}
        type="checkbox"
        ref={(node) => {
          localRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className={cx('ui-checkbox', className)}
      />
      <CheckboxBase />
    </span>
  );
});
interface FieldChildProps {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;
  'aria-labelledby'?: string | undefined;
}
export function Field({
  label,
  hint,
  error,
  children,
  id,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<FieldChildProps>;
  id?: string;
  className?: string;
}) {
  const generated = useId();
  const inputId = children.props.id ?? id ?? `field-${generated}`;
  const describedBy =
    [
      children.props['aria-describedby'],
      hint ? `${inputId}-hint` : '',
      error ? `${inputId}-error` : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={cx('ui-field', className)}>
      {label && (
        <label id={`${inputId}-label`} htmlFor={inputId}>
          {label}
        </label>
      )}
      {isValidElement(children) &&
        cloneElement(children, {
          id: inputId,
          'aria-labelledby':
            children.props['aria-labelledby'] ?? (label ? `${inputId}-label` : undefined),
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : children.props['aria-invalid'],
        })}
      {hint && (
        <span id={`${inputId}-hint`} className="ui-field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${inputId}-error`} className="ui-field-error">
          {error}
        </span>
      )}
    </div>
  );
}
export function Badge({
  tone = 'blue',
  variant = 'subtle',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'blue' | 'neutral' | 'success' | 'warning' | 'danger';
  variant?: 'subtle' | 'plain';
}) {
  return (
    <span
      {...props}
      className={cx('ui-badge', `ui-badge--${tone}`, `ui-badge--${variant}`, className)}
    />
  );
}
export const DisclosureButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { expanded: boolean; controls: string }
>(function DisclosureButton({ expanded, controls, className, children, ...props }, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      aria-expanded={expanded}
      aria-controls={controls}
      className={cx('ui-disclosure', className)}
    >
      <ChevronDown className="ui-chevron" />
      {children}
    </Button>
  );
});
export function Collapse({
  open,
  id,
  children,
  className,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={cx('ui-collapse', className)}
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="ui-collapse-inner">{children}</div>
    </div>
  );
}
export function Accordion({
  title,
  children,
  className,
  ...props
}: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title'> & { title: ReactNode }) {
  return (
    <AnimatedDetails {...props} className={cx('ui-accordion', className)}>
      <summary>
        {title}
        <ChevronDown className="ui-chevron" />
      </summary>
      {children}
    </AnimatedDetails>
  );
}
export const TabButton = forwardRef<HTMLButtonElement, ButtonProps & { selected: boolean }>(
  function TabButton({ selected, className, ...props }, ref) {
    return (
      <Button
        {...props}
        ref={ref}
        aria-pressed={selected}
        className={cx('ui-tab-button', selected && 'is-selected', className)}
      />
    );
  },
);
export function Avatar({
  size,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { size?: 'xs' | 'sm' | 'md' }) {
  return <span {...props} className={cx('ui-avatar', size && `ui-avatar--${size}`, className)} />;
}
export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  onAction: () => void;
  disabled?: boolean;
  destructive?: boolean;
}
export interface ContextMenuProps {
  position: { x: number; y: number } | null;
  items: ContextMenuItem[];
  onClose: () => void;
  label?: string;
}
export function ContextMenu({ position, items, onClose, label = '메뉴' }: ContextMenuProps) {
  const { t } = useI18n();
  return position ? (
    <OpenContextMenu
      position={position}
      items={items}
      onClose={onClose}
      label={label === '메뉴' ? t('메뉴') : label}
    />
  ) : null;
}
function OpenContextMenu({
  position,
  items,
  onClose,
  label,
}: ContextMenuProps & { position: { x: number; y: number } }) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const acted = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const menu = container.current;
    if (menu) {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
    }
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        event.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      if (!acted.current && previous.current?.isConnected)
        previous.current.focus({ preventScroll: true });
    };
  }, [position.x, position.y]);
  return createPortal(
    <div
      ref={container}
      className="ui-context-menu"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="ui-menu-heading">{label}</div>
      <AriaMenu
        aria-label={label ?? t('메뉴')}
        autoFocus="first"
        className="ui-menu"
        onClose={onClose}
      >
        {items.map((item) => (
          <AriaMenuItem
            key={item.id}
            id={item.id}
            textValue={typeof item.label === 'string' ? item.label : item.id}
            isDisabled={!!item.disabled}
            className={cx('ui-menu-item', item.destructive && 'ui-menu-item--danger')}
            onAction={() => {
              acted.current = true;
              try {
                item.onAction();
              } finally {
                onClose();
              }
            }}
          >
            {item.label}
          </AriaMenuItem>
        ))}
      </AriaMenu>
    </div>,
    previous.current?.closest('dialog') ?? document.body,
  );
}

export function Dropdown({
  trigger,
  items,
  label = '메뉴',
}: {
  trigger: ReactElement;
  items: ContextMenuItem[];
  label?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const { t } = useI18n();
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  useLayoutEffect(() => {
    setPortalContainer(root.current?.closest('dialog') ?? undefined);
  }, []);
  return (
    <span className="ui-dropdown-root" ref={root}>
      <MenuTrigger>
        {trigger}
        <UntitledPopover
          className="ui-dropdown-popover"
          placement="bottom end"
          {...(portalContainer ? { UNSTABLE_portalContainer: portalContainer } : {})}
        >
          <AriaMenu aria-label={label === '메뉴' ? t('메뉴') : label} className="ui-menu">
            {items.map((item) => (
              <AriaMenuItem
                key={item.id}
                id={item.id}
                textValue={typeof item.label === 'string' ? item.label : item.id}
                isDisabled={!!item.disabled}
                className={item.destructive ? 'ui-menu-item--danger' : undefined}
                onAction={item.onAction}
              >
                {item.label}
              </AriaMenuItem>
            ))}
          </AriaMenu>
        </UntitledPopover>
      </MenuTrigger>
    </span>
  );
}

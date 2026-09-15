/**
 * Runtime adaptations of Untitled UI React, MIT © 2025 Untitled UI.
 * Source c981a73bcd6b6c68d2a54070f20f020191212828; see NOTICE.md.
 * The upstream component trees and state/size recipes are translated to explicit
 * CSS in untitled.css. Unused icons, avatar variants and PRO components are omitted.
 */
import {
  Children,
  isValidElement,
  forwardRef,
  type ComponentProps,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  Button as AriaButton,
  Group,
  Input as AriaInput,
  TextArea as AriaTextArea,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  Popover as AriaPopover,
  ListBoxItem,
  Text,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
} from 'react-aria-components';

export const cx = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');
// Original local glyphs replace the upstream @untitledui/icons package.
export function ChevronDown({ className }: { className?: string | undefined }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="m5 7.5 5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.67"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Check({ className }: { className?: string | undefined }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="m4 10 4 4 8-8"
        stroke="currentColor"
        strokeWidth="1.67"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function buttonText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? buttonText(child.props.children)
        : String(child),
    )
    .join('');
}
/** buttons/button.tsx: button branch, size/color recipes and loading tree. */
export const UntitledButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof AriaButton>, 'className' | 'children'> & {
    className?: string | undefined;
    children?: ReactNode;
    size?: 'xs' | 'sm' | 'md';
    color?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost';
    loading?: boolean;
  }
>(function UntitledButton(
  { size = 'sm', color = 'secondary', loading = false, className, children, isDisabled, ...props },
  ref,
) {
  const accessibleLoadingLabel = loading && !props['aria-label'] ? buttonText(children) : '';
  return (
    <AriaButton
      {...props}
      {...(accessibleLoadingLabel ? { 'aria-label': accessibleLoadingLabel } : {})}
      ref={ref}
      isDisabled={isDisabled || loading}
      isPending={loading}
      data-loading={loading || undefined}
      className={cx('ui-button', `ui-button--${size}`, `ui-button--${color}`, className)}
    >
      {loading && (
        <svg
          fill="none"
          aria-hidden="true"
          data-icon="loading"
          viewBox="0 0 20 20"
          className="ui-spinner"
        >
          <circle opacity=".3" cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
          <circle
            className="ui-spinner-circle"
            cx="10"
            cy="10"
            r="8"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="12.5 50"
            strokeLinecap="round"
          />
        </svg>
      )}
      {children && <span data-text>{children}</span>}
    </AriaButton>
  );
});

/** input/input.tsx InputBase: Group ring + transparent real input. */
export const UntitledInputBase = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function UntitledInputBase({ invalid, className, ...props }, ref) {
  const isInvalid = !!invalid || props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return (
    <Group isDisabled={!!props.disabled} isInvalid={isInvalid} className="ui-input-group">
      <AriaInput
        {...(props as ComponentProps<typeof AriaInput>)}
        ref={ref}
        aria-invalid={isInvalid || undefined}
        className={cx('ui-input', className)}
      />
      {isInvalid && (
        <svg className="ui-input-error-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6v4m0 3v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </Group>
  );
});
/** textarea/textarea.tsx TextAreaBase, with native ref/form API. */
export const UntitledTextAreaBase = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function UntitledTextAreaBase({ invalid, className, ...props }, ref) {
  return (
    <AriaTextArea
      {...(props as ComponentProps<typeof AriaTextArea>)}
      ref={ref}
      aria-invalid={invalid || props['aria-invalid']}
      className={cx('ui-textarea', className)}
    />
  );
});

/** checkbox/checkbox.tsx CheckboxBase. The native sibling supplies its state. */
export function CheckboxBase() {
  return (
    <span aria-hidden="true" className="ui-checkbox-indicator">
      <svg className="ui-checkbox-minus" viewBox="0 0 14 14" fill="none">
        <path
          d="M2.91675 7H11.0834"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg className="ui-checkbox-check" viewBox="0 0 14 14" fill="none">
        <path
          d="M11.6666 3.5L5.24992 9.91667L2.33325 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** select/popover.tsx: trigger-width popup, 150ms in / 100ms out. */
export function UntitledPopover({
  className,
  ...props
}: Omit<ComponentProps<typeof AriaPopover>, 'className'> & { className?: string | undefined }) {
  return (
    <AriaPopover
      placement="bottom"
      containerPadding={8}
      offset={4}
      {...props}
      className={cx('ui-popover', className)}
    />
  );
}
/** select/select-item.tsx: nested padded row, label and trailing selection. */
export function UntitledSelectItem({
  id,
  label,
  disabled = false,
}: {
  id: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <ListBoxItem id={id} textValue={label} isDisabled={disabled} className="ui-select-item">
      {({ isSelected }) => (
        <div className="ui-select-item-content">
          <Text slot="label">{label}</Text>
          {isSelected && <Check className="ui-select-check" />}
        </div>
      )}
    </ListBoxItem>
  );
}
/** dropdown/dropdown.tsx: menu and item branches used by both menu entry points. */
export const UntitledMenu = AriaMenu;
export function UntitledMenuItem({
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof AriaMenuItem>, 'className' | 'children'> & {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <AriaMenuItem {...props} className={cx('ui-menu-item', className)}>
      <div className="ui-menu-item-content">
        <span>{children}</span>
      </div>
    </AriaMenuItem>
  );
}
/** tooltip/tooltip.tsx: trigger delay, title container and zoom/fade motion. */
export function UntitledTooltip({
  children,
  content,
}: {
  children: ReactNode;
  content: ReactNode;
}) {
  return (
    <TooltipTrigger delay={300} closeDelay={0}>
      {children}
      <AriaTooltip className="ui-tooltip" offset={6} placement="top">
        <div className="ui-tooltip-content">
          <span>{content}</span>
        </div>
      </AriaTooltip>
    </TooltipTrigger>
  );
}

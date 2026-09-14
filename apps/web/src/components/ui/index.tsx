/**
 * EZERD adaptations of Untitled UI React (MIT), copyright (c) 2025 Untitled UI.
 * Upstream c981a73bcd6b6c68d2a54070f20f020191212828. See NOTICE.md.
 * Native adapters preserve EZERD event/ref contracts and compact page geometry.
 */
import { cloneElement, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type DetailsHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
// Original geometric glyph; no third-party icon asset or icon-library source.
function ChevronDown(props: {className?: string; 'aria-hidden'?: 'true'}) {
  return <svg {...props} viewBox="0 0 16 16" fill="none" focusable="false"><path d="M4 6 L8 10 L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
import { twMerge } from 'tailwind-merge';

const cx = (...values: (string | false | undefined)[]) => twMerge(values.filter(Boolean).join(' '));
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost';
  size?: 'xs' | 'sm' | 'md';
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({variant, size, loading=false, disabled, className, children, type='button', ...props}, ref) {
  // AriaButton supplies press/focus state and TooltipTrigger context; onClick remains native.
  return <AriaButton {...(props as ComponentProps<typeof AriaButton>)} ref={ref} type={type} isDisabled={disabled || loading} isPending={loading} data-loading={loading || undefined} className={cx('ui-button', variant && `ui-button--${variant}`, size && `ui-button--${size}`, className)}>
    {children}{loading && <svg className="ui-spinner" aria-hidden="true" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="12.5 50" strokeLinecap="round" /></svg>}
  </AriaButton>;
});
export function Tooltip({children,content}: {children:ReactElement;content:ReactNode}) {
  return <TooltipTrigger delay={300} closeDelay={0}>{children}<AriaTooltip className="ui-tooltip" offset={6} placement="top">{content}</AriaTooltip></TooltipTrigger>;
}
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & {'aria-label':string;tooltip?:string}>(function IconButton({tooltip,className,...props},ref) {
  const button = <Button {...props} ref={ref} className={cx('ui-icon-button',className)} />;
  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
});
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {invalid?:boolean}>(function Input({invalid,className,...props},ref) {
  return <input {...props} ref={ref} aria-invalid={invalid || props['aria-invalid']} className={cx('ui-input',className)} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & {invalid?:boolean}>(function Textarea({invalid,className,...props},ref) {
  return <textarea {...props} ref={ref} aria-invalid={invalid || props['aria-invalid']} className={cx('ui-textarea',className)} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & {invalid?:boolean}>(function Select({invalid,className,...props},ref) {
  return <select {...props} ref={ref} aria-invalid={invalid || props['aria-invalid']} className={cx('ui-select',className)} />;
});
export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>,'type'> & {indeterminate?:boolean}>(function Checkbox({indeterminate=false,className,...props},ref) {
  const localRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(localRef.current) localRef.current.indeterminate=indeterminate;},[indeterminate]);
  return <input {...props} type="checkbox" ref={node=>{localRef.current=node;if(typeof ref==='function')ref(node);else if(ref)ref.current=node;}} className={cx('ui-checkbox',className)} />;
});
interface FieldChildProps {id?:string | undefined;'aria-describedby'?:string | undefined;'aria-invalid'?:boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined}
export function Field({label,hint,error,children,id,className}: {label?:ReactNode;hint?:ReactNode;error?:ReactNode;children:ReactElement<FieldChildProps>;id?:string;className?:string}) {
  const generated=useId();
  const inputId=children.props.id ?? id ?? `field-${generated}`;
  const describedBy=[children.props['aria-describedby'],hint ? `${inputId}-hint` : '',error ? `${inputId}-error` : ''].filter(Boolean).join(' ') || undefined;
  return <div className={cx('ui-field',className)}>{label && <label htmlFor={inputId}>{label}</label>}{isValidElement(children) && cloneElement(children,{id:inputId,'aria-describedby':describedBy,'aria-invalid':error ? true : children.props['aria-invalid']})}{hint && <span id={`${inputId}-hint`} className="ui-field-hint">{hint}</span>}{error && <span id={`${inputId}-error`} className="ui-field-error">{error}</span>}</div>;
}
export function Badge({tone='blue',variant='subtle',className,...props}:HTMLAttributes<HTMLSpanElement> & {tone?:'blue'|'neutral'|'success'|'warning'|'danger';variant?:'subtle'|'plain'}) {
  return <span {...props} className={cx('ui-badge',`ui-badge--${tone}`,`ui-badge--${variant}`,className)} />;
}
export const DisclosureButton=forwardRef<HTMLButtonElement,ButtonProps & {expanded:boolean;controls:string}>(function DisclosureButton({expanded,controls,className,children,...props},ref) {
  return <Button {...props} ref={ref} aria-expanded={expanded} aria-controls={controls} className={cx('ui-disclosure',className)}><ChevronDown aria-hidden="true" className="ui-chevron" />{children}</Button>;
});
export function Collapse({open,id,children,className}: {open:boolean;id:string;children:ReactNode;className?:string}) {
  return <div id={id} className={cx('ui-collapse',className)} data-open={open} aria-hidden={!open} inert={!open}><div className="ui-collapse-inner">{children}</div></div>;
}
export function Accordion({title,children,className,...props}:Omit<DetailsHTMLAttributes<HTMLDetailsElement>,'title'> & {title:ReactNode}) {
  return <details {...props} className={cx('ui-accordion',className)}><summary>{title}<ChevronDown aria-hidden="true" className="ui-chevron" /></summary>{children}</details>;
}
export const TabButton=forwardRef<HTMLButtonElement,ButtonProps & {selected:boolean}>(function TabButton({selected,className,...props},ref) {
  return <Button {...props} ref={ref} aria-pressed={selected} className={cx('ui-tab-button',selected && 'is-selected',className)} />;
});
export function Avatar({size,className,...props}:HTMLAttributes<HTMLSpanElement> & {size?:'xs'|'sm'|'md'}) {
  return <span {...props} className={cx('ui-avatar',size && `ui-avatar--${size}`,className)} />;
}
export interface ContextMenuItem {id:string;label:ReactNode;onAction:()=>void;disabled?:boolean;destructive?:boolean}
export interface ContextMenuProps {position:{x:number;y:number}|null;items:ContextMenuItem[];onClose:()=>void;label?:string}
export function ContextMenu({position,items,onClose,label='메뉴'}:ContextMenuProps) {
  return position ? <OpenContextMenu position={position} items={items} onClose={onClose} label={label} /> : null;
}
function OpenContextMenu({position,items,onClose,label}:ContextMenuProps & {position:{x:number;y:number}}) {
  const container=useRef<HTMLDivElement>(null);
  const previous=useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const acted=useRef(false);
  const close=useRef(onClose);close.current=onClose;
  useLayoutEffect(()=>{

    const menu=container.current;
    if(menu){const rect=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(position.x,window.innerWidth-rect.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(position.y,window.innerHeight-rect.height-8))}px`;}
    const outside=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))close.current();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'||event.key==='Tab'){if(event.key==='Escape')event.preventDefault();event.stopPropagation();close.current();}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);
    return ()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);if(!acted.current && previous.current?.isConnected)previous.current.focus({preventScroll:true});};
  },[position.x,position.y]);
  return createPortal(<div ref={container} className="ui-context-menu" style={{left:position.x,top:position.y}} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>
    <div className="ui-menu-heading">{label}</div><AriaMenu aria-label={label ?? '메뉴'} autoFocus="first" className="ui-menu" onClose={onClose}>{items.map(item=><AriaMenuItem key={item.id} id={item.id} textValue={typeof item.label==='string'?item.label:item.id} isDisabled={!!item.disabled} className={cx('ui-menu-item',item.destructive && 'ui-menu-item--danger')} onAction={()=>{acted.current=true;try{item.onAction();}finally{onClose();}}}>{item.label}</AriaMenuItem>)}</AriaMenu>
  </div>,document.body);
}






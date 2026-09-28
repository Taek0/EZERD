import { useLayoutEffect, useRef, useState, type ReactNode, type HTMLAttributes } from 'react';
import { Accordion, Button } from '../../components/ui/index.js';

/**
 * One collapsible group style for the editor sidebar. Content stays in the DOM
 * so counts, search results and accessibility names remain stable while closed.
 */
export function PanelSection({
  title,
  count,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: {
  title: ReactNode;
  count?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const state =
    open === undefined
      ? { open: defaultOpen }
      : {
          open,
          onToggle: (event: { currentTarget: HTMLDetailsElement }) =>
            onOpenChange?.(event.currentTarget.open),
        };
  return (
    <Accordion
      {...state}
      className={['panel-section', className].filter(Boolean).join(' ')}
      title={
        <span className="panel-section-title">
          {title}
          {count === undefined ? null : <span className="panel-count">{count}</span>}
        </span>
      }
    >
      <div className="panel-section-body">{children}</div>
    </Accordion>
  );
}

export function PanelNote({ children }: { children: ReactNode }) {
  return <p className="panel-note">{children}</p>;
}

export function PanelList({ empty, children }: { empty: ReactNode; children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return items.length ? <ul className="panel-list">{items}</ul> : <PanelNote>{empty}</PanelNote>;
}

export function PanelRow({
  title,
  meta,
  badge,
  accent,
  active = false,
  onSelect,
  action,
  drag,
  className,
  expanded,
  controls,
}: {
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  accent?: string;
  active?: boolean;
  onSelect: () => void;
  action?: ReactNode;
  className?: string;
  expanded?: boolean;
  controls?: string | undefined;
  drag?: Pick<
    HTMLAttributes<HTMLLIElement>,
    'draggable' | 'onDragStart' | 'onDragOver' | 'onDrop' | 'onDragEnd' | 'onDragLeave'
  >;
}) {
  return (
    <li
      {...drag}
      className={['panel-row', active ? 'is-active' : '', className].filter(Boolean).join(' ')}
    >
      <Button
        className="panel-row-main"
        aria-current={active || undefined}
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onSelect}
      >
        {accent ? (
          <span className="panel-row-dot" style={{ background: accent }} aria-hidden="true" />
        ) : null}
        <span className="panel-row-text">
          <span className="panel-row-title">{title}</span>
          {meta ? <small>{meta}</small> : null}
        </span>
        {badge ? <span className="panel-row-badge">{badge}</span> : null}
      </Button>
      {action}
    </li>
  );
}

/** Keep only the selected detail and its closing animation mounted. */
export function PanelListDetail({
  open,
  id,
  children,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const ref = useRef<HTMLLIElement>(null);
  const interruptedHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open) setPresent(true);
    if (!element.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(open);
      interruptedHeight.current = null;
      return;
    }
    const height = element.getBoundingClientRect().height;
    const from = interruptedHeight.current ?? (open ? 0 : height);
    interruptedHeight.current = null;
    element.style.overflow = 'hidden';
    const animation = element.animate(
      [
        { height: `${from}px`, opacity: open ? 0 : 1 },
        { height: `${open ? height : 0}px`, opacity: open ? 1 : 0 },
      ],
      { duration: 180, easing: 'ease-out' },
    );
    let finished = false;
    animation.onfinish = () => {
      finished = true;
      element.style.overflow = '';
      setPresent(open);
    };
    return () => {
      if (!finished) interruptedHeight.current = element.getBoundingClientRect().height;
      animation.cancel();
      element.style.overflow = '';
    };
  }, [open]);
  return open || present ? (
    <li ref={ref} id={id} className="panel-list-detail" inert={!open} aria-hidden={!open}>
      {children}
    </li>
  ) : null;
}

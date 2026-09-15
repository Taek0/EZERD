import type { ReactNode, HTMLAttributes } from 'react';
import { Accordion, Button } from './components/ui/index.js';

/**
 * One collapsible group style for the editor sidebar. Content stays in the DOM
 * so counts, search results and accessibility names remain stable while closed.
 */
export function PanelSection({ title, count, open, defaultOpen = false, onOpenChange, className, children }: {
  title: ReactNode;
  count?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const state = open === undefined
    ? { open: defaultOpen }
    : { open, onToggle: (event: { currentTarget: HTMLDetailsElement }) => onOpenChange?.(event.currentTarget.open) };
  return <Accordion
    {...state}
    className={['panel-section', className].filter(Boolean).join(' ')}
    title={<span className="panel-section-title">
      {title}
      {count === undefined ? null : <span className="panel-count">{count}</span>}
    </span>}>
    <div className="panel-section-body">{children}</div>
  </Accordion>;
}

export function PanelNote({ children }: { children: ReactNode }) {
  return <p className="panel-note">{children}</p>;
}

export function PanelList({ empty, children }: { empty: ReactNode; children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return items.length ? <ul className="panel-list">{items}</ul> : <PanelNote>{empty}</PanelNote>;
}

export function PanelRow({ title, meta, badge, accent, active = false, onSelect, action, drag, className }: {
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  accent?: string;
  active?: boolean;
  onSelect: () => void;
  action?: ReactNode;
  className?: string;
  drag?: Pick<HTMLAttributes<HTMLLIElement>,'draggable'|'onDragStart'|'onDragOver'|'onDrop'|'onDragEnd'|'onDragLeave'>;
}) {
  return <li {...drag} className={['panel-row',active?'is-active':'',className].filter(Boolean).join(' ')}>
    <Button className="panel-row-main" aria-current={active || undefined} onClick={onSelect}>
      {accent ? <span className="panel-row-dot" style={{ background: accent }} aria-hidden="true" /> : null}
      <span className="panel-row-text">
        <span className="panel-row-title">{title}</span>
        {meta ? <small>{meta}</small> : null}
      </span>
      {badge ? <span className="panel-row-badge">{badge}</span> : null}
    </Button>
    {action}
  </li>;
}


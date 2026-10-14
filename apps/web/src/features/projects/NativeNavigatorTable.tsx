import { useNavigatorPresence } from './use-navigator-presence.js';
import { useId } from 'react';
import { Button, IconButton } from '../../components/ui/index.js';
import { ChevronDown } from '../../components/ui/untitled.js';
import { useI18n } from '../../shared/i18n/index.js';
import { nativeInspectorMatches } from './native-inspector-state.js';

export interface NativeNavigatorColumn {
  id: string;
  name: string;
  physicalName: string;
  logicalName: string;
  type: string;
}

export function navigatorTableMatches(
  search: string,
  physicalName: string,
  logicalName: string,
  columns: NativeNavigatorColumn[],
) {
  return (
    nativeInspectorMatches(search, physicalName, logicalName) ||
    columns.some((column) =>
      nativeInspectorMatches(search, column.physicalName, column.logicalName),
    )
  );
}

/** Selection only: the original inspector remains the sole editing surface. */
export function NativeNavigatorTable({
  name,
  accent,
  badge,
  active,
  expanded,
  onExpandedChange,
  columns,
  selectedColumn,
  search,
  onSelect,
  onSelectColumn,
}: {
  name: string;
  accent: string;
  badge?: string | undefined;
  active: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  columns: NativeNavigatorColumn[];
  selectedColumn?: string | null | undefined;
  search: string;
  onSelect: () => void;
  onSelectColumn: (id: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const matchingColumns = search.trim()
    ? columns.filter((column) =>
        nativeInspectorMatches(search, column.physicalName, column.logicalName),
      )
    : columns;
  const searchingColumns = !!search.trim() && matchingColumns.length > 0;
  const open = expanded || searchingColumns;
  const shown = searchingColumns ? matchingColumns : columns;
  const presence = useNavigatorPresence(open);
  return (
    <li className="native-navigator-table">
      <div className="native-navigator-table-row" data-selected={active}>
        <IconButton
          className="native-navigator-expand"
          variant="ghost"
          aria-label={`${name} ${t(open ? '컬럼 접기' : '컬럼 펼치기')}`}
          aria-expanded={open}
          aria-controls={id}
          disabled={!columns.length || searchingColumns}
          onClick={() => onExpandedChange(!open)}
        >
          <span className="native-navigator-chevron" data-open={open}>
            <ChevronDown />
          </span>
        </IconButton>
        <Button
          className="native-navigator-select"
          variant="ghost"
          aria-current={active || undefined}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            onExpandedChange(!open);
            onSelect();
          }}
          title={name}
        >
          <span className="panel-row-dot" style={{ background: accent }} aria-hidden="true" />
          <span className="native-navigator-name">{name}</span>
          <span className="panel-count">{columns.length}</span>
        </Button>
      </div>
      {badge && <small className="native-navigator-domain">{badge}</small>}
      <div
        ref={presence.ref}
        id={id}
        className="native-navigator-collapse"
        data-open={open}
        inert={!open}
        aria-hidden={!open}
      >
        <div>
          <ul className="native-navigator-columns">
            {presence.present &&
              shown.map((column) => (
                <li key={column.id}>
                  <Button
                    variant="ghost"
                    aria-current={(active && selectedColumn === column.id) || undefined}
                    onClick={() => onSelectColumn(column.id)}
                    title={`${column.name} · ${column.type}`}
                  >
                    <span className="native-navigator-name">{column.name}</span>
                    <small>{column.type}</small>
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../../components/ui/index.js';
import { ChevronDown } from '../../components/ui/untitled.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
registerTranslations({
  '테이블 펼치기': 'Expand tables',
  '테이블 접기': 'Collapse tables',
  '탐색 패널 너비': 'Explorer width',
  '데이터 모델': 'Data model',
});

export function NativeNavigatorDomain({
  name,
  color,
  count,
  active,
  reveal,
  revealKey,
  onOpen,
  children,
}: {
  name: string;
  color: string;
  count: number;
  active: boolean;
  reveal: boolean;
  revealKey: string;
  onOpen?: (() => void) | undefined;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal, revealKey]);
  return (
    <li className="native-navigator-domain-group">
      <div className="native-navigator-table-row" data-selected={active}>
        <IconButton
          variant="ghost"
          className="native-navigator-expand"
          aria-label={`${name} ${t(expanded ? '테이블 접기' : '테이블 펼치기')}`}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="native-navigator-chevron" data-open={expanded}>
            <ChevronDown />
          </span>
        </IconButton>
        <Button
          variant="ghost"
          className="native-navigator-select"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          title={name}
        >
          <span className="panel-row-dot" style={{ background: color }} aria-hidden="true" />
          <span className="native-navigator-name">{name}</span>
          <span className="panel-count">{count}</span>
        </Button>
        {onOpen && (
          <IconButton
            variant="ghost"
            aria-label={`${name} ${t('열기')}`}
            title={`${name} ${t('열기')}`}
            onClick={onOpen}
          >
            ↗
          </IconButton>
        )}
      </div>
      <div
        id={id}
        className="native-navigator-collapse"
        data-open={expanded}
        inert={!expanded}
        aria-hidden={!expanded}
      >
        <div>
          <ul className="native-navigator-domain-tables">{children}</ul>
        </div>
      </div>
    </li>
  );
}

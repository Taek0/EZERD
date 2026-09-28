import { translate as tr, useI18n } from '../../shared/i18n/index.js';
import '../canvas/translations.js';
import { useRef, useState } from 'react';
import { Textarea } from '../../components/ui/index.js';

type Props = {
  value: string;
  name: string;
  readOnly: boolean;
  onCommit: (value: string) => void;
  memo?: boolean;
};

export function DomainDescription({ value, name, readOnly, onCommit, memo = false }: Props) {
  useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const finished = useRef(false);
  function commit() {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (!readOnly && draft !== value) onCommit(draft);
  }
  function start() {
    if (readOnly) return;
    finished.current = false;
    setDraft(value);
    setEditing(true);
  }
  return editing && !readOnly ? (
    <Textarea
      autoFocus
      className={memo ? 'note-editor' : 'domain-description-editor'}
      aria-label={memo ? tr('메모 내용') : tr('{name} 업무 설명', { name })}
      maxLength={memo ? 20000 : 10000}
      value={draft}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          finished.current = true;
          setEditing(false);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commit();
        }
      }}
    />
  ) : (
    <p
      className={memo ? 'note-content' : 'domain-description'}
      data-inline-edit="true"
      tabIndex={readOnly ? undefined : 0}
      aria-label={memo ? tr('메모 내용') : tr('{name} 업무 설명', { name })}
      title={
        readOnly ? undefined : tr('더블클릭하여 편집 · Enter 줄바꿈 · Ctrl/⌘+Enter 저장 · Esc 취소')
      }
      onDoubleClick={(event) => {
        event.stopPropagation();
        start();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !readOnly) {
          event.preventDefault();
          event.stopPropagation();
          start();
        }
      }}
    >
      {value || (memo ? tr('더블클릭하여 메모를 작성하세요') : tr('업무 영역을 설명해 주세요'))}
    </p>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NativeDesignDocument } from '@ezerd/model';
import { AnimatedDetails, Button, IconButton, Input } from '../../components/ui/index.js';
import { useI18n } from '../../shared/i18n/index.js';
import { NativeStructureEditor, NativeDeleteForm } from './native-editor-structure.js';
import type { NativeEditorContext } from './native-editor-form.js';
import { nativeEditorPolicy } from './native-editor-policy.js';
import { nativeInspectorMatches } from './native-inspector-state.js';
import '../tables/enum-manager.css';
import './native-enum-dialog.css';

export function NativeEnumDialog({
  document: design,
  context,
  onClose,
}: {
  document: NativeDesignDocument;
  context?: NativeEditorContext;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    dialog = useRef<HTMLDialogElement>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false),
    [closing, setClosing] = useState(false);
  const close = () => {
    if (closeTimer.current !== undefined) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(onClose, 160);
  };
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      clearTimeout(closeTimer.current);
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const items = (design.enums ?? []).filter((item) =>
    nativeInspectorMatches(query, item.name, item.schema, ...item.values),
  );
  const supported = nativeEditorPolicy(design).feature('enumType').supported;
  const content = (
    <dialog
      ref={dialog}
      className="table-fk-dialog enum-dialog native-enum-dialog"
      aria-labelledby="native-enum-dialog-title"
      data-closing={closing || undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <div className="enum-dialog-head">
        <h2 id="native-enum-dialog-title">{t('프로젝트 ENUM')}</h2>
        <IconButton aria-label={t('ENUM 관리 닫기')} onClick={close}>
          ×
        </IconButton>
      </div>
      <div className="native-enum-toolbar">
        <div className="table-enum-search">
          <Input
            aria-label={t('ENUM 검색')}
            placeholder={t('ENUM 이름·값 검색')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <small className="native-enum-count">
          {t('{shown} / {total}개', { shown: items.length, total: (design.enums ?? []).length })}
        </small>
        {context && (
          <Button
            variant="primary"
            disabled={context.busy || !supported}
            onClick={() => {
              setSelected('new');
              setDeleting(false);
            }}
          >
            {t('ENUM 추가')}
          </Button>
        )}
      </div>
      <div className="native-enum-body">
        {!supported && (
          <p className="panel-note">
            {t('이 DB의 ENUM / SET 값은 컬럼 타입 속성에서 편집합니다.')}
          </p>
        )}
        <div className="table-enum-list">
          {items.map((item) => (
            <AnimatedDetails className="table-enum-item" key={item.id}>
              <summary>
                <strong>
                  {item.schema ? `${item.schema}.` : ''}
                  {item.name}
                </strong>
                <span className="native-enum-value-count">{item.values.length}</span>
                <small>
                  {item.values
                    .slice(0, 3)
                    .map((value) => value || t('빈 문자열'))
                    .join(' · ')}
                  {item.values.length > 3 ? ' …' : ''}
                </small>
              </summary>
              <div className="table-enum-values">
                {item.values.map((value, index) => (
                  <span key={index} className="native-enum-value">
                    {value || t('빈 문자열')}
                  </span>
                ))}
              </div>
              <div className="table-actions">
                <Button
                  disabled={!context || context.busy}
                  onClick={() => {
                    setSelected(item.id);
                    setDeleting(false);
                  }}
                >
                  {t('편집')}
                </Button>
                <Button
                  variant="danger"
                  disabled={!context || context.busy}
                  onClick={() => {
                    setSelected(item.id);
                    setDeleting(true);
                  }}
                >
                  {t('삭제')}
                </Button>
              </div>
            </AnimatedDetails>
          ))}
        </div>
        {!items.length && (
          <p className="panel-note">
            {t(query.trim() ? '검색 결과가 없습니다.' : '아직 ENUM이 없습니다.')}
          </p>
        )}
        {context &&
          selected &&
          (selected === 'new' || design.enums?.some((item) => item.id === selected)) && (
            <div className="native-enum-editor">
              {selected === 'new' ? (
                <NativeStructureEditor
                  key="new"
                  focused
                  document={design}
                  context={context}
                  initialSelection={{ action: 'enum', target: '' }}
                />
              ) : (
                selected &&
                design.enums?.some((item) => item.id === selected) &&
                (deleting ? (
                  <NativeDeleteForm
                    key={`delete:${selected}`}
                    document={design}
                    collection="enums"
                    id={selected}
                    context={context}
                  />
                ) : (
                  <NativeStructureEditor
                    key={`edit:${selected}`}
                    focused
                    document={design}
                    context={context}
                    initialSelection={{
                      action: 'patch',
                      target: JSON.stringify(['enums', selected]),
                    }}
                  />
                ))
              )}
            </div>
          )}
      </div>
      <div className="table-actions native-enum-footer">
        <Button onClick={close}>{t('닫기')}</Button>
      </div>
    </dialog>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

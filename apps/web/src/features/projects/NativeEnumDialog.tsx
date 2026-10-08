import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NativeDesignDocument } from '@ezerd/model';
import { AnimatedDetails, Button, IconButton, Input } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { NativeStructureEditor, NativeDeleteForm } from './native-editor-structure.js';
import type { NativeEditorContext } from './native-editor-form.js';
import { nativeEditorPolicy } from './native-editor-policy.js';
import { nativeInspectorMatches } from './native-inspector-state.js';
import '../tables/enum-manager.css';
import './native-enum-dialog.css';

registerTranslations({
  'ENUM 생성': 'Create ENUM',
  'ENUM 편집': 'Edit ENUM',
  'ENUM 삭제 확인': 'Confirm ENUM deletion',
  '편집 영역 닫기': 'Close editor',
  '프로젝트에서 사용할 값 목록을 관리합니다.': 'Manage reusable value lists for this project.',
  '등록된 ENUM': 'Saved ENUMs',
});

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
    editor = useRef<HTMLDivElement>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false),
    [closing, setClosing] = useState(false);
  const revealEditor = () => {
    const element = editor.current;
    if (!element) return;
    element.scrollIntoView({ block: 'nearest' });
    element.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (selected) revealEditor();
  }, [selected, deleting]);
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
        <div>
          <h2 id="native-enum-dialog-title">{t('프로젝트 ENUM')}</h2>
          <p className="native-enum-description">
            {t('프로젝트에서 사용할 값 목록을 관리합니다.')}
          </p>
        </div>
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
              if (selected === 'new' && !deleting) revealEditor();
            }}
          >
            {t('ENUM 추가')}
          </Button>
        )}
      </div>
      <div className="native-enum-body">
        {context &&
          selected &&
          (selected === 'new' || design.enums?.some((item) => item.id === selected)) && (
            <section
              className="native-enum-editor"
              ref={editor}
              aria-labelledby="native-enum-editor-title"
              data-deleting={deleting || undefined}
            >
              <div className="native-enum-editor-head">
                <div>
                  <h3 id="native-enum-editor-title">
                    {t(
                      selected === 'new' ? 'ENUM 생성' : deleting ? 'ENUM 삭제 확인' : 'ENUM 편집',
                    )}
                  </h3>
                  {selected !== 'new' && (
                    <p>{design.enums?.find((item) => item.id === selected)?.name}</p>
                  )}
                </div>
                <IconButton
                  aria-label={t('편집 영역 닫기')}
                  disabled={context.busy}
                  onClick={() => {
                    setSelected(null);
                    setDeleting(false);
                  }}
                >
                  {'×'}
                </IconButton>
              </div>
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
            </section>
          )}
        {!supported && (
          <p className="panel-note">
            {t('이 DB의 ENUM / SET 값은 컬럼 타입 속성에서 편집합니다.')}
          </p>
        )}
        <section className="native-enum-library" aria-labelledby="native-enum-list-title">
          <h3 id="native-enum-list-title">{t('등록된 ENUM')}</h3>
          <div className="table-enum-list">
            {items.map((item) => (
              <AnimatedDetails
                className="table-enum-item"
                key={item.id}
                data-selected={selected === item.id || undefined}
              >
                <summary>
                  <svg
                    className="native-enum-disclosure"
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    fill="none"
                  >
                    <path d="m7 4 6 6-6 6" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
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
                    aria-pressed={selected === item.id && !deleting}
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
        </section>
      </div>
      <div className="table-actions native-enum-footer">
        <Button onClick={close}>{t('닫기')}</Button>
      </div>
    </dialog>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

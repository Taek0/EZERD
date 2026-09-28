import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from './index.js';
import '../../components/ui/confirm.css';
import './language-dialog.css';

registerTranslations({
  '언어 변경': 'Change language',
  닫기: 'Close',
  '표시 언어': 'Display language',
});
export function LanguageDialog({ onClose }: { onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      returnFocus?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="confirmation-dialog language-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{t('언어 변경')}</h2>
      <fieldset>
        <legend>{t('표시 언어')}</legend>
        <label>
          <input
            type="radio"
            name="display-language"
            value="ko"
            checked={locale === 'ko'}
            onChange={() => setLocale('ko')}
          />{' '}
          한국어
        </label>
        <label>
          <input
            type="radio"
            name="display-language"
            value="en"
            checked={locale === 'en'}
            onChange={() => setLocale('en')}
          />{' '}
          English
        </label>
      </fieldset>
      <div className="confirmation-dialog-actions">
        <Button onClick={onClose}>{t('닫기')}</Button>
      </div>
    </dialog>,
    document.body,
  );
}

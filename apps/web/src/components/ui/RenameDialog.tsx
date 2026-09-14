import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from './index.js';
import { message } from '../../client.js';
import './confirm.css';

export function RenameDialog({ title, label, initialValue, maxLength, onCancel, onSave }: {
  title: string;
  label: string;
  initialValue: string;
  maxLength: number;
  onCancel: () => void;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false), composing = useRef(false);
  const titleId = useId(), inputId = useId(), errorId = useId();
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    input.current?.select();
    return () => { element?.close(); returnFocus?.focus(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || composing.current) return;
    const name = value.trim();
    if (!name || name.length > maxLength) {
      setError(`이름을 1~${maxLength}자로 입력해 주세요.`);
      input.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try { await onSave(name); }
    catch (e) { setError(message(e)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="confirmation-dialog rename-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!submitting.current) onCancel(); }}>
    <form onSubmit={event => void submit(event)}>
      <h2 id={titleId}>{title}</h2>
      <label htmlFor={inputId}>{label}</label>
      <Input ref={input} id={inputId} value={value} maxLength={maxLength} disabled={busy}
        aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        onChange={event => { setValue(event.target.value); setError(''); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
      {error && <p id={errorId} role="alert" className="notice error">{error}</p>}
      <div className="confirmation-dialog-actions">
        <Button type="button" disabled={busy} onClick={onCancel}>취소</Button>
        <Button type="submit" variant="primary" disabled={busy || !value.trim()}>{busy ? '저장 중…' : '저장'}</Button>
      </div>
    </form>
  </dialog>, document.body);
}

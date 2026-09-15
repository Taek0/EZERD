import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './index.js';
import './confirm.css';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm requires ConfirmProvider');
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const finish = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    dialog.current?.close();
    setOptions(null);
    resolve?.(confirmed);
    returnFocus.current?.focus();
  }, []);
  const confirm = useCallback<Confirm>((next) => {
    // Keep the currently visible decision stable when an action is clicked twice.
    if (resolver.current) return Promise.resolve(false);
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);
  useEffect(() => {
    if (options) {
      dialog.current?.showModal();
      cancelButton.current?.focus();
    }
  }, [options]);
  useEffect(
    () => () => {
      resolver.current?.(false);
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options &&
        createPortal(
          <dialog
            ref={dialog}
            className="confirmation-dialog"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onCancel={(event) => {
              event.preventDefault();
              finish(false);
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                const bounds = event.currentTarget.getBoundingClientRect();
                if (
                  event.clientX < bounds.left ||
                  event.clientX > bounds.right ||
                  event.clientY < bounds.top ||
                  event.clientY > bounds.bottom
                )
                  finish(false);
              }
            }}
          >
            <h2 id={titleId}>{options.title}</h2>
            <p id={descriptionId}>{options.description}</p>
            <div className="confirmation-dialog-actions">
              <Button ref={cancelButton} type="button" onClick={() => finish(false)}>
                취소
              </Button>
              <Button
                type="button"
                variant="primary"
                className={options.destructive ? 'confirmation-danger' : 'confirmation-primary'}
                onClick={() => finish(true)}
              >
                {options.confirmLabel ?? '확인'}
              </Button>
            </div>
          </dialog>,
          document.body,
        )}
    </ConfirmContext.Provider>
  );
}

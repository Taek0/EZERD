import { useEffect, useRef, type DependencyList } from 'react';

/** Serializes invalidations; a burst during a request gets one trailing fetch. */
export function createResourceLoader(
  load: (signal: AbortSignal) => Promise<void>,
  onError: (cause: unknown) => void = (cause) => console.error('Resource refresh failed', cause),
) {
  const controller = new AbortController();
  let running = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () => {
    dirty = true;
    if (running || timer !== undefined || controller.signal.aborted) return;
    timer = setTimeout(() => {
      timer = undefined;
      dirty = false;
      running = true;
      void Promise.resolve()
        .then(() => {
          if (!controller.signal.aborted) return load(controller.signal);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) onError(cause);
        })
        .finally(() => {
          running = false;
          if (dirty && !controller.signal.aborted) invalidate();
        });
    }, 30);
  };
  return {
    invalidate,
    stop() {
      controller.abort();
      clearTimeout(timer);
    },
  };
}
export function useResourceLoad(
  load: (signal: AbortSignal) => Promise<void>,
  scope: DependencyList,
  revision: unknown,
) {
  const latest = useRef(load);
  latest.current = load;
  const invalidate = useRef<() => void>(() => {});
  useEffect(() => {
    const loader = createResourceLoader((signal) => latest.current(signal));
    invalidate.current = loader.invalidate;
    loader.invalidate();
    return () => {
      loader.stop();
      invalidate.current = () => {};
    };
  }, scope);
  useEffect(() => {
    invalidate.current();
  }, [revision]);
}

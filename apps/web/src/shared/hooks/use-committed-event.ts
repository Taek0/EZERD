import { useLayoutEffect, useRef, useState } from 'react';

/** Stable event identity with the latest committed implementation. Render callbacks
 * must not use this hook: their return value participates in the current render. */
export function useCommittedEvent<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R;
export function useCommittedEvent<A extends unknown[], R>(
  callback: ((...args: A) => R) | undefined,
): ((...args: A) => R) | undefined;
export function useCommittedEvent<A extends unknown[], R>(
  callback: ((...args: A) => R) | undefined,
) {
  const committed = useRef(callback);
  useLayoutEffect(() => {
    committed.current = callback;
  }, [callback]);
  const [stable] = useState(
    () =>
      (...args: A) =>
        committed.current?.(...args),
  );
  return callback ? stable : undefined;
}

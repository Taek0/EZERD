/** Keep rendering synchronous while bounding expensive durable archive writes. */
export function createPlacementPersistence<T>(
  write: (value: T) => void,
  onSuccess: () => void,
  onError: (error: unknown) => void,
  delay = 120,
) {
  let pending: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function flush(): boolean {
    clearTimeout(timer);
    clearTimeout(deadline);
    timer = undefined;
    deadline = undefined;
    if (!pending) return true;
    try {
      write(pending.value);
      pending = undefined;
      onSuccess();
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }
  return {
    enqueue(value: T) {
      pending = { value };
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
      // Long uninterrupted drags still receive bounded recovery checkpoints.
      deadline ??= setTimeout(flush, 1000);
    },
    flush,
  };
}

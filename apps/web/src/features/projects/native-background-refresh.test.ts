import { describe, expect, it, vi } from 'vitest';
import { NativeBackgroundRefresh } from './native-background-refresh.js';
import { clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { projectEntry } from './project-entry.js';
import { nativeTestDeferred } from './native-durable-test-environment.js';

function entry(sequence = 1) {
  const snapshot = clipboardSnapshot();
  const result = projectEntry({
    ...snapshot,
    sequence,
    project: { ...snapshot.project, version: sequence },
  });
  if (result.kind !== 'native') throw Error('native required');
  return result;
}
describe('native background refresh', () => {
  it('keeps the current editor present during a slow refresh and applies the new snapshot directly', async () => {
    const before = entry(),
      after = entry(2),
      wait = nativeTestDeferred<typeof after>();
    let current = { identity: 'session:project:1', entry: before };
    const apply = vi.fn((value) => {
      current = { ...current, entry: value };
    });
    const refresh = new NativeBackgroundRefresh({
      current: () => current,
      load: () => wait.promise,
      apply,
      error: vi.fn(),
    });
    const pending = refresh.refresh();
    expect(current.entry).toBe(before);
    expect(apply).not.toHaveBeenCalled();
    wait.resolve(after);
    await pending;
    expect(apply).toHaveBeenCalledExactlyOnceWith(after);
    expect(current.entry).toBe(after);
  });
  it('coalesces repeated ACK refreshes and fetches once more for the latest state', async () => {
    const wait = nativeTestDeferred<ReturnType<typeof entry>>();
    const load = vi.fn().mockReturnValueOnce(wait.promise).mockResolvedValue(entry(3));
    let current = { identity: 'one', entry: entry() };
    const apply = vi.fn((value) => {
      current = { ...current, entry: value };
    });
    const refresh = new NativeBackgroundRefresh({
      current: () => current,
      load,
      apply,
      error: vi.fn(),
    });
    const first = refresh.refresh();
    void refresh.refresh();
    void refresh.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    wait.resolve(entry(2));
    await first;
    expect(load).toHaveBeenCalledTimes(2);
    expect(current.entry.snapshot.sequence).toBe(3);
  });
  it('ignores results and errors from an old session or navigation generation', async () => {
    const wait = nativeTestDeferred<ReturnType<typeof entry>>();
    let current = { identity: 'old', entry: entry() };
    const apply = vi.fn(),
      error = vi.fn();
    const refresh = new NativeBackgroundRefresh({
      current: () => current,
      load: () => wait.promise,
      apply,
      error,
    });
    const pending = refresh.refresh();
    current = { identity: 'new', entry: entry() };
    wait.resolve(entry(2));
    await pending;
    expect(apply).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it('does not roll back a newer snapshot and retains the editor on failure', async () => {
    const current = { identity: 'one', entry: entry(3) };
    const apply = vi.fn(),
      error = vi.fn();
    const load = vi.fn().mockResolvedValueOnce(entry(2)).mockRejectedValueOnce(Error('offline'));
    const refresh = new NativeBackgroundRefresh({ current: () => current, load, apply, error });
    await refresh.refresh();
    expect(apply).not.toHaveBeenCalled();
    await refresh.refresh();
    expect(error).toHaveBeenCalledOnce();
    expect(current.entry.snapshot.sequence).toBe(3);
  });
  it('does not show a delayed failure after leaving the editor', async () => {
    const wait = nativeTestDeferred<ReturnType<typeof entry>>();
    let current: { identity: string; entry: ReturnType<typeof entry> } | null = {
      identity: 'old',
      entry: entry(),
    };
    const error = vi.fn(),
      apply = vi.fn();
    const refresh = new NativeBackgroundRefresh({
      current: () => current,
      load: () =>
        wait.promise.then(() => {
          throw Error('late failure');
        }),
      apply,
      error,
    });
    const pending = refresh.refresh();
    current = null;
    wait.resolve(entry(2));
    await pending;
    expect(error).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});

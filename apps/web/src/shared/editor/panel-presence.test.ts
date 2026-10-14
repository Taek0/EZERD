import { afterEach, expect, it, vi } from 'vitest';
import { PanelSection } from './panel.js';
afterEach(() => vi.unstubAllGlobals());
it('prepares lazy content only for this closed summary before opening animation measurement', () => {
  const prepare = vi.fn();
  const panel = PanelSection({ title: 'Advanced', onPrepareOpen: prepare, children: null });
  const parent = { open: false };
  let summary: unknown = { parentElement: parent };
  class Target {
    closest() {
      return summary;
    }
  }
  vi.stubGlobal('Element', Target);
  const event = { target: new Target(), currentTarget: parent };
  panel.props.onClick(event);
  expect(prepare).toHaveBeenCalledOnce();
  parent.open = true;
  panel.props.onClick(event);
  expect(prepare).toHaveBeenCalledOnce();
  parent.open = false;
  summary = { parentElement: {} };
  panel.props.onClick(event);
  expect(prepare).toHaveBeenCalledOnce();
  summary = null;
  panel.props.onClick(event);
  expect(prepare).toHaveBeenCalledOnce();
});

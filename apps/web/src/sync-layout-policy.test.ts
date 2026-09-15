import { describe, expect, it } from 'vitest';
import { syncLayoutPolicy } from './sync-layout-policy.js';

describe('combined view sync policy', () => {
  it('keeps content and routes editable while disabling derived node layout', () => {
    expect(syncLayoutPolicy(false, true)).toEqual({
      camera: 'local',
      editContent: true,
      moveNodes: false,
      resizeNodes: false,
      editRoutes: true,
      autoLayout: false,
      editRelations: true,
    });
  });

  it.each([true, false])(
    'disables route and node edits when read-only (combined=%s)',
    (combined) => {
      expect(syncLayoutPolicy(true, combined)).toMatchObject({
        moveNodes: false,
        resizeNodes: false,
        editRoutes: false,
        autoLayout: false,
      });
    },
  );

  it('always keeps camera state local', () => {
    expect(syncLayoutPolicy(false, false).camera).toBe('local');
    expect(syncLayoutPolicy(true, false).camera).toBe('local');
  });
});

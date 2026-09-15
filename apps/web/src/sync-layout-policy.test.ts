import { describe, expect, it } from 'vitest';
import { syncLayoutPolicy } from './sync-layout-policy.js';

describe('combined view sync policy', () => {
  it('keeps content and relation definitions editable while disabling derived layout', () => {
    expect(syncLayoutPolicy(false, true)).toEqual({
      camera: 'local',
      editContent: true,
      moveNodes: false,
      resizeNodes: false,
      editRoutes: false,
      autoLayout: false,
      editRelations: true,
    });
  });

  it('always keeps camera state local', () => {
    expect(syncLayoutPolicy(false, false).camera).toBe('local');
    expect(syncLayoutPolicy(true, false).camera).toBe('local');
  });
});

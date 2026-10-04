import { describe, expect, it } from 'vitest';
import { galleryProjectCreationInput } from './project-create.js';
const workspaceId = '00000000-0000-4000-8000-000000000001';
describe('latest gallery creation request', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'explicitly defaults to native for %s',
    (databaseKind) => {
      expect(galleryProjectCreationInput(workspaceId, ' Design ', databaseKind)).toEqual({
        workspaceId,
        name: 'Design',
        databaseKind,
        formatVersion: 2,
      });
    },
  );
  it('preserves explicit legacy selection and blank automatic-name input', () => {
    expect(galleryProjectCreationInput(workspaceId, '   ', 'mysql', { formatVersion: 1 })).toEqual({
      workspaceId,
      name: '',
      databaseKind: 'mysql',
      formatVersion: 1,
    });
    expect(() => galleryProjectCreationInput('other-short', 'Name', 'postgresql')).toThrow();
  });
});

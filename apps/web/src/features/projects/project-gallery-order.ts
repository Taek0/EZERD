import type { Project } from '../../app/App.js';

export type ProjectSort = 'created' | 'recent' | 'name';

export function sortProjects(
  projects: readonly Project[],
  sort: ProjectSort = 'created',
  locale = 'ko',
): Project[] {
  return [...projects].sort((a, b) => {
    const order =
      sort === 'name'
        ? a.name.localeCompare(b.name, locale)
        : sort === 'recent'
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.createdAt.localeCompare(b.createdAt);
    return order || a.id.localeCompare(b.id, 'en');
  });
}

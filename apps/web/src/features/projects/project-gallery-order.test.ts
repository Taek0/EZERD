import { expect, it } from 'vitest';
import { sortProjects } from './project-gallery-order.js';
import type { Project } from '../../app/App.js';

const project = (id: string, createdAt: string, updatedAt = createdAt, name = id): Project => ({
  id,
  createdAt,
  updatedAt,
  name,
  workspaceId: 'space',
  status: 'active',
  version: 1,
});

it('defaults to oldest creation first and keeps that order after an edit', () => {
  const older = project('older', '2026-01-01', '2026-03-01');
  const newer = project('newer', '2026-02-01');
  const input = [newer, older];
  expect(sortProjects(input).map((p) => p.id)).toEqual(['older', 'newer']);
  expect(input).toEqual([newer, older]);
  expect(sortProjects([...input, project('latest', '2026-04-01')]).map((p) => p.id)).toEqual([
    'older',
    'newer',
    'latest',
  ]);
});
it('breaks creation timestamp ties deterministically regardless of server order', () => {
  const a = project('a', '2026-01-01');
  const b = project('b', '2026-01-01');
  expect(sortProjects([b, a])).toEqual([a, b]);
  expect(sortProjects([a, b])).toEqual([a, b]);
});
it('honors explicitly selected recent and name sorting', () => {
  const a = project('a', '2026-01-01', '2026-03-01', 'Zebra');
  const b = project('b', '2026-02-01', '2026-02-01', 'Alpha');
  expect(sortProjects([b, a], 'recent')).toEqual([a, b]);
  expect(sortProjects([a, b], 'name', 'en')).toEqual([b, a]);
});

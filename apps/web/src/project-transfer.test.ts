import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addDomain, addNote } from '@ezerd/model';
import { parseProjectTransfer, projectTransferFilename } from './project-transfer.js';

const document = addNote(
  addDomain(createEmptyDocument(), { id: 'domain', name: '', description: '' }, { x: 1, y: 2 }),
  { id: 'note', viewId: 'domain', text: '메모', color: '#fedcba' },
  { x: 5, y: 6 },
);
const file = {
  format: 'ezerd-project',
  formatVersion: 1,
  exportedAt: '2026-09-17T00:00:00.000Z',
  project: { name: '가져오기' },
  document,
};
describe('project file selection', () => {
  it('preserves a valid design including unfinished names, layout, notes, and identities', () => {
    expect(parseProjectTransfer(JSON.stringify(file))).toEqual(file);
  });
  it('rejects malformed JSON, future versions, unknown private fields, and broken references', () => {
    expect(() => parseProjectTransfer('{')).toThrow('JSON');
    expect(() => parseProjectTransfer(JSON.stringify({ ...file, formatVersion: 2 }))).toThrow(
      '버전',
    );
    expect(() => parseProjectTransfer(JSON.stringify({ ...file, pin: '1234' }))).toThrow('형식');
    expect(() =>
      parseProjectTransfer(JSON.stringify({ ...file, document: { ...document, domains: [] } })),
    ).toThrow('설계');
  });
  it('limits raw UTF-8 file size including whitespace before parsing', () => {
    expect(() => parseProjectTransfer(' '.repeat(2_000_001))).toThrow('2 MB');
    expect(() => parseProjectTransfer('한'.repeat(700_000))).toThrow('2 MB');
  });
  it('creates safe download filenames', () => {
    expect(projectTransferFilename('a/b:c')).toBe('a_b_c.ezerd.json');
    expect(projectTransferFilename('')).toBe('project.ezerd.json');
  });
});

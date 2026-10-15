import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateMigrationJournal } from '../../../scripts/validate-migrations.mjs';
const journal = () =>
  JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
describe('migration timestamp guard', () => {
  it('accepts the published history with its explicit repair', () =>
    expect(() => validateMigrationJournal(journal())).not.toThrow());
  it('rejects new reversed or equal timestamps', () => {
    for (const delta of [0, -1]) {
      const data = journal();
      data.entries.push({
        idx: data.entries.length,
        tag: '0020_future',
        when: Math.max(...data.entries.map((e: { when: number }) => e.when)) + delta,
      });
      expect(() => validateMigrationJournal(data)).toThrow('would skip');
    }
  });
  it('does not excuse the historical reversal without its repair', () => {
    const data = journal();
    data.entries = data.entries.filter((e: { idx: number }) => e.idx < 19);
    expect(() => validateMigrationJournal(data)).toThrow('would skip');
  });
});

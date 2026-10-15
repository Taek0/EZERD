import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Drizzle uses timestamps, not filenames, to decide whether a migration is pending. */
export function validateMigrationJournal(journal) {
  if (!Array.isArray(journal?.entries) || !journal.entries.length)
    throw Error('Migration journal is empty or malformed.');
  let highest = 0;
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.idx !== index || !Number.isSafeInteger(entry.when) || entry.when <= 0)
      throw Error(`Invalid migration journal entry: ${entry.tag}`);
    // Published 0018 is immutable; 0019 explicitly repairs its skipped-upgrade path.
    const repairedHistory =
      entry.idx === 18 &&
      entry.tag === '0018_workspace_order' &&
      entry.when === 1792049759919 &&
      highest === 1792050000000 &&
      journal.entries.some(
        (next) =>
          next.idx === 19 && next.tag === '0019_repair_workspace_order' && next.when > highest,
      );
    if (entry.when <= highest && !repairedHistory)
      throw Error(
        `Migration ${entry.tag} timestamp ${entry.when} must be greater than ${highest}; Drizzle would skip it on existing databases.`,
      );
    highest = Math.max(highest, entry.when);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const journal = JSON.parse(
    await readFile(new URL('../apps/server/drizzle/meta/_journal.json', import.meta.url), 'utf8'),
  );
  validateMigrationJournal(journal);
  console.log('Migration journal timestamp check passed.');
}

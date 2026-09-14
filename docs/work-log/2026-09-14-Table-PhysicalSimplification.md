# Physical table editor simplification

- Removed scope, logical fields, schema, table comment, custom metadata and default SQL controls from table editing. Stored hidden fields remain unchanged when editing visible physical fields.
- Changed tables to blue title bars and compact table rows; renamed column comments to `comment`. Column types use a native selection control and retain unknown existing types without coercion.
- Enabled length only for sized strings, precision for numeric and temporal types, and scale only for numeric types with precision. Enforced integer bounds; changing type clears obsolete modifiers.
- Key creation now stays in a local draft until a nonempty valid nonduplicate column mapping is confirmed. A pending draft disables further key-add clicks. FK creation requires a selected source column and the existing target-key confirmation dialog.
- New tables, columns and confirmed FKs use physical scope. ENUM schema is hidden, preserved on edit, and reset to public for a new ENUM.

## Verification

- Red: two new guard tests failed before implementation because guard functions were absent.
- Green: `pnpm exec vitest run apps/web/src/TableEditor.test.ts` — 11 tests passed.
- `pnpm --filter @ezerd/web typecheck` passed after implementation.
- `scripts/browser-table-workflow-smoke.mjs` passed with isolated Chrome/Playwright: inline Enter/Escape, default NOT NULL, confirmed FK mapping, no empty/repeated keys, composite key creation, disabled relation creation without source, select-only type editing, conditional parameters and temporal precision bounds.
- Browser plugin bootstrap returned `trusted Node process exited unexpectedly`; used the existing standalone local UI test fallback. Screenshot: `.cache/table-workflow.png`.

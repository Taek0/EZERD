# Inline cell lookup reduction

Plan: [Canvas interactive performance](../planning/2026-10-22-Canvas-InteractivePerformancePlan.md).

## Changes

- Added a nullable rendering resolver that resolves table, column and field value together. Missing tables, deleted columns and mismatched table ownership still return no cell.
- Passed the resolved input from the cell wrapper to its editable child. Editable renders now perform one table lookup and one column lookup instead of three of each. Read-only rendering also avoids its former duplicate lookup.
- Retained document-based lookup in fresh draft creation, advanced format handoff, confirmed baseline reconciliation and command generation. Actor/project/field keys, committed callbacks, IME, autosave, recovery and focus behavior are unchanged.
- Did not add parent entity hints: this keeps document membership authoritative without introducing an index or stale-prop validation contract.

## Validation

- Focused Vitest run: NativeCanvasInlineCell.test.ts and native-inline.test.ts, 54 tests passed.
- Added collection lookup spies across wrapper and editable renders, and null-render cases for deleted/mismatched objects. Existing edit lifecycle tests cover latest snapshots, recovery, IME, autosave and advanced formatting.
- Ran Prettier on the three changed TypeScript files.
- Web typecheck found no errors in changed inline files, but was blocked by concurrently edited NativeERDCanvas.lifecycle.test.ts, NativeProjectView.tsx and use-native-panel-derived.ts. Root integration will rerun after parallel work completes.
- No browser FPS claim: the measurement is a reduction from three to one collection searches per editable cell render.

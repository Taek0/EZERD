# Native canvas auxiliary component parity — 2026-10-06

## Scope

The existing [complete restoration plan](../planning/2026-10-06-Canvas-CompleteParityRestoration.md) authorizes this bounded S09 follow-up. This unit changes only NativeCanvasStyleEditor, native-clipboard, NativeDomainRelationEditor, NativeCanvasInputForm and focused tests. Main canvas, route editor, root native-editor-form and the audit document are outside this unit.

## Restored components

- Card appearance and clipboard panels use shared PanelSection/Accordion/AnimatedDetails. Clipboard ID-remapping details use AnimatedDetails, including its interruption handling and reduced-motion path.
- Card display flags, clipboard table selection and domain relationship deletion review use the shared Checkbox. Clipboard copy/paste controls use shared Textarea, retaining manual select/copy and input-version/actor checks.
- Card appearance uses the original DomainColorPicker for tables, domains and shared notes. Reset previews the inherited table-domain color, neutral domain default `#8993a3`, or note default `#fff3c4`; saving still uses the existing partial native style command with nullable reset. Invalid/incomplete recovered HEX input remains editable and preserved instead of being normalized or passed to the color parser.
- `NativeCanvasStyleEditor` adds optional `selectedNoteId?: string`. Explicit recovered `initialSelection` continues to take priority over shell selection. The existing private-note exclusion is preserved; private-note command routing remains the parent's integration responsibility.
- Domain relationship sections have contextual create/edit/delete titles. Read-only selected relationships show the chosen relationship and its correct one-way/two-way arrow. Revision-specific deletion review and partial command builders remain unchanged.

## Form submission API

`NativeCanvasInputForm` exports `NativeCanvasSubmit = () => Promise<void>` and accepts optional `onSubmitReady?: (submit: NativeCanvasSubmit) => void`.

The callback is registered in a layout effect. It invokes the latest committed `handleSubmit` through a ref and reads `latest.current`, so a route field update followed by submission in the same frame uses the new draft. The button/form submit and imperative submit share the same busy, disabled, baseline, storage and durable-write path. An in-flight ref prevents duplicate requests before the caller's busy state rerenders. Rejected saves keep input; an accepted ACK consumes only the captured revision and preserves newer input. Retained registrations become no-ops on callback replacement or unmount. No numeric `submitOn` trigger or automatic submission was added.

The parent can retain this submit function and call it after a route gesture completes. This unit does not wire or claim completion of route pointer/keyboard persistence.

## Code verification

- Five focused Node test files: **38 tests passed**. Coverage includes same-frame draft submission, duplicate submission, retained callback guards, registration cleanup, rejection/ACK revision matching, storage/validation refusal, shared component output, inherited/default colors, incomplete recovered HEX input, relationship deletion review and existing clipboard/recovered-input callbacks.
- `node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`: passed against the current working tree.
- Prettier was applied/checked only for this unit's code and tests using the root configuration. Documentation is excluded by the root `.prettierignore`.
- No browser access, screenshots, visual/motion QA or server integration tests were performed by this unit. Animation behavior is supplied by the existing shared primitive; rendered motion equivalence remains unverified.

## Commit isolation

NativeDomainRelationEditor received concurrent contextual-form/source-domain/focus edits from another worker during this unit. Those edits remain in the shared working tree and are excluded from this unit's staged domain-relation blob. Only this unit's shared Checkbox import/use, contextual title and read-only relationship filtering/direction belong to this commit. All other unrelated edits remain outside the commit. The audit document is left unchanged for parent reconciliation.

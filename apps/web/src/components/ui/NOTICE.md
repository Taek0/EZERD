# Untitled UI runtime source adaptation

The active runtime source is adapted from MIT-licensed Untitled UI React, pinned to
`c981a73bcd6b6c68d2a54070f20f020191212828`.
Copyright (c) 2025 Untitled UI. The full license is included in
[THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md).

[UPSTREAM.json](./UPSTREAM.json) records upstream URLs and SHA-256 hashes of the
original files verified for this rebuild. Originals are not represented as an
installed upstream package: this project runs the local modified source below.

## Active runtime mapping

| Upstream source | Runtime implementation |
| --- | --- |
| buttons/button.tsx | untitled.tsx: UntitledButton, wrapped by index.tsx: Button/IconButton |
| input/input.tsx InputBase | untitled.tsx: UntitledInputBase (Group, input, invalid indicator) |
| textarea/textarea.tsx TextAreaBase | untitled.tsx: UntitledTextAreaBase |
| checkbox/checkbox.tsx CheckboxBase | untitled.tsx: CheckboxBase; index.tsx: native hidden form-state adapter |
| select/select.tsx, select-shared.tsx | index.tsx: Select/SelectValue and option adapter |
| select/popover.tsx, select-item.tsx | untitled.tsx: UntitledPopover/UntitledSelectItem |
| dropdown/dropdown.tsx menu branches | untitled.tsx: UntitledMenu/UntitledMenuItem; index.tsx: Dropdown |
| tooltip/tooltip.tsx | untitled.tsx: UntitledTooltip |

`index.tsx` imports these runtime implementations, and `ui.css` imports
`untitled.css`. The source state/size recipes are translated from Tailwind classes
into scoped CSS: rings, shadows, radius, selected rows, check indicators, disabled
and focus states, and entering/exiting overlay animations.

## Deliberate adaptations

- Brand purple is replaced by EZERD blue; the existing Korean font is retained.
- Only required branches are included. Avatar/icon-rich Select variants,
  password visibility and other unused variants are omitted.
- Select consumes existing option/optgroup declarations and uses
  `onValueChange(string)`. Its visible tree is React Aria Select, button, popover,
  ListBox and items. React Aria's hidden native select is for forms/autofill only.
- Checkbox uses the upstream CheckboxBase SVG indicator with a visually hidden
  native input for the existing checked/onChange/ref and outer-label contract.
  It does not use the operating system checkbox as its visible indicator.
- Inputs and textareas preserve the app's DOM event/ref contract through React
  Aria primitives. Field associates labels and descriptions.
- Native modal dialog overlays are portalled into the dialog; disabled fieldsets
  are reflected in custom Select behavior. Reduced-motion settings are respected.
- ContextMenu uses the shared menu item visuals; pointer positioning, dismissal
  and focus restoration are local behavior. Disclosure/Collapse, Accordion,
  TabButton, Avatar and the editor layout remain EZERD-specific compositions.
- CheckboxBase paths are part of the licensed MIT component source. Other
  necessary geometric icons are locally authored SVGs. No @untitledui/icons
  package, paid PRO source, or upstream package dependency is included.

This is an adapted source implementation, not a claim that every Untitled UI
component or its full demo page is installed unchanged.

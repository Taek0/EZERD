# Untitled UI adaptation notice

These shared components adapt the free MIT-licensed Untitled UI React source:
https://github.com/untitleduico/react/tree/c981a73bcd6b6c68d2a54070f20f020191212828

Copyright (c) 2025 Untitled UI. MIT license; see [the full third-party license](../../../THIRD_PARTY_NOTICES.md).

Source recipes consulted and adapted: `components/base/buttons/button.tsx`,
`buttons/button-utility.tsx`, `input/input.tsx`, `input/label.tsx`,
`input/hint-text.tsx`, `textarea/textarea.tsx`, `select/select-native.tsx`,
`checkbox/checkbox.tsx`, `badges/badges.tsx`, `tooltip/tooltip.tsx`, and
`dropdown/dropdown.tsx`.

Button retains the upstream React Aria press/focus primitive, disabled/loading
semantics and size/color recipes; Tooltip retains its trigger, delay, placement
and overlay primitive; ContextMenu uses its React Aria Menu/MenuItem focus and
keyboard model. Context-menu positioning, outside dismissal and focus restoration
are EZERD additions. Native Input, Select, Textarea and Checkbox adapters retain
existing DOM event/ref contracts and apply adapted focus, invalid, disabled and
brand recipes without adding wrappers that shift compact layouts. Field links
labels, hints and errors explicitly. Disclosure, Collapse, Accordion, TabButton
and initial-only Avatar are EZERD composition helpers, not copied upstream widgets.

Styles are adapted into scoped CSS using EZERD's existing blue (#305be7), gray
surfaces and font. Default sizes are inherited from existing product styles;
explicit sizes are opt-in. Tailwind imports theme and utilities only, with no
preflight reset. No paid Untitled UI PRO source is included.


The disclosure chevron is an original inline SVG geometric glyph. No asset or
source from the @untitledui/icons package is included.


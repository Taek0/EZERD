export type CanvasTool = 'select' | 'hand';

export const toolShortcutInputSelector =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"],dialog,.ui-popover,.ui-dropdown-popover,.ui-context-menu';

export const toolShortcutOverlaySelector =
  'dialog[open],[aria-modal="true"],[role="dialog"],[role="menu"],.ui-popover,.ui-dropdown-popover,.ui-context-menu';

export function canvasToolShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'code'
    | 'repeat'
    | 'isComposing'
    | 'ctrlKey'
    | 'metaKey'
    | 'altKey'
    | 'defaultPrevented'
  >,
  context: { editing: boolean; overlayOpen: boolean; dragging: boolean },
): CanvasTool | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    context.editing ||
    context.overlayOpen ||
    context.dragging
  )
    return null;
  const key = event.key.toLowerCase();
  if (key === 'v' || event.code === 'KeyV') return 'select';
  if (key === 'h' || event.code === 'KeyH') return 'hand';
  return null;
}

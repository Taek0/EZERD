// Keep the last copied text in memory when the device clipboard is unavailable.
// Validation and paste policy belong to the caller, not the storage layer.
let localClipboard = '';

export const readLocalTableClipboard = () => localClipboard;

export function rememberTableClipboard(text: string): void {
  localClipboard = text;
}

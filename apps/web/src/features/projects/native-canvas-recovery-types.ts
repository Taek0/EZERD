import type { NativeInlineTarget } from './NativeCanvasInlineEditor.js';
/** Explicit initial view/action selection; it grants no draft, write, or storage authority. */
export interface NativeCanvasRecoverySelection {
  viewId?: string;
  routeId?: string;
  inline?: NativeInlineTarget;
  action?: { action: string; target: string };
  style?: string;
  domainRelation?: { action: 'create' | 'edit' | 'delete'; id?: string };
}

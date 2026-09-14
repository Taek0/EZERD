import type { ModelScope, ViewMode } from './document.js';

export interface ModelIdentity {
  id: string;
  scope: ModelScope;
}

/** Parent visibility applies to children, including external references. */
export function isVisibleInView(
  scope: ModelScope,
  view: ViewMode,
  parentScope: ModelScope = 'both',
): boolean {
  const includes = (value: ModelScope) => view === 'both' || value === 'both' || value === view;
  return includes(scope) && includes(parentScope);
}

export function canExportPhysical(scope: ModelScope, parentScope: ModelScope = 'both'): boolean {
  return scope !== 'logical' && parentScope !== 'logical';
}

export * from './document.js';
export * from './postgres.js';

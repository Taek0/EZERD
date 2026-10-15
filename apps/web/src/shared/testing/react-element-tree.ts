import { isValidElement, type ReactElement } from 'react';
/** Traverse only already-created elements. Never invoke components or render-prop functions. */
export function elementNodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elementNodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elementNodes(tree.props.children)];
}

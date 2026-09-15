/** Cameras are personal everywhere; combined views additionally derive all shared object layout. */
export function syncLayoutPolicy(readOnly: boolean, combined: boolean) {
  return {
    camera: 'local' as const,
    editContent: !readOnly,
    moveNodes: !readOnly && !combined,
    resizeNodes: !readOnly && !combined,
    editRoutes: !readOnly && !combined,
    autoLayout: !readOnly && !combined,
    editRelations: !readOnly,
  };
}

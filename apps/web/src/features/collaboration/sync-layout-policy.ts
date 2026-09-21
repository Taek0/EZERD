/** Cameras and combined routes are personal; combined node placement remains derived. */
export function syncLayoutPolicy(readOnly: boolean, combined: boolean) {
  return {
    camera: 'local' as const,
    editContent: !readOnly,
    moveNodes: !readOnly && !combined,
    resizeNodes: !readOnly && !combined,
    editRoutes: !readOnly,
    autoLayout: !readOnly && !combined,
    editRelations: !readOnly,
  };
}

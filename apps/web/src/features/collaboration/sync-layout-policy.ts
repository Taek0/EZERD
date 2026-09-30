/** Cameras and combined routes are personal; combined node placement remains derived. */
export function syncLayoutPolicy(
  readOnly: boolean,
  combined: boolean,
  personalReadOnly = readOnly,
) {
  return {
    camera: 'local' as const,
    editContent: !readOnly,
    moveNodes: !readOnly && !combined,
    resizeNodes: !readOnly && !combined,
    editRoutes: combined ? !personalReadOnly : !readOnly,
    autoLayout: !readOnly && !combined,
    editRelations: !readOnly,
  };
}

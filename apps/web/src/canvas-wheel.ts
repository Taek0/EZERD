type Camera = { x: number; y: number; zoom: number };
type Wheel = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};
export function wheelCamera<T extends Camera>(
  camera: T,
  event: Wheel,
  point: { x: number; y: number },
  height: number,
): T {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  const dx = event.deltaX * unit,
    dy = event.deltaY * unit;
  if (![dx, dy].every(Number.isFinite)) return camera;
  if (event.ctrlKey || event.metaKey) {
    const zoom = Math.max(
      0.25,
      Math.min(2, camera.zoom * Math.exp(-Math.max(-40, Math.min(40, dy)) * 0.002)),
    );
    return {
      ...camera,
      zoom,
      x: point.x - ((point.x - camera.x) * zoom) / camera.zoom,
      y: point.y - ((point.y - camera.y) * zoom) / camera.zoom,
    };
  }
  return {
    ...camera,
    x: camera.x - (event.shiftKey && dx === 0 ? dy : dx),
    y: camera.y - (event.shiftKey && dx === 0 ? 0 : dy),
  };
}

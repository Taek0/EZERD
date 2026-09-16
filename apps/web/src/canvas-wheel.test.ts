import { expect, it } from 'vitest';
import { wheelCamera } from './canvas-wheel.js';
const camera = { viewId: 'overview', x: 10, y: 20, zoom: 1 };
const wheel = {
  deltaX: 8,
  deltaY: 20,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};
it('pans both axes without changing zoom or mutating camera', () => {
  expect(wheelCamera(camera, wheel, { x: 100, y: 100 }, 600)).toEqual({ ...camera, x: 2, y: 0 });
  expect(camera).toEqual({ viewId: 'overview', x: 10, y: 20, zoom: 1 });
});
it('uses fine pinch increments anchored under the pointer', () => {
  const next = wheelCamera(
    camera,
    { ...wheel, deltaY: -2, ctrlKey: true },
    { x: 200, y: 150 },
    600,
  );
  expect(next.zoom).toBeGreaterThan(1);
  expect(next.zoom).toBeGreaterThan(1.0035);
  expect(next.zoom).toBeLessThan(1.01);
  expect((200 - next.x) / next.zoom).toBeCloseTo(190);
  expect((150 - next.y) / next.zoom).toBeCloseTo(130);
  expect(
    wheelCamera(
      { ...camera, zoom: 2 },
      { ...wheel, deltaY: -100, ctrlKey: true },
      { x: 0, y: 0 },
      600,
    ).zoom,
  ).toBe(2);
});
it('normalizes line/page events, supports horizontal shift and accumulates events', () => {
  expect(wheelCamera(camera, { ...wheel, deltaMode: 1 }, { x: 0, y: 0 }, 600).y).toBe(-300);
  expect(wheelCamera(camera, { ...wheel, deltaY: 1, deltaMode: 2 }, { x: 0, y: 0 }, 600).y).toBe(
    -580,
  );
  expect(wheelCamera(camera, { ...wheel, deltaX: 0, shiftKey: true }, { x: 0, y: 0 }, 600)).toEqual(
    { ...camera, x: -10 },
  );
  let next = camera;
  for (let i = 0; i < 10; i++) next = wheelCamera(next, wheel, { x: 0, y: 0 }, 600);
  expect(next.y).toBe(-180);
});

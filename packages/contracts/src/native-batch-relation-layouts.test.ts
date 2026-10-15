import { describe, expect, it } from 'vitest';
import {
  MAX_BATCH_RELATION_LAYOUT_BYTES,
  MAX_BATCH_RELATION_LAYOUTS,
  MAX_BATCH_RELATION_WAYPOINTS,
  nativeEditorCommandSchema,
} from './native-editor-command.js';
import { nativeClipboardByteLength } from './native-clipboard.js';

const route = (relationId: string) => ({
  relationId,
  offset: 0,
  sourceAnchor: { side: 'bottom' as const, ratio: 0.5 },
  targetAnchor: { side: 'top' as const, ratio: 0.5 },
  waypoints: [
    { x: 0, y: 100 },
    { x: 200, y: 100 },
  ],
});
const command = (routes: ReturnType<typeof route>[]) => ({
  type: 'batch_upsert_relation_layouts',
  viewId: '__tables__',
  routes,
});

describe('native batch relation layout command', () => {
  it('accepts more than 100 changed routes as one command with one shared view', () => {
    const input = command(Array.from({ length: 150 }, (_, index) => route(`fk-${index}`)));
    expect(nativeEditorCommandSchema.parse(input)).toEqual(input);
    expect(
      nativeEditorCommandSchema.safeParse({ ...input, routes: [route('fk'), route('fk')] }).success,
    ).toBe(false);
    expect(
      nativeEditorCommandSchema.safeParse({
        ...input,
        routes: [{ ...route('fk'), viewId: 'other-view' }],
      }).success,
    ).toBe(false);
  });

  it('enforces independent route and aggregate waypoint limits', () => {
    expect(
      nativeEditorCommandSchema.safeParse(
        command(
          Array.from({ length: MAX_BATCH_RELATION_LAYOUTS }, (_, index) => route(`fk-${index}`)),
        ),
      ).success,
    ).toBe(true);
    expect(
      nativeEditorCommandSchema.safeParse(
        command(
          Array.from({ length: MAX_BATCH_RELATION_LAYOUTS + 1 }, (_, index) =>
            route(`fk-${index}`),
          ),
        ),
      ).success,
    ).toBe(false);
    const waypointRoutes = Array.from({ length: 65 }, (_, index) => ({
      ...route(`fk-${index}`),
      waypoints: Array.from({ length: 127 }, () => ({ x: 0, y: 100 })),
    }));
    expect(
      waypointRoutes.reduce((count, item) => count + item.waypoints.length, 0),
    ).toBeGreaterThan(MAX_BATCH_RELATION_WAYPOINTS);
    expect(nativeEditorCommandSchema.safeParse(command(waypointRoutes)).success).toBe(false);
  });

  it('rejects a dense command above its UTF-8 byte ceiling', () => {
    const routes = Array.from({ length: 1000 }, (_, index) => ({
      relationId: String(index).padEnd(160, 'x'),
      offset: 10_000_000,
      bend: { x: 10_000_000, y: -10_000_000 },
      sourceAnchor: { side: 'right' as const, ratio: 0.12345678901234566 },
      targetAnchor: { side: 'left' as const, ratio: 0.9876543210987654 },
      waypoints: Array.from({ length: index < 192 ? 9 : 8 }, () => ({
        x: 10_000_000,
        y: -10_000_000,
      })),
    }));
    const input = command(routes);
    expect(routes.reduce((count, item) => count + item.waypoints.length, 0)).toBe(
      MAX_BATCH_RELATION_WAYPOINTS,
    );
    expect(nativeClipboardByteLength(JSON.stringify(input))).toBeGreaterThan(
      MAX_BATCH_RELATION_LAYOUT_BYTES,
    );
    expect(nativeEditorCommandSchema.safeParse(input).success).toBe(false);
  });
});

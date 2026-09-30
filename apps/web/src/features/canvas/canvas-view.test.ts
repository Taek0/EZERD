import { describe, expect, it } from 'vitest';
import {
  addDomain,
  addTable,
  createEmptyDocument,
  TABLES_VIEW_ID,
  updateTable,
  type Table,
} from '@ezerd/model';
import { initialCanvasView, tableCanvasOwner, visibleCanvasTable } from './canvas-view.js';
import { validViewId } from '../../shared/api/client.js';
import { syncLayoutPolicy } from '../collaboration/sync-layout-policy.js';

const table: Table = {
  id: 'table',
  domainId: null,
  scope: 'physical',
  logical: { name: 'Order', definition: '' },
  physical: { name: 'orders', schema: 'public', comment: '' },
  customProperties: { common: {}, logical: {}, physical: {} },
};

describe('direct table canvas workflow', () => {
  it('starts every project on the shared global table canvas', () => {
    const blank = createEmptyDocument();
    const unassigned = addTable(blank, table, { x: 10, y: 20 });
    const assigned = addDomain(
      unassigned,
      { id: 'orders', name: 'Orders', description: '' },
      { x: 0, y: 0 },
    );
    expect(initialCanvasView(blank)).toBe(TABLES_VIEW_ID);
    expect(initialCanvasView(unassigned)).toBe(TABLES_VIEW_ID);
    expect(initialCanvasView(assigned)).toBe(TABLES_VIEW_ID);
    expect(validViewId(TABLES_VIEW_ID, [])).toBe(TABLES_VIEW_ID);
    expect(validViewId('deleted', [], initialCanvasView(blank))).toBe(TABLES_VIEW_ID);
    expect(validViewId('deleted', ['orders'], initialCanvasView(assigned))).toBe(TABLES_VIEW_ID);
  });

  it('creates globally without an owner and keeps the domain-first creation path', () => {
    const doc = addDomain(
      createEmptyDocument(),
      { id: 'orders', name: 'Orders', description: '' },
      { x: 0, y: 0 },
    );
    const global = addTable(
      doc,
      { ...table, domainId: tableCanvasOwner(doc, TABLES_VIEW_ID)! },
      { x: 10, y: 20 },
    );
    const assigned = addTable(
      doc,
      { ...table, domainId: tableCanvasOwner(doc, 'orders')! },
      { x: 10, y: 20 },
    );
    expect(global.tables![0]!.domainId).toBeNull();
    expect(
      global.layout.nodes.filter((node) => node.objectId === table.id).map((node) => node.viewId),
    ).toEqual([TABLES_VIEW_ID]);
    expect(assigned.tables![0]!.domainId).toBe('orders');
    expect(
      new Set(
        assigned.layout.nodes
          .filter((node) => node.objectId === table.id)
          .map((node) => node.viewId),
      ),
    ).toEqual(new Set([TABLES_VIEW_ID, 'orders']));
    expect(tableCanvasOwner(doc, 'overview')).toBeUndefined();
    expect(
      tableCanvasOwner(
        { ...doc, views: [{ id: 'combined', name: 'Combined', domainIds: ['orders'] }] },
        'combined',
      ),
    ).toBeUndefined();
  });

  it('keeps unassigned tables globally visible and excludes them from domain and combined views after reassignment', () => {
    let doc = addTable(
      addDomain(
        createEmptyDocument(),
        { id: 'orders', name: 'Orders', description: '' },
        { x: 0, y: 0 },
      ),
      { ...table, domainId: 'orders' },
      { x: 10, y: 20 },
    );
    doc.views = [{ id: 'combined', name: 'Combined', domainIds: ['orders'] }];
    expect(visibleCanvasTable(doc, doc.tables![0]!, 'orders', 'physical')).toBe(true);
    expect(visibleCanvasTable(doc, doc.tables![0]!, 'combined', 'physical')).toBe(true);
    const globalPlacement = doc.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID);
    const unassigned = updateTable(doc, table.id, { domainId: null });
    const item = unassigned.tables![0]!;
    expect(visibleCanvasTable(unassigned, item, TABLES_VIEW_ID, 'physical')).toBe(true);
    expect(visibleCanvasTable(unassigned, item, 'orders', 'physical')).toBe(false);
    expect(visibleCanvasTable(unassigned, item, 'combined', 'physical')).toBe(false);
    expect(
      visibleCanvasTable(unassigned, { ...item, scope: 'logical' }, TABLES_VIEW_ID, 'physical'),
    ).toBe(false);
    expect(unassigned.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID)).toEqual(
      globalPlacement,
    );
  });

  it('uses shared design permissions for full-canvas placement and relation routes even when personal editing is allowed', () => {
    const doc = createEmptyDocument();
    const combined = !!doc.views?.some((view) => view.id === TABLES_VIEW_ID);
    expect(syncLayoutPolicy(true, combined, false)).toMatchObject({
      moveNodes: false,
      resizeNodes: false,
      editRoutes: false,
      autoLayout: false,
    });
    expect(syncLayoutPolicy(false, combined, true)).toMatchObject({
      moveNodes: true,
      resizeNodes: true,
      editRoutes: true,
      autoLayout: true,
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  designDocumentSchema,
  usernameInputSchema,
  createProjectSchema,
  updateProjectSchema,
  saveDocumentSchema,
} from './index.js';
const empty = () => ({
  schemaVersion: 1,
  domains: [],
  domainRelations: [],
  notes: [],
  layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
});
describe('API input boundaries', () => {
  it('normalizes names and rejects blanks, oversized input and empty updates', () => {
    expect(usernameInputSchema.parse({ username: '  태경  ', pin: '0012' })).toEqual({
      username: '태경',
      pin: '0012',
    });
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    expect(createProjectSchema.parse({ name: ' 주문 ', workspaceId })).toEqual({
      name: '주문',
      workspaceId,
    });
    expect(createProjectSchema.safeParse({ name: '주문' }).success).toBe(false);
    expect(usernameInputSchema.safeParse({ username: '  ' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: 'x'.repeat(121), workspaceId }).success).toBe(
      false,
    );
    expect(updateProjectSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(
      updateProjectSchema.safeParse({ expectedVersion: 0, name: 'x', document: empty() }).success,
    ).toBe(false);
  });
  it('requires nonnegative integer save version and supported document format', () => {
    expect(saveDocumentSchema.safeParse({ expectedVersion: 0, document: empty() }).success).toBe(
      true,
    );
    expect(saveDocumentSchema.safeParse({ document: empty() }).success).toBe(false);
    expect(saveDocumentSchema.safeParse({ expectedVersion: -1, document: empty() }).success).toBe(
      false,
    );
    expect(designDocumentSchema.safeParse({ ...empty(), schemaVersion: 2 }).success).toBe(false);
  });
  it('allows unfinished names but rejects ambiguous identities', () => {
    const doc = { ...empty(), domains: [{ id: 'd', name: '', description: '' }] };
    expect(designDocumentSchema.safeParse(doc).success).toBe(true);
    expect(
      designDocumentSchema.safeParse({ ...doc, domains: [...doc.domains, ...doc.domains] }).success,
    ).toBe(false);
    expect(
      designDocumentSchema.safeParse({ ...doc, notes: [{ id: 'd', viewId: 'overview', text: '' }] })
        .success,
    ).toBe(false);
  });
  it('saves incomplete references for diagnosis but rejects unknown fields and invalid geometry', () => {
    const doc = {
      ...empty(),
      domainRelations: [
        {
          id: 'r',
          sourceDomainId: 'missing',
          targetDomainId: 'also-missing',
          name: '',
          direction: 'forward',
          description: '',
        },
      ],
    };
    expect(designDocumentSchema.safeParse(doc).success).toBe(true);
    expect(designDocumentSchema.safeParse({ ...doc, comments: [] }).success).toBe(false);
    expect(
      designDocumentSchema.safeParse({
        ...empty(),
        layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 0 }] },
      }).success,
    ).toBe(false);
  });
});

it('bounds the whole UTF-8 document, including multibyte text, before transport', () => {
  const doc = {
    ...empty(),
    notes: Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      viewId: 'overview',
      text: '한'.repeat(20000),
    })),
  };
  expect(designDocumentSchema.safeParse(doc).success).toBe(false);
  expect(designDocumentSchema.safeParse({ ...doc, notes: doc.notes.slice(0, 20) }).success).toBe(
    true,
  );
});

it('round-trips populated designs and rejects ambiguous node/view identities', () => {
  const doc = {
    schemaVersion: 1,
    domains: [
      { id: 'orders', name: '주문', description: '' },
      { id: 'payments', name: '결제', description: '' },
    ],
    domainRelations: [
      {
        id: 'r',
        sourceDomainId: 'orders',
        targetDomainId: 'payments',
        name: '결제 요청',
        direction: 'both',
        description: '',
      },
    ],
    notes: [{ id: 'n', viewId: 'orders', text: '내부 설명' }],
    layout: {
      nodes: [
        {
          id: 'l1',
          objectId: 'orders',
          viewId: 'overview',
          x: -4.5,
          y: 3,
          width: 240,
          height: 140,
        },
        {
          id: 'l2',
          objectId: 'payments',
          viewId: 'overview',
          x: 300,
          y: 3,
          width: 240,
          height: 140,
        },
        { id: 'l3', objectId: 'n', viewId: 'orders', x: 0, y: 0, width: 300, height: 180 },
      ],
      viewports: [
        { viewId: 'overview', x: 0, y: 0, zoom: 1 },
        { viewId: 'orders', x: 30, y: -50, zoom: 0.4 },
      ],
    },
  };
  expect(designDocumentSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  for (const badNode of [
    { ...doc.layout.nodes[0]!, objectId: 'payments' },
    { ...doc.layout.nodes[0]!, id: 'another' },
  ]) {
    expect(
      designDocumentSchema.safeParse({
        ...doc,
        layout: { ...doc.layout, nodes: [...doc.layout.nodes, badNode] },
      }).success,
    ).toBe(false);
  }
  expect(
    designDocumentSchema.safeParse({
      ...doc,
      layout: { ...doc.layout, viewports: [...doc.layout.viewports, doc.layout.viewports[0]] },
    }).success,
  ).toBe(false);
  expect(
    designDocumentSchema.safeParse({ ...doc, domains: [{ ...doc.domains[0], id: 'overview' }] })
      .success,
  ).toBe(false);
  expect(
    designDocumentSchema.safeParse({ ...doc, notes: [{ ...doc.notes[0], id: 'overview' }] })
      .success,
  ).toBe(false);
  expect(
    designDocumentSchema.safeParse({
      ...doc,
      domainRelations: [{ ...doc.domainRelations[0], id: 'overview' }],
    }).success,
  ).toBe(false);
});
it('round trips optional combined views and per-view relation routes without changing old documents', () => {
  const legacy = empty();
  expect(designDocumentSchema.parse(legacy)).toEqual(legacy);
  const doc = {
    ...legacy,
    views: [{ id: 'combined', name: '모아 보기', domainIds: ['domain'] }],
    layout: {
      ...legacy.layout,
      relations: [{ relationId: 'relation', viewId: 'combined', offset: 42 }],
    },
  };
  expect(designDocumentSchema.parse(doc)).toEqual(doc);
  expect(
    designDocumentSchema.safeParse({
      ...doc,
      views: [{ ...doc.views[0], domainIds: ['domain', 'domain'] }],
    }).success,
  ).toBe(false);
  expect(
    designDocumentSchema.safeParse({
      ...doc,
      layout: { ...doc.layout, relations: [...doc.layout.relations, ...doc.layout.relations] },
    }).success,
  ).toBe(false);
});

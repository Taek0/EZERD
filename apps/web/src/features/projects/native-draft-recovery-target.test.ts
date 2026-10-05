import { describe, expect, it } from 'vitest';
import {
  clipboardFixture,
  clipboardActor,
  clipboardProject,
} from './native-clipboard-test-fixtures.js';
import { nativeDraftRecoveryTarget } from './native-draft-recovery-target.js';
import type { NativeDraftArchiveEntry } from './native-draft-archive.js';
function fixture() {
  const doc = clipboardFixture();
  doc.domains.push({ id: 'd:colon', name: 'Colon ID', description: '' });
  doc.views = [{ id: 'v', name: 'Private', domainIds: ['d'] }];
  doc.notes = [
    { id: 'n', text: 'Shared', viewId: '__tables__' },
    { id: 'pn', text: 'Private', viewId: 'v' },
  ];
  doc.domainRelations = [
    {
      id: 'dr',
      sourceDomainId: 'd',
      targetDomainId: 'd:colon',
      name: '',
      description: '',
      direction: 'forward',
    },
  ];
  doc.layout.nodes.push({
    id: 'private-node',
    objectId: 'a',
    viewId: 'v',
    x: 0,
    y: 0,
    width: 320,
    height: 260,
  });
  return doc;
}
function editor(key: string): NativeDraftArchiveEntry {
  return {
    formatVersion: 1,
    entryId: clipboardActor,
    writerId: clipboardProject,
    userId: clipboardActor,
    projectId: clipboardProject,
    category: 'editor',
    logicalKey: key,
    revision: clipboardActor,
    savedAt: '',
    draft: {
      userId: clipboardActor,
      projectId: clipboardProject,
      key,
      revision: clipboardActor,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { id: 'new-created' },
      values: { id: 'new-created' },
    },
  };
}
describe('native recovery source routing', () => {
  it('routes note/domain inspector and text drafts only to their actual view', () => {
    const doc = fixture();
    const shared = editor('canvas:description:__tables__:n');
    if ('values' in shared.draft) shared.draft.values = { objectId: 'n', text: 'preserved' };
    expect(nativeDraftRecoveryTarget(doc, shared)).toMatchObject({
      kind: 'canvas',
      personal: false,
      selection: { viewId: '__tables__', descriptionId: 'n' },
    });
    const privateDraft = editor('canvas:description:v:pn');
    if ('values' in privateDraft.draft)
      privateDraft.draft.values = { objectId: 'pn', text: 'preserved private' };
    expect(nativeDraftRecoveryTarget(doc, privateDraft)).toMatchObject({
      kind: 'canvas',
      personal: true,
      selection: { viewId: 'v', descriptionId: 'pn' },
    });
    const wrongView = editor('canvas:description:__tables__:pn');
    if ('values' in wrongView.draft) wrongView.draft.values = { objectId: 'pn', text: 'private' };
    expect(nativeDraftRecoveryTarget(doc, wrongView)).toBeNull();
    doc.layout.nodes.push({
      id: 'memo-node',
      objectId: 'n',
      viewId: '__tables__',
      x: 0,
      y: 0,
      width: 240,
      height: 160,
    });
    const inspector = editor('canvas:object:__tables__:n');
    if ('values' in inspector.draft) inspector.draft.values = { objectId: 'n' };
    expect(nativeDraftRecoveryTarget(doc, inspector)).toMatchObject({
      kind: 'canvas',
      personal: false,
      selection: { objectId: 'n' },
    });
  });
  it.each([
    ['format:table:a', { kind: 'format', tableId: 'a', personal: false }],
    ['format:column:ca', { kind: 'format', tableId: 'a', columnId: 'ca', personal: false }],
    [
      'create:table:project',
      { kind: 'structure', selection: { action: 'table', target: '' }, personal: false },
    ],
    [
      'create:enum:project',
      { kind: 'structure', selection: { action: 'enum', target: '' }, personal: false },
    ],
    [
      'create:column:a',
      {
        kind: 'structure',
        tableId: 'a',
        selection: { action: 'column', target: '' },
        personal: false,
      },
    ],
    [
      'create:foreignKey:a',
      {
        kind: 'structure',
        tableId: 'a',
        selection: { action: 'foreignKey', target: '' },
        personal: false,
      },
    ],
    [
      'constraint:keys:k',
      {
        kind: 'structure',
        tableId: 'a',
        selection: { action: 'patch', target: '["keys","k"]' },
        personal: false,
      },
    ],
    [
      'constraint:indexes:ix',
      {
        kind: 'structure',
        tableId: 'a',
        selection: { action: 'patch', target: '["indexes","ix"]' },
        personal: false,
      },
    ],
    [
      'delete:columns:ca',
      {
        kind: 'structure',
        tableId: 'a',
        selection: { action: 'delete', target: '["columns","ca"]' },
        personal: false,
      },
    ],
    ['create:domain:project', { kind: 'domain', action: 'create', personal: false }],
    [
      'edit:domain:d:colon',
      { kind: 'domain', action: 'edit', domainId: 'd:colon', personal: false },
    ],
    ['delete:domain:d', { kind: 'domain', action: 'delete', domainId: 'd', personal: false }],
    ['move:domain:a', { kind: 'domain', action: 'move', tableId: 'a', personal: false }],
    [
      'advanced:index:a:new',
      { kind: 'advanced', tableId: 'a', selection: 'index:new', personal: false },
    ],
    [
      'advanced:index:a:ix',
      { kind: 'advanced', tableId: 'a', selection: '["index","ix"]', personal: false },
    ],
    [
      'advanced:expression:a:check:new',
      { kind: 'advanced', tableId: 'a', selection: 'check:new', personal: false },
    ],
    [
      'advanced:expression:a:check:q',
      { kind: 'advanced', tableId: 'a', selection: '["check","q"]', personal: false },
    ],
    [
      'advanced:expression:a:default:ca',
      { kind: 'advanced', tableId: 'a', selection: '["default","ca"]', personal: false },
    ],
    [
      'advanced:expression:a:computed:ca',
      { kind: 'advanced', tableId: 'a', selection: '["computed","ca"]', personal: false },
    ],
    [
      'canvas:action:__tables__:note:',
      {
        kind: 'canvas',
        selection: { viewId: '__tables__', action: { action: 'note', target: '' } },
        personal: false,
      },
    ],
    [
      'canvas:action:v:view:',
      {
        kind: 'canvas',
        selection: { viewId: 'v', action: { action: 'view', target: '' } },
        personal: true,
      },
    ],
    [
      'canvas:action:d:note-edit:n',
      {
        kind: 'canvas',
        selection: { viewId: 'd', action: { action: 'note-edit', target: 'n' } },
        personal: false,
      },
    ],
    [
      'canvas:action:v:note-delete:pn',
      {
        kind: 'canvas',
        selection: { viewId: 'v', action: { action: 'note-delete', target: 'pn' } },
        personal: true,
      },
    ],
    [
      'canvas:action:__tables__:view-edit:v',
      {
        kind: 'canvas',
        selection: { viewId: '__tables__', action: { action: 'view-edit', target: 'v' } },
        personal: true,
      },
    ],
    [
      'canvas:action:v:remove-reference:a',
      {
        kind: 'canvas',
        selection: { viewId: 'v', action: { action: 'remove-reference', target: 'a' } },
        personal: true,
      },
    ],
    [
      'canvas:action:__tables__:reference:a',
      {
        kind: 'canvas',
        selection: { viewId: '__tables__', action: { action: 'reference', target: 'a' } },
        personal: false,
      },
    ],
    ['canvas:style:table:a', { kind: 'canvas', selection: { style: 'table:a' }, personal: false }],
    [
      'canvas:style:domain:d:colon',
      { kind: 'canvas', selection: { style: 'domain:d:colon' }, personal: false },
    ],
    ['canvas:style:note:n', { kind: 'canvas', selection: { style: 'note:n' }, personal: false }],
    [
      'canvas:domain-relation:create',
      { kind: 'canvas', selection: { domainRelation: { action: 'create' } }, personal: false },
    ],
    [
      'canvas:domain-relation:delete:dr',
      {
        kind: 'canvas',
        selection: { domainRelation: { action: 'delete', id: 'dr' } },
        personal: false,
      },
    ],
  ])('routes %s without changing source or expected', (key, target) => {
    const doc = fixture(),
      input = editor(String(key)),
      before = structuredClone({ doc, input });
    expect(nativeDraftRecoveryTarget(doc, input)).toEqual(target);
    expect({ doc, input }).toEqual(before);
  });
  it('routes property category separately and never trusts an editor key claiming property identity', () => {
    const input = editor('unused');
    input.category = 'property';
    input.logicalKey = '["column","ca"]';
    input.draft = {
      userId: clipboardActor,
      projectId: clipboardProject,
      kind: 'column',
      objectId: 'ca',
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      values: { physicalName: '', comment: 'Typed', logicalName: '', definition: '' },
      before: { physicalName: '', comment: '', logicalName: '', definition: '' },
    };
    expect(nativeDraftRecoveryTarget(fixture(), input)).toEqual({
      kind: 'property',
      tableId: 'a',
      columnId: 'ca',
      personal: false,
    });
    input.logicalKey = '["table","a"]';
    expect(nativeDraftRecoveryTarget(fixture(), input)).toBeNull();
    expect(nativeDraftRecoveryTarget(fixture(), editor('["column","ca"]'))).toBeNull();
  });
  it.each([
    'format:column:gone',
    'constraint:keys:gone',
    'delete:tables:gone',
    'create:column:gone',
    'edit:domain:gone',
    'move:domain:gone',
    'advanced:index:a:gone',
    'advanced:expression:a:default:gone',
    'canvas:placement:gone',
    'canvas:action:v:note-edit:gone',
    'canvas:style:note:pn',
    'canvas:domain-relation:edit:gone',
    'clipboard:paste:a',
    'unknown:form',
  ])('leaves %s download-only', (key) => {
    expect(nativeDraftRecoveryTarget(fixture(), editor(key))).toBeNull();
  });
  it('cannot replay creation after its ID already exists or its raw ID was changed', () => {
    const input = editor('create:column:a');
    input.draft.before = { id: 'ca' };
    input.draft.values = { id: 'ca' };
    expect(nativeDraftRecoveryTarget(fixture(), input)).toBeNull();
    input.draft.before = { id: 'new-source' };
    input.draft.values = { id: 'changed-copy' };
    expect(nativeDraftRecoveryTarget(fixture(), input)).toBeNull();
  });
  it('requires a current placement node/view/object match and retains personal permission routing', () => {
    const input = editor('canvas:placement:v');
    input.draft.values = { objectId: 'a', nodeId: 'private-node', viewId: 'v' };
    expect(nativeDraftRecoveryTarget(fixture(), input)).toEqual({
      kind: 'canvas',
      selection: { viewId: 'v' },
      personal: true,
    });
    input.draft.values.nodeId = 'removed-node';
    expect(nativeDraftRecoveryTarget(fixture(), input)).toBeNull();
    const domain = editor('canvas:placement:d');
    domain.draft.values = { objectId: 'a', nodeId: 'na', viewId: '__tables__' };
    expect(nativeDraftRecoveryTarget(fixture(), domain)).toEqual({
      kind: 'canvas',
      selection: { viewId: 'd' },
      personal: false,
    });
  });
});

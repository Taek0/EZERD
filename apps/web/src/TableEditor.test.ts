import { describe, expect, it } from 'vitest';
import { moveColumn, parseMetadata, setMappingPair } from './TableEditor.js';
describe('table editor actions', () => {
  it('reorders only the selected table columns while preserving unrelated positions', () => {
    const doc = {columns:[{id:'a',tableId:'one'},{id:'x',tableId:'two'},{id:'b',tableId:'one'}]};
    expect(moveColumn(doc as never,'b',-1).columns?.map(c=>c.id)).toEqual(['b','x','a']);
    expect(doc.columns.map(c=>c.id)).toEqual(['a','x','b']);
  });
  it('preserves explicit ordered FK mapping when editing either endpoint', () => {
    expect(setMappingPair({sourceColumnIds:['a','b'],targetColumnIds:['x','y']},1,'target','z')).toEqual({sourceColumnIds:['a','b'],targetColumnIds:['x','z']});
  });
  it('accepts string metadata and rejects nested or non-string data without dropping it', () => {
    expect(parseMetadata('{"owner":"billing"}')).toEqual({owner:'billing'});
    expect(()=>parseMetadata('{"owner":2}')).toThrow();
    expect(()=>parseMetadata('[]')).toThrow();
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableInspector, TableNodeContent, TableWorkspaceTools } from './TableEditor.js';
import { createEmptyDocument, addDomain, addTable, addColumn } from '@ezerd/model';
const metadata = {common:{},logical:{},physical:{}};
function example() {
 let doc=addDomain(createEmptyDocument(),{id:'d',name:'결제',description:''},{x:0,y:0});
 doc=addTable(doc,{id:'t',domainId:'d',scope:'both',logical:{name:'청구서',definition:''},physical:{name:'invoice',schema:'public',comment:''},customProperties:metadata},{x:0,y:0});
 doc=addColumn(doc,{id:'c',tableId:'t',scope:'logical',logical:{name:'논리 전용 항목',definition:'',semanticType:'금액',required:true},physical:{name:'hidden_column',type:{name:'numeric',isArray:false},nullable:true,defaultExpression:null,comment:''},customProperties:metadata});
 return doc;
}
describe('table editor rendered controls',()=>{
 it('shows owner and respects logical-only column visibility in physical cards',()=>{
  const doc=example();
  const logical=renderToStaticMarkup(createElement(TableNodeContent,{document:doc,tableId:'t',viewMode:'logical',viewId:'external'}));
  expect(logical).toContain('외부 참조 · '); expect(logical).toContain('논리 전용 항목');
  const physical=renderToStaticMarkup(createElement(TableNodeContent,{document:doc,tableId:'t',viewMode:'physical'}));
  expect(physical).toContain('invoice'); expect(physical).not.toContain('hidden_column');
 });
 it('makes inspector mutation controls read-only while keeping model view selectable',()=>{
  const doc=example();
  const inspector=renderToStaticMarkup(createElement(TableInspector,{document:doc,tableId:'t',onChange:()=>{},readOnly:true}));
  expect(inspector).toContain('<fieldset disabled=""'); expect(inspector).toContain('물리 테이블명'); expect(inspector).toContain('키 · PK / UNIQUE');
  const tools=renderToStaticMarkup(createElement(TableWorkspaceTools,{document:doc,viewId:'d',viewMode:'both',onViewModeChange:()=>{},onChange:()=>{},readOnly:true,position:{x:0,y:0},onSelect:()=>{}}));
  const addTableButton = [...tools.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2]?.includes('+ 테이블'));
  expect(addTableButton?.[1]).toMatch(/\bdisabled=""/);
  const viewSelect = tools.match(/<select\b([^>]*)>([\s\S]*?)<\/select>/);
  expect(viewSelect?.[1]).not.toMatch(/\bdisabled/);
  expect(viewSelect?.[2]).toContain('value="both" selected=""');
 });
});

import { relationGeometry } from './TableEditor.js';
describe('table relation routing',()=>{
 it('routes tight adjacent cards above both headers with a readable label',()=>{
  const a={x:0,y:50,width:280,height:220},b={x:300,y:60,width:280,height:220};
  const line=relationGeometry(a,b,160,0);
  expect(line.labelY+14).toBeLessThan(Math.min(a.y,b.y));
  expect(line.path).toContain('L 440');
 });
 it('keeps self-reference labels above the card and endpoints outside its body',()=>{
  const a={x:10,y:90,width:280,height:220};
  const line=relationGeometry(a,a,140,0);
  expect(line.labelY+14).toBeLessThan(a.y);
  expect(line.path).toContain('150 82');
 });
});

import { TableRelationsSvg } from './TableEditor.js';
import { upsertTableRelation } from '@ezerd/model';
describe('table relation view semantics',()=>{
 it('hides relations without FK definitions in physical view while keeping logical view',()=>{
  const doc=upsertTableRelation(example(),{id:'r',sourceTableId:'t',targetTableId:'t',scope:'both',logical:{name:'논리 검토 관계',cardinality:'one-to-many',required:false},physical:null});
  const physical=renderToStaticMarkup(createElement(TableRelationsSvg,{document:doc,viewId:'d',viewMode:'physical',onSelect:()=>{}}));
  const logical=renderToStaticMarkup(createElement(TableRelationsSvg,{document:doc,viewId:'d',viewMode:'logical',onSelect:()=>{}}));
  expect(physical).toBe('');
  expect(logical).toContain('논리 검토 관계');
  expect(logical).toContain('marker-end');
  expect(logical).toContain('marker-start');
 });
});

it('renders explicit endpoint cardinality consistently with crowfoot markers rather than legacy cardinality',()=>{
 const doc=upsertTableRelation(example(),{id:'explicit',sourceTableId:'t',targetTableId:'t',scope:'both',logical:{name:'연결',cardinality:'one-to-many',required:false,sourceCardinality:{min:1,max:1},targetCardinality:{min:0,max:'many'}},physical:null});
 const markup=renderToStaticMarkup(createElement(TableRelationsSvg,{document:doc,viewId:'d',viewMode:'both',onSelect:()=>{}}));
 expect(markup).toContain('1..1 → 0..N');
 expect(markup).not.toContain(' · 1:N');
 expect(markup).toContain('marker-start="url(#table-crow-explicit-0)"');
 expect(markup).toContain('marker-end="url(#table-crow-explicit-1)"');
});

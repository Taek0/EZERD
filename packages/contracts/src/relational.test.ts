import { describe, expect, it } from 'vitest';
import { designDocumentSchema, createThreadSchema, createMessageSchema } from './index.js';
const base = {schemaVersion:1,domains:[{id:'d',name:'주문',description:'',color:'#305be7'}],domainRelations:[],notes:[],layout:{nodes:[],viewports:[]}};
const metadata = {common:{},logical:{},physical:{}};
const table = {id:'t',domainId:'d',scope:'both',logical:{name:'주문',definition:''},physical:{name:'orders',schema:'public',comment:''},customProperties:metadata};
describe('relational and review API contracts',()=>{
 it('preserves legacy documents and saves structured physical/logical properties without merging them',()=>{
  const doc={...base,tables:[table],columns:[{id:'c',tableId:'t',scope:'both',logical:{name:'금액',definition:'업무',semanticType:'금액',required:true},physical:{name:'amount',type:{name:'numeric',precision:12,scale:2,isArray:false},nullable:true,defaultExpression:null,comment:''},customProperties:metadata}],keys:[],tableRelations:[]};
  expect(designDocumentSchema.parse(doc)).toEqual(doc);
  expect(designDocumentSchema.safeParse({...base,domains:[{id:'d',name:'',description:''}]}).success).toBe(true);
  expect(designDocumentSchema.safeParse({...doc,tables:[{...table,id:'d'}]}).success).toBe(false);
 });
 it('rejects unsupported shape, invalid colors and invalid type parameters but saves unknown type drafts',()=>{
  expect(designDocumentSchema.safeParse({...base,domains:[{...base.domains[0],color:'url(evil)'}]}).success).toBe(false);
  expect(designDocumentSchema.safeParse({...base,tables:[{...table,physical:{...table.physical,injected:true}}]}).success).toBe(false);
 });
 it('requires stable authors and finite pin coordinates, limits bodies, and normalizes mention IDs',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  expect(createThreadSchema.parse({authorId:id,viewId:'overview',objectId:null,x:1.5,y:-2,body:' hello ',mentionIds:[id,id]}).mentionIds).toEqual([id]);
  expect(createMessageSchema.safeParse({authorId:id,body:' ',mentionIds:[]}).success).toBe(false);
  expect(createThreadSchema.safeParse({authorId:id,viewId:'overview',objectId:null,x:Infinity,y:0,body:'hi',mentionIds:[]}).success).toBe(false);
 });
});

it('round-trips optional table display preferences and rejects invalid flags',()=>{
 const doc={...base,tables:[{...table,canvasDisplay:{showNullable:false,showComment:false}}]};
 expect(designDocumentSchema.parse(doc)).toEqual(doc);
 expect(designDocumentSchema.safeParse({...base,tables:[{...table,canvasDisplay:{showNullable:'no'}}]}).success).toBe(false);
});

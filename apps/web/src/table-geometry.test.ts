import {describe,it,expect} from 'vitest';
import {type DesignDocument} from '@ezerd/model';
import {tableCardSize} from './table-geometry.js';
import {relationGeometry} from './TableEditor.js';
const base={tables:[{id:'t',scope:'physical',physical:{name:'users'}}],columns:[]} as unknown as DesignDocument;
describe('table content bounds',()=>{
 it('grows for additional rows and long comments without shrinking saved sizes',()=>{
  const empty=tableCardSize(base,'t',1,1);
  const column={id:'c',tableId:'t',scope:'physical',physical:{name:'id',type:{name:'integer'},comment:'설명'.repeat(100)}};
  const large={...base,columns:Array.from({length:10},(_,i)=>({...column,id:String(i)}))} as unknown as DesignDocument;
  expect(tableCardSize(large,'t',1,1).height).toBeGreaterThan(empty.height);
  expect(tableCardSize(large,'t',1,1).width).toBeGreaterThan(empty.width);
  expect(tableCardSize(base,'t',1800,1500)).toEqual({width:1800,height:1500});
 });
 it('ignores hidden logical columns',()=>{
  const hidden={...base,columns:[{tableId:'t',scope:'logical',physical:{name:'x'.repeat(1000),type:{name:'text'},comment:'x'.repeat(1000)}}]} as unknown as DesignDocument;
  expect(tableCardSize(hidden,'t',1,1)).toEqual(tableCardSize(base,'t',1,1));
 });
});
it('every routed segment stays orthogonal including adjusted and self relations',()=>{
 const a={x:0,y:100,width:480,height:280};
 for(const b of [a,{x:900,y:220,width:480,height:280},{x:0,y:700,width:480,height:280}])for(const offset of [0,32,192]){
  const line=relationGeometry(a,b,160,0,offset);expect(line.path).not.toMatch(/[CQ]/);
  const values=line.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  for(let i=2;i<values.length;i+=2)expect(values[i]===values[i-2]||values[i+1]===values[i-1]).toBe(true);
 }
});

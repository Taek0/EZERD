import { expect,it } from 'vitest';
import { layoutDomainRelations } from './domain-relations.js';
const nodes=[{objectId:'a',x:0,y:0,width:240,height:210},{objectId:'b',x:500,y:0,width:240,height:210},{objectId:'c',x:500,y:330,width:240,height:210}];
const r=(id:string,from='a',to='b')=>({id,sourceDomainId:from,targetDomainId:to,name:id,direction:'forward' as const,description:''});
it('separates all endpoints on a shared card, including reversed and multiple-neighbor relations',()=>{
 const relations=[r('one'),r('two'),r('reverse','b','a'),r('other','a','c')];
 const routes=layoutDomainRelations(relations,nodes);
 const aPoints=relations.map(item=>item.sourceDomainId==='a'?routes.get(item.id)!.start:routes.get(item.id)!.end);
 expect(new Set(aPoints.map(point=>JSON.stringify(point))).size).toBe(4);
 expect(new Set(relations.slice(0,3).map(item=>JSON.stringify(item.sourceDomainId==='b'?routes.get(item.id)!.start:routes.get(item.id)!.end))).size).toBe(3);
 for(const route of routes.values())expect(route.path).not.toMatch(/NaN|Infinity/);
});
it('keeps stable assignment under relation reordering and recomputes card boundaries after resize/move',()=>{
 const relations=[r('one'),r('two')];const first=layoutDomainRelations(relations,nodes);const second=layoutDomainRelations([...relations].reverse(),nodes);
 expect(second.get('one')).toEqual(first.get('one'));
 const resized=[{...nodes[0]!,x:40,width:300,height:300},nodes[1]!];const next=layoutDomainRelations(relations,resized);
 expect(next.get('one')!.start.x).toBe(340);expect(next.get('one')!.start.y).toBeGreaterThan(0);expect(next.get('one')!.start.y).toBeLessThan(300);
 expect(nodes[0]!.width).toBe(240);
});
it('supports self and bidirectional links without coincident tips and skips missing targets',()=>{
 const relations=[r('self','a','a'),{...r('both'),direction:'both' as const},r('missing','a','gone')];const routes=layoutDomainRelations(relations,nodes);
 expect(routes.size).toBe(2);expect(routes.get('self')!.start).not.toEqual(routes.get('self')!.end);
 expect(routes.get('self')!.path).toContain('C');
});
it('uses other card faces for a dense fan while retaining distinct well-spaced tips',()=>{
 const relations=Array.from({length:20},(_,i)=>r(`r${String(i).padStart(2,'0')}`));const routes=layoutDomainRelations(relations,nodes);
 const starts=[...routes.values()].map(value=>value.start);expect(new Set(starts.map(p=>JSON.stringify(p))).size).toBe(20);
 expect(starts.some(p=>p.y===0||p.y===210)).toBe(true);
 for(let i=0;i<starts.length;i++)for(let j=i+1;j<starts.length;j++)expect(Math.hypot(starts[i]!.x-starts[j]!.x,starts[i]!.y-starts[j]!.y)).toBeGreaterThanOrEqual(16);
});

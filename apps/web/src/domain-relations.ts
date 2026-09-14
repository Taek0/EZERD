import type { DomainRelation } from '@ezerd/model';
export interface DomainBounds {objectId:string;x:number;y:number;width:number;height:number}
type Point={x:number;y:number};
type Side='left'|'right'|'top'|'bottom';
export interface DomainRelationGeometry {start:Point;end:Point;path:string;label:Point}
interface Port {key:string;relationId:string;side:Side;node:DomainBounds;other:DomainBounds}
const sides:Side[]=['left','right','top','bottom'];
const normals:Record<Side,Point>={left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
const center=(node:DomainBounds):Point=>({x:node.x+node.width/2,y:node.y+node.height/2});
const vertical=(side:Side)=>side==='left'||side==='right';
const span=(port:Port)=>vertical(port.side)?port.node.height:port.node.width;
const margin=(length:number)=>Math.min(24,length/4);
function preferred(node:DomainBounds,other:DomainBounds):Side {
 const a=center(node),b=center(other);let dx=b.x-a.x,dy=b.y-a.y;
 if(dx===0&&dy===0)dx=node.objectId<other.objectId?1:-1;
 return Math.abs(dx)/node.width>=Math.abs(dy)/node.height?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
}
/** Distribute ports per card, not just per pair: incoming and outgoing links share lanes. */
export function layoutDomainRelations(relations:DomainRelation[],nodes:DomainBounds[]):Map<string,DomainRelationGeometry> {
 const nodeMap=new Map(nodes.map(node=>[node.objectId,node]));
 const valid=relations.filter(r=>nodeMap.has(r.sourceDomainId)&&nodeMap.has(r.targetDomainId)).toSorted((a,b)=>a.id.localeCompare(b.id));
 const portMap=new Map<string,Port>();
 const byNode=new Map<DomainBounds,Map<Side,Port[]>>();
 const addPort=(port:Port)=>{portMap.set(port.key,port);let groups=byNode.get(port.node);if(!groups){groups=new Map(sides.map(side=>[side,[] as Port[]]));byNode.set(port.node,groups);}groups.get(port.side)!.push(port);};
 for(const relation of valid){
  const a=nodeMap.get(relation.sourceDomainId)!,b=nodeMap.get(relation.targetDomainId)!;
  addPort({key:relation.id+':source',relationId:relation.id,node:a,other:b,side:a===b?'right':preferred(a,b)});
  addPort({key:relation.id+':target',relationId:relation.id,node:b,other:a,side:a===b?'top':preferred(b,a)});
 }
 // Use adjacent free faces for dense fans before compressing arrowhead spacing.
 for(const node of nodes){
  const groups=byNode.get(node);if(!groups)continue;
  const capacity=(side:Side)=>{const length=vertical(side)?node.height:node.width;return Math.max(1,Math.floor((length-2*margin(length))/16));};
  for(const side of sides){
   const group=groups.get(side)!;
   while(group.length>capacity(side)){
    const port=group[group.length-1]!;const from=center(node),to=center(port.other);
    const candidates=sides.filter(candidate=>candidate!==side&&groups.get(candidate)!.length<capacity(candidate));
    candidates.sort((a,b)=>((to.x-from.x)*normals[b].x+(to.y-from.y)*normals[b].y)-((to.x-from.x)*normals[a].x+(to.y-from.y)*normals[a].y));
    if(!candidates.length)break;
    const target=candidates[0]!;group.pop();port.side=target;groups.get(target)!.push(port);
   }
  }
 }
 const points=new Map<string,Point>();
 for(const node of nodes)for(const side of sides){
  const group=(byNode.get(node)?.get(side)??[]).sort((a,b)=>{
   const ac=center(a.other),bc=center(b.other);const position=vertical(side)?ac.y-bc.y:ac.x-bc.x;
   return position||a.relationId.localeCompare(b.relationId)||a.key.localeCompare(b.key);
  });
  group.forEach((port,index)=>{const length=span(port),inset=margin(length),at=inset+(length-2*inset)*(index+.5)/group.length;
   points.set(port.key,vertical(side)?{x:node.x+(side==='right'?node.width:0),y:node.y+at}:{x:node.x+at,y:node.y+(side==='bottom'?node.height:0)});
  });
 }
 const result=new Map<string,DomainRelationGeometry>();
 for(const relation of valid){
  const a=portMap.get(relation.id+':source')!,b=portMap.get(relation.id+':target')!;
  const start=points.get(a.key)!,end=points.get(b.key)!;
  const reach=a.node===b.node?Math.max(a.node.width,a.node.height)+48:Math.max(40,Math.min(180,Math.hypot(end.x-start.x,end.y-start.y)*.35));
  const one={x:start.x+normals[a.side].x*reach,y:start.y+normals[a.side].y*reach};
  const two={x:end.x+normals[b.side].x*reach,y:end.y+normals[b.side].y*reach};
  result.set(relation.id,{start,end,path:`M ${start.x} ${start.y} C ${one.x} ${one.y} ${two.x} ${two.y} ${end.x} ${end.y}`,label:{x:(start.x+3*one.x+3*two.x+end.x)/8,y:(start.y+3*one.y+3*two.y+end.y)/8-10}});
 }
 return result;
}

import { type DesignDocument, upsertCombinedView, setViewport } from '@ezerd/model';
import { tableCardSize } from './table-geometry.js';
export function applyDomainSelection(doc:DesignDocument,domainIds:string[],preferredViewId:string|null,createId:()=>string):{document:DesignDocument;viewId:string}{
 const selectedIds=doc.domains.filter(d=>domainIds.includes(d.id)).map(d=>d.id);
 const current=doc.views?.find(v=>v.id===preferredViewId)??doc.views?.[0];
 const viewId=current?.id??createId();
 let next=upsertCombinedView(doc,{id:viewId,name:'도메인 뷰',domainIds:selectedIds});
 const positions=new Map<string,{x:number;y:number;width:number;height:number}>();let offsetX=0;
 for(const domainId of selectedIds){
  const originals=(doc.tables??[]).filter(t=>t.domainId===domainId).flatMap(t=>{const source=doc.layout.nodes.find(n=>n.viewId===domainId&&n.objectId===t.id);return source?[{objectId:t.id,x:source.x,y:source.y,...tableCardSize(doc,t.id,source.width,source.height)}]:[];});
  if(!originals.length)continue;
  const minX=Math.min(...originals.map(n=>n.x)),minY=Math.min(...originals.map(n=>n.y)),maxX=Math.max(...originals.map(n=>n.x+n.width));
  for(const n of originals)positions.set(n.objectId,{x:offsetX+n.x-minX,y:n.y-minY,width:n.width,height:n.height});
  offsetX+=maxX-minX+180;
 }
 next={...next,layout:{...next.layout,nodes:next.layout.nodes.map(n=>n.viewId===viewId&&positions.has(n.objectId)?{...n,...positions.get(n.objectId)!}:n),...(next.layout.relations&&{relations:next.layout.relations.filter(r=>r.viewId!==viewId)})}};
 return {document:setViewport(next,{viewId,x:40,y:120,zoom:1}),viewId};
}

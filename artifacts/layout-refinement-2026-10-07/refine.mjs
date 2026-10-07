import { readFileSync, writeFileSync } from 'node:fs';
import { nativeTableCanvasMetrics, nativeRelationLabelWidth } from '../../apps/web/src/features/projects/native-canvas-style.ts';
import { nativeCanvasSvg } from '../../apps/web/src/features/projects/native-canvas-png.ts';
import { relationGeometry, segmentCrossesBounds } from '../../apps/web/src/features/relations/relation-routing.ts';
const root = 'artifacts/layout-refinement-2026-10-07/';
const state = JSON.parse(readFileSync(root+'before.json','utf8'));
const doc = structuredClone(state.sourceDocument);
const edges = doc.tableRelations;
const commands=[];
const table = name => doc.tables.find(t=>t.physical.name===name);
const pos={
  users:[2400,0], workspace:[0,0], projects:[4800,0],
  sessions:[3180,0], mcp_tokens:[3180,520],
  user_workspaces:[780,0], workspace_invitations:[780,480], workspace_audit_events:[0,650],
  project_personal_states:[5580,0], project_personal_operations:[5580,500], project_database_operations:[5580,1000],
  sync_operations:[2400,2100], native_request_cancellations:[3180,2100],
  sync_client_baselines:[3960,2100], sync_field_versions:[3180,2920], sync_tombstones:[3960,2920],
  review_threads:[0,2100], review_messages:[780,2100], review_notifications:[780,2600],
};
function move(node,p){commands.push({type:'update_node_layout',nodeId:node.id,patch:p});Object.assign(node,p);}
for(const t of doc.tables){const m=nativeTableCanvasMetrics(doc,t,'physical');const [x,y]=pos[t.physical.name];const p={x,y,width:Math.ceil(Math.max(m.width,540)),height:Math.ceil(m.height)};
  // Also repair retained legacy domain placements so old readers cannot overlap notes.
  for(const n of doc.layout.nodes.filter(n=>n.objectId===t.id)) move(n,p);
}
const notesX={'reference-guide-auth':3900,'workspace-foundation-guide':1500,'reference-guide-project':6300,'reference-guide-sync':4800,'reference-guide-review':1500,'repository-sync-guide-2026-10-07':6300};
for(const note of doc.notes){const n=doc.layout.nodes.find(n=>n.objectId===note.id);let lines=0;const width=740;
  for(const p of note.text.split('\n')){let w=0;for(const c of p)w+=(c.charCodeAt(0)>255?15:9.3);lines+=Math.max(1,Math.ceil(w/(width-40)));}
  move(n,{x:notesX[note.id]??6300,y:['reference-guide-sync','reference-guide-review','repository-sync-guide-2026-10-07'].includes(note.id)?2100:0,width,height:Math.ceil(70+lines*25.5)});
}
const tables=doc.layout.nodes.filter(n=>n.viewId==='__tables__'&&doc.tables.some(t=>t.id===n.objectId));
// Every note is an obstacle, including retained domain notes shown by older readers.
const nodes=[...tables,...doc.layout.nodes.filter(n=>doc.notes.some(t=>t.id===n.objectId))];
const byId=new Map(nodes.map(n=>[n.objectId,n]));
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const seg=points=>points.slice(1).map((b,i)=>[points[i],b]);
function simplify(raw){const out=[];for(const p of raw){if(out.length&&distance(out.at(-1),p)<1e-6)continue;while(out.length>1&&((out.at(-2).x===out.at(-1).x&&p.x===out.at(-1).x)||(out.at(-2).y===out.at(-1).y&&p.y===out.at(-1).y))&&distance(out.at(-2),out.at(-1))+distance(out.at(-1),p)===distance(out.at(-2),p))out.pop();out.push(p);}return out;}
const rectHit=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
function pair(a,b){let overlap=0,crossings=0;for(const[p,q]of a.segments)for(const[r,s]of b.segments){const h=p.y===q.y,k=r.y===s.y;if(h===k){if(h?p.y===r.y:p.x===r.x)overlap+=Math.max(0,Math.min(h?Math.max(p.x,q.x):Math.max(p.y,q.y),h?Math.max(r.x,s.x):Math.max(r.y,s.y))-Math.max(h?Math.min(p.x,q.x):Math.min(p.y,q.y),h?Math.min(r.x,s.x):Math.min(r.y,s.y)));}else{const[u,v,w,z]=h?[p,q,r,s]:[r,s,p,q];if(w.x>Math.min(u.x,v.x)&&w.x<Math.max(u.x,v.x)&&u.y>Math.min(w.y,z.y)&&u.y<Math.max(w.y,z.y))crossings++;}}return{overlap,crossings,labelOverlap:a.label&&b.label&&rectHit(a.label,b.label)?1:0};}
function port(edge,id,side){const n=byId.get(id);const peers=edges.filter(e=>e.sourceTableId===id||e.targetTableId===id).sort((a,b)=>{const other=e=>byId.get(e.sourceTableId===id?e.targetTableId:e.sourceTableId);const aa=other(a),bb=other(b);return (side==='top'||side==='bottom'?aa.x-bb.x:aa.y-bb.y)||a.id.localeCompare(b.id);});const ratio=(peers.indexOf(edge)+1)/(peers.length+1);const dx=side==='left'?-1:side==='right'?1:0,dy=side==='top'?-1:side==='bottom'?1:0;const x=dx?(dx<0?n.x:n.x+n.width):n.x+n.width*ratio,y=dy?(dy<0?n.y:n.y+n.height):n.y+n.height*ratio;return{anchor:{side,ratio},tip:{x:x+8*dx,y:y+8*dy},stub:{x:x+52*dx,y:y+52*dy},dx,dy};}
const choices=edges.map((e,i)=>{const out=[],seen=new Set();const a=byId.get(e.sourceTableId),b=byId.get(e.targetTableId);const xs=[...new Set(tables.flatMap(n=>[n.x-90-i*3,n.x+n.width+90+i*3]))];const ys=[...new Set(tables.flatMap(n=>[n.y-70-i*3,n.y+n.height+70+i*3]))];
  for(const ss of ['top','left','right','bottom'])for(const ts of ['bottom','right','left','top']){const s=port(e,e.sourceTableId,ss),t=port(e,e.targetTableId,ts),u=s.stub,v=t.stub;
    const add=middle=>{const p=simplify([s.tip,u,...middle,v,t.tip]);if((p[1].x-s.tip.x)*s.dx+(p[1].y-s.tip.y)*s.dy<=0||(p.at(-2).x-t.tip.x)*t.dx+(p.at(-2).y-t.tip.y)*t.dy<=0)return;const key=JSON.stringify(p);if(seen.has(key))return;seen.add(key);const segments=seg(p);if(segments.some(([p,q])=>nodes.some(n=>segmentCrossesBounds(p,q,{...n,x:n.x-10,y:n.y-10,width:n.width+20,height:n.height+20})&&n!==a&&n!==b))||segments.some(([p,q])=>[a,b].some(n=>segmentCrossesBounds(p,q,n))))return;
      const route={relationId:e.id,viewId:'__tables__',offset:0,sourceAnchor:s.anchor,targetAnchor:t.anchor,waypoints:p.slice(1,-1)};
      const length=segments.reduce((sum,[p,q])=>sum+distance(p,q),0); const lw=nativeRelationLabelWidth(e.physical.name); const ls=[...segments].sort((a,b)=>distance(...b)-distance(...a)); const chosen=ls.find(([p,q])=>p.y===q.y&&distance(p,q)>=lw+16)??ls[0]; const label={x:(chosen[0].x+chosen[1].x)/2-lw/2-6,y:(chosen[0].y+chosen[1].y)/2-36,width:lw+12,height:32}; for(let j=0;j<nodes.length+2;j++){const hit=nodes.find(n=>rectHit(n,label));if(!hit)break;label.y=hit.y-52;} out.push({points:p,segments,route,length,label,penalty:(ss==='bottom'?250:0)+(ts==='top'?250:0)});
    };
    add([{x:u.x,y:v.y}]);add([{x:v.x,y:u.y}]);
    for(const x of xs)add([{x,y:u.y},{x,y:v.y}]);
    for(const y of ys)add([{x:u.x,y},{x:v.x,y}]);
  }
  if(!out.length)throw Error('No route '+e.id);
  // Preserve diverse directions, while limiting optimization cost.
  out.sort((a,b)=>a.length+a.penalty-b.length-b.penalty);
  return out.slice(0,200);
});
function stats(routes){let overlap=0,crossings=0,labelOverlaps=0;for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){const c=pair(routes[i],routes[j]);overlap+=c.overlap;crossings+=c.crossings;labelOverlaps+=c.labelOverlap;}return{labelOverlaps,overlapPixels:Math.round(overlap),crossings,length:Math.round(routes.reduce((s,r)=>s+r.length,0))};}
let best,bestScore=Infinity;
for(let trial=0;trial<80;trial++){const selected=[];const order=edges.map((_,i)=>i).sort((a,b)=>Math.sin((a+1)*(trial+1)*127.1)-Math.sin((b+1)*(trial+1)*127.1));for(let pass=0;pass<5;pass++)for(const i of order){let winner,cost=Infinity;for(const c of choices[i]){let value=c.length+c.penalty+c.segments.length*30;for(let j=0;j<selected.length;j++)if(i!==j&&selected[j]){const p=pair(c,selected[j]);value+=p.overlap*1000000+p.crossings*20000+p.labelOverlap*200000;}if(value<cost){cost=value;winner=c;}}selected[i]=winner;}const m=stats(selected),score=m.overlapPixels*1e6+m.crossings*20000+m.labelOverlaps*200000+m.length;if(score<bestScore){bestScore=score;best=selected;}}
const rendered=best.map((r,i)=>{const e=edges[i],a=byId.get(e.sourceTableId),b=byId.get(e.targetTableId);const label=e.physical.name;const geometry=relationGeometry(a,b,nativeRelationLabelWidth(label),i,0,undefined,nodes.filter(n=>n!==a&&n!==b),r.route);return{...r,points:geometry.points,segments:seg(geometry.points),geometry,label,relation:e};});
const metrics=stats(rendered);metrics.cardIntersections=rendered.reduce((sum,r)=>sum+r.segments.filter(([a,b])=>nodes.some(n=>segmentCrossesBounds(a,b,n))).length,0);
metrics.rendererChanges=rendered.filter((r,i)=>JSON.stringify(r.points)!==JSON.stringify(best[i].points)).length;
metrics.cardOverlaps=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(!(a.x+a.width+40<=b.x||b.x+b.width+40<=a.x||a.y+a.height+40<=b.y||b.y+b.height+40<=a.y))metrics.cardOverlaps.push([a.objectId,b.objectId]);}
for(const r of rendered)commands.push({type:'upsert_relation_layout',value:r.route});
doc.layout.relations=rendered.map(r=>r.route);
// Mirror shared relation geometry for old readers using domain-local nodes.
for(const domain of doc.domains)for(const r of rendered){const ids=new Set(doc.layout.nodes.filter(n=>n.viewId===domain.id).map(n=>n.objectId));if(ids.has(r.relation.sourceTableId)&&ids.has(r.relation.targetTableId)){const value={...r.route,viewId:domain.id};commands.push({type:'upsert_relation_layout',value});doc.layout.relations.push(value);}}
const scene={nodes:[...tables,...nodes.filter(n=>n.viewId==='__tables__'&&!tables.includes(n))],relations:rendered,viewId:'__tables__'};
const preview=nativeCanvasSvg(doc,scene,'physical');writeFileSync(root+'preview.svg',preview.svg);
const panels=doc.domains.map(domain=>{const domainNodes=nodes.filter(n=>doc.tables.find(t=>t.id===n.objectId)?.domainId===domain.id||doc.notes.find(t=>t.id===n.objectId)?.viewId===domain.id);const ids=new Set(domainNodes.map(n=>n.objectId));const relations=rendered.filter(r=>ids.has(r.relation.sourceTableId)&&ids.has(r.relation.targetTableId));const svg=nativeCanvasSvg(doc,{nodes:domainNodes,relations,viewId:domain.id},'physical').svg;writeFileSync(root+`domain-${domain.id}.svg`,svg);return `<details><summary>${domain.name}</summary>${svg}</details>`;}).join('');
writeFileSync(root+'preview.html',`<!doctype html><meta charset="utf-8"><title>EZERD layout preview</title><style>body{margin:0;background:#f6f8fb;font:16px sans-serif}svg{width:100%;height:auto}summary{padding:12px;cursor:pointer}</style><details open><summary>전체 테이블</summary>${preview.svg}</details>${panels}`);
writeFileSync(root+'expected.json',JSON.stringify(doc,null,2));writeFileSync(root+'commands.json',JSON.stringify(commands,null,2));writeFileSync(root+'metrics.json',JSON.stringify(metrics,null,2));console.log(JSON.stringify({commands:commands.length,choices:choices.map(c=>c.length),metrics},null,2));
if(metrics.overlapPixels||metrics.cardIntersections||metrics.rendererChanges||metrics.cardOverlaps.length)process.exitCode=1;




import{readFileSync,writeFileSync}from'node:fs';
import{layoutDomainRelations}from'../../apps/web/src/features/domains/domain-relations.ts';
const root='artifacts/domain-layout-2026-10-08/';
const state=JSON.parse(readFileSync(root+'before.json','utf8')),doc=state.sourceDocument;
const ids=['auth','6b9ee6c3-d607-4cc9-97a7-d236499ec4f4','project','review','sync'];
function measure(nodes){const routes=[...layoutDomainRelations(doc.domainRelations,nodes)].map(([id,g])=>{const n=g.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);const points=Array.from({length:81},(_,i)=>{const t=i/80,u=1-t;return{x:u**3*n[0]+3*u*u*t*n[2]+3*u*t*t*n[4]+t**3*n[6],y:u**3*n[1]+3*u*u*t*n[3]+3*u*t*t*n[5]+t**3*n[7]};});return{id,...g,points};});let hits=0,crossings=0;
for(const r of routes){const e=doc.domainRelations.find(e=>e.id===r.id);for(const n of nodes.filter(n=>n.objectId!==e.sourceDomainId&&n.objectId!==e.targetDomainId))if(r.points.some(p=>p.x>n.x-8&&p.x<n.x+n.width+8&&p.y>n.y-8&&p.y<n.y+n.height+8))hits++;}
const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){let hit=false;for(let k=1;k<routes[i].points.length&&!hit;k++)for(let l=1;l<routes[j].points.length;l++){const a=routes[i].points[k-1],b=routes[i].points[k],c=routes[j].points[l-1],d=routes[j].points[l];if(orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0){hit=true;break;}}if(hit)crossings++;}
return{routes,hits,crossings};}
let best;
for(const gap of[500,580,660])for(const wy of[-480,-320,320,480])for(const py of[-160,0,160])for(const ry of[-640,-480,-320])for(const sy of[320,480,640]){const offsets=[0,wy,py,ry,sy];const nodes=ids.map((id,i)=>({...doc.layout.nodes.find(n=>n.viewId==='overview'&&n.objectId===id),x:80+Math.min(i,3)*gap,y:80+offsets[i]-Math.min(...offsets),width:320,height:240}));const m=measure(nodes);const height=Math.max(...nodes.map(n=>n.y+240))-80,score=m.hits*1e8+m.crossings*1e6+height*100+gap;if(!best||score<best.score)best={score,nodes,...m};}
const commands=best.nodes.map(n=>({type:'update_node_layout',nodeId:n.id,patch:{x:n.x,y:n.y,width:n.width,height:n.height}}));
writeFileSync(root+'commands.json',JSON.stringify(commands,null,2));writeFileSync(root+'verification.json',JSON.stringify({cardIntersections:best.hits,curveCrossings:best.crossings,nodes:best.nodes},null,2));console.log(JSON.stringify({cardIntersections:best.hits,curveCrossings:best.crossings,nodes:best.nodes},null,2));
if(best.hits)process.exitCode=1;

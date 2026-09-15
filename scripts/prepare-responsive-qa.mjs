import { writeFile, unlink } from 'node:fs/promises';
const target = new URL('../apps/web/__responsive-qa.html', import.meta.url);
if (process.argv.includes('--clean')) {
  await unlink(target);
  process.exit(0);
}
await writeFile(
  target,
  `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '/src/App.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';
import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey,setViewport} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/tokens.css';import '/src/components/ui/ui.css';import '/src/styles.css';import '/src/inspector.css';
const now=new Date().toISOString(),pid='00000000-0000-4000-8000-000000000001';
const user={id:'00000000-0000-4000-8000-000000000002',username:'responsive-qa',color:'#4169e1',createdAt:now,updatedAt:now};
const project={id:pid,name:'klassboard-backend-refactor',status:'active',version:0,createdAt:now,updatedAt:now};
let doc=addDomain(createEmptyDocument(),{id:'d',name:'주문',description:'주문과 상품 데이터',color:'#4169e1'},{x:30,y:30});const meta={common:{},logical:{},physical:{}};
for(const [id,x] of [['orders',20],['products',700]]){doc=addTable(doc,{id,domainId:'d',scope:'physical',logical:{name:id,definition:''},physical:{name:id,schema:'public',comment:''},customProperties:meta},{x,y:30});doc=addColumn(doc,{id:id+'-id',tableId:id,scope:'physical',logical:{name:'id',definition:'',semanticType:'',required:true},physical:{name:'id',type:{name:'uuid',isArray:false},nullable:false,defaultExpression:null,comment:''},customProperties:meta});doc=upsertKey(doc,{id:id+'-pk',tableId:id,scope:'physical',kind:'primary',name:'',columnIds:[id+'-id']});}
doc=createForeignKeyFromPrimaryKey(doc,{relationId:'r',primaryTableId:'orders',foreignTableId:'products',primaryKeyId:'orders-pk',columnIds:['fk']});doc=setViewport(doc,{viewId:'d',x:20,y:30,zoom:.65});
let seq=0;const originalFetch=window.fetch.bind(window);const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
window.fetch=async(input,init={})=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(!path.startsWith('/api/'))return originalFetch(input,init);const body=init.body?JSON.parse(init.body):{};
if(path==='/api/sessions')return json({token:'fixture-only-session-token-not-valid-on-server',expiresAt:'2099-01-01T00:00:00.000Z',baselineIssuedAt:now,user});
if(path==='/api/users')return json(init.method==='POST'?user:[user]);if(path.startsWith('/api/users/'))return json(path.includes('/notifications')?[]:user);
if(path==='/api/projects')return json([project]);if(path.endsWith('/sync-baseline'))return json({baselineId:crypto.randomUUID(),sequence:seq,baselineIssuedAt:now,document:doc});
if(path.endsWith('/history')||path.endsWith('/events')||path.endsWith('/threads'))return json([]);
if(path.endsWith('/operations')&&init.method==='POST'){doc=body.document;seq++;return json({operationId:body.operationId,groupId:body.groupId,sequence:seq,status:'accepted',actor:{id:user.id,username:user.username,color:user.color},changedPaths:body.changes.map(c=>c.path),createdAt:now,nextBaseline:{baselineId:crypto.randomUUID(),baseSequence:seq,baselineIssuedAt:now},document:doc});}
if(path==='/api/projects/'+pid)return json({project,document:doc});throw new Error('Unmocked fixture API '+path);};
class FixtureSocket {static OPEN=1;readyState=1;constructor(){setTimeout(()=>this.onopen?.(),10);}send(raw){const m=JSON.parse(raw);if(m.type==='subscribe')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'subscribed',projectId:pid,sequence:seq})}));}close(){this.readyState=3;}}
window.WebSocket=FixtureSocket;
createRoot(document.getElementById('root')).render(React.createElement(ConfirmProvider,null,React.createElement(App)));
</script></body></html>`,
);
console.log('Created /__responsive-qa.html (in-memory API; no database writes)');

import type { DesignDocument } from '@ezerd/model';
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
/** Bounded immutable history. Group boundaries belong to the UI gesture lifecycle. */
export class DocumentHistory<T> {
 private past:T[]=[];
 private future:T[]=[];
 private present:T;
 private group:string|null=null;
 constructor(initial:T,private readonly limit=100){this.present=copy(initial);}
 get current():T{return copy(this.present);}
 get canUndo(){return this.past.length>0;}
 get canRedo(){return this.future.length>0;}
 record(next:T,groupKey:string|null=null):boolean {
  if(same(this.present,next))return false;
  if(groupKey===null||this.group!==groupKey){this.past.push(this.present);if(this.past.length>this.limit)this.past.shift();}
  this.present=copy(next);this.future=[];this.group=groupKey;return true;
 }
 replaceCurrent(next:T){this.present=copy(next);}
 endGroup(){this.group=null;}
 reset(next:T){this.present=copy(next);this.past=[];this.future=[];this.group=null;}
 undo():T|null {this.endGroup();const previous=this.past.pop();if(previous===undefined)return null;this.future.push(this.present);this.present=previous;return this.current;}
 redo():T|null {this.endGroup();const next=this.future.pop();if(next===undefined)return null;this.past.push(this.present);this.present=next;return this.current;}
}
/** Only persisted design changes are undoable; camera movement uses replaceCurrent. */
export function documentEditGroup(before:DesignDocument,after:DesignDocument):string|null {
 const withoutCamera=(doc:DesignDocument)=>({...doc,layout:{...doc.layout,viewports:[]}});
 if(same(withoutCamera(before),withoutCamera(after)))return '@viewport';
 const arrays:{name:string;before:unknown[];after:unknown[];key:(item:any)=>string}[]=[];
 for(const name of ['domains','domainRelations','notes','tables','columns','keys','tableRelations','enums','views'] as const){arrays.push({name,before:before[name]??[],after:after[name]??[],key:item=>item.id});}
 arrays.push({name:'nodes',before:before.layout.nodes,after:after.layout.nodes,key:item=>item.id});
 arrays.push({name:'routes',before:before.layout.relations??[],after:after.layout.relations??[],key:item=>JSON.stringify([item.viewId,item.relationId])});
 const changed=arrays.filter(item=>!same(item.before,item.after));
 if(changed.length!==1)return null;
 const section=changed[0]!;
 const oldItems=new Map(section.before.map(item=>[section.key(item),item]));
 const newItems=new Map(section.after.map(item=>[section.key(item),item]));
 const ids=[...new Set([...oldItems.keys(),...newItems.keys()])].filter(id=>!same(oldItems.get(id),newItems.get(id)));
 if(ids.length!==1)return null;
 const id=ids[0]!;
 if(section.name!=='routes'&&(!oldItems.has(id)||!newItems.has(id)))return null;
 return `${section.name}:${id}`;
}
/** Keep the camera while undoing the design; discard camera entries for deleted views. */
export function mergeHistoryViewports(restored:DesignDocument,current:DesignDocument):DesignDocument {
 const valid=new Set(['overview',...restored.domains.map(d=>d.id),...(restored.views??[]).map(v=>v.id)]);
 const viewports=new Map(restored.layout.viewports.filter(v=>valid.has(v.viewId)).map(v=>[v.viewId,v]));
 for(const viewport of current.layout.viewports)if(valid.has(viewport.viewId))viewports.set(viewport.viewId,viewport);
 return {...restored,layout:{...restored.layout,viewports:[...viewports.values()].map(viewport=>({...viewport}))}};
}

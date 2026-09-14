import { type DesignDocument, isVisibleInView } from '@ezerd/model';
const textWidth = (value:string) => [...value].reduce((n,c)=>n+(c.charCodeAt(0)>255?15:9),0);
export function tableCardMetrics(doc:DesignDocument, tableId:string) {
 const table=doc.tables?.find(t=>t.id===tableId);
 const columns=(doc.columns??[]).filter(c=>c.tableId===tableId&&isVisibleInView(c.scope,'physical',table?.scope));
 const typeDisplays=columns.map(c=>(c.physical.type.enumId?doc.enums?.find(e=>e.id===c.physical.type.enumId)?.name??'ENUM':c.physical.type.name).toUpperCase()+(c.physical.type.isArray?'[]':''));
 const widths=[58,Math.max(110,...columns.map(c=>Math.min(240,textWidth(c.physical.name)))),Math.max(100,...typeDisplays.map(typeDisplay=>Math.min(220,textWidth(typeDisplay)))),44,Math.max(110,...columns.map(c=>Math.min(320,textWidth(c.physical.comment))))];
 const lines=(value:string,width:number)=>value.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textWidth(line)/width)),0);
 const rows=columns.map((c,index)=>Math.max(1,lines(c.physical.name,widths[1]!),lines(typeDisplays[index]!,widths[2]!),lines(c.physical.comment,widths[4]!))*22+17);
 const width=Math.max(480,widths.reduce((a,b)=>a+b,0)+24+32,textWidth(table?.physical.name??'')+32);
 return {width,height:Math.max(240,48+34+Math.max(42,rows.reduce((a,b)=>a+b,0))+56),grid:widths.map(n=>`minmax(${n}px, ${n}fr)`).join(' '),rows};
}
/** Identical content bounds for render, resize, routing, fit and export. */
export function tableCardSize(doc:DesignDocument,tableId:string,width=480,height=280) {
 const minimum=tableCardMetrics(doc,tableId);
 return {width:Math.max(width,minimum.width),height:Math.max(height,minimum.height)};
}

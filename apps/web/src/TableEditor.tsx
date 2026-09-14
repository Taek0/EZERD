import { useRef, useEffect, useState, type CSSProperties } from 'react';
import { type DesignDocument, type ModelScope, type Table, type Column, type CustomProperties, type TableRelation, type TableKey, type ReferentialAction, addTable, updateTable, removeTable, addColumn, updateColumn, removeColumn, upsertKey, removeKey, upsertTableRelation, removeTableRelation, isVisibleInView } from '@ezerd/model';
import { createPortal } from 'react-dom';
import { upsertEnum, removeEnum } from '@ezerd/model';
import { newId } from './client.js';
import './table-editor.css';
import { tableCardMetrics, tableCardSize } from './table-geometry.js';
import { SearchType } from './components/ui/SearchType.js';
import { useConfirm } from './components/ui/ConfirmProvider.js';
import { createForeignKeyFromPrimaryKey, upsertRelationLayout } from '@ezerd/model';
import { Button, Checkbox, ContextMenu, IconButton, Input, Select, Textarea } from './components/ui/index.js';
import { PanelList, PanelNote, PanelRow, PanelSection } from './panel.js';
export const physicalTypes=['uuid','integer','bigint','smallint','serial','bigserial','smallserial','boolean','text','varchar','char','numeric','decimal','real','double precision','date','time','timetz','timestamp','timestamptz','json','jsonb','bytea'];
export function typeParameterEnabled(type:Column['physical']['type'], parameter:'length'|'precision'|'scale') {
 if(type.enumId)return false;
 if(parameter==='length')return ['varchar','char','character varying','character','bit','bit varying'].includes(type.name);
 if(parameter==='scale')return ['numeric','decimal'].includes(type.name)&&type.precision!==undefined;
 return ['numeric','decimal','time','timetz','timestamp','timestamptz','interval'].includes(type.name);
}
export function canSaveKey(key:TableKey, columns:Column[], keys:TableKey[]) {
 return key.columnIds.length>0&&new Set(key.columnIds).size===key.columnIds.length&&key.columnIds.every(id=>columns.some(c=>c.id===id&&c.tableId===key.tableId&&c.scope!=='logical'))&&!keys.some(k=>k.id!==key.id&&k.tableId===key.tableId&&k.scope!=='logical'&&((key.kind==='primary'&&k.kind==='primary')||(k.kind===key.kind&&k.columnIds.length===key.columnIds.length&&k.columnIds.every((id,i)=>id===key.columnIds[i]))));
}
export const emptyMetadata = (): CustomProperties => ({ common: {}, logical: {}, physical: {} });
const emptyMeta = emptyMetadata;
const tableName = (t: Table) => t.physical.name || '이름 없는 테이블';
const columnName = (c: Column) => c.physical.name || '이름 없는 컬럼';
export function parseMetadata(text: string): Record<string, string> {
    const value: unknown = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.entries(value).some(([key, v]) => !key.trim() || key.length > 120 || typeof v !== 'string' || v.length > 10000) || Object.keys(value).length > 100)
        throw new Error('최대 100개, 키 120자 / 문자열 값 10,000자까지 입력하세요.');
    return value as Record<string, string>;
}
export function moveColumn(doc: DesignDocument, id: string, direction: number): DesignDocument {
    const cols = [...(doc.columns ?? [])], at = cols.findIndex(c => c.id === id);
    if (at < 0)
        return doc;
    const indices = cols.flatMap((c, i) => c.tableId === cols[at]!.tableId ? [i] : []), to = indices[indices.indexOf(at) + direction];
    if (to === undefined)
        return doc;
    [cols[at], cols[to]] = [cols[to]!, cols[at]!];
    return { ...doc, columns: cols };
}
export function setMappingPair<T extends {
    sourceColumnIds: string[];
    targetColumnIds: string[];
}>(mapping: T, index: number, side: 'source' | 'target', value: string): T {
    const key = side === 'source' ? 'sourceColumnIds' : 'targetColumnIds';
    const ids = [...mapping[key]];
    ids[index] = value;
    return { ...mapping, [key]: ids };
}
function TextField({ label, value, onChange, max = 10000 }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    max?: number;
}) { return <label>{label}<Input value={value} maxLength={max} onChange={e => onChange(e.target.value)}/></label>; }
function Check({ label, value, onChange }: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
}) { return <label className="table-check"><Checkbox checked={value} onChange={e => onChange(e.target.checked)}/>{label}</label>; }
function InlineCell({value, label, onCommit, disabled = false}: {value:string;label:string;onCommit:(value:string)=>void;disabled?:boolean}) {
    const [editing,setEditing]=useState(false), [draft,setDraft]=useState(value); const cancel=useRef(false);
    const commit=()=>{if(!cancel.current && draft!==value)onCommit(draft);setEditing(false);};
    return editing ? <Input autoFocus aria-label={label} value={draft} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){cancel.current=true;setEditing(false);}if(e.key==='Enter'){e.preventDefault();commit();}}}/> : <span className="table-inline" title={`${label}: ${value || '미입력'}${disabled?'':' · 더블클릭하여 편집'}`} onDoubleClick={e=>{if(disabled)return;e.stopPropagation();cancel.current=false;setDraft(value);setEditing(true);}}>{value || '—'}</span>;
}
const freshColumn=(tableId:string,scope:ModelScope='physical'):Column=>({id:newId(),tableId,scope,logical:{name:'새 컬럼',definition:'',semanticType:'',required:false},physical:{name:'',type:{name:'text',isArray:false},nullable:false,defaultExpression:null,comment:''},customProperties:emptyMeta()});
export function TableNodeContent({ document:doc, tableId, viewId, onChange, readOnly=false, onStartForeignKey, onCreatePin }: {
 document:DesignDocument;tableId:string;viewMode:ModelScope;viewId?:string;onChange?:(d:DesignDocument)=>void;readOnly?:boolean;onStartForeignKey?:(id:string)=>void;onCreatePin?:(position:{clientX:number;clientY:number})=>void;
}) {
 const [menu,setMenu]=useState<{x:number;y:number;id:string}|null>(null);
 const table=doc.tables?.find(t=>t.id===tableId);if(!table)return null;
 const columns=(doc.columns??[]).filter(c=>c.tableId===tableId&&isVisibleInView(c.scope,'physical',table.scope));
 const editable=!!onChange&&!readOnly;
 const metrics=tableCardMetrics(doc,tableId);
 const cell=(value:string,label:string,commit:(v:string)=>DesignDocument)=><InlineCell value={value} label={label} disabled={!editable} onCommit={v=>onChange?.(commit(v))}/>;
 return <div className="table-node-content" style={{'--table-grid':metrics.grid} as CSSProperties} onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(editable)setMenu({x:e.clientX,y:e.clientY,id:''});}}><header title={`${viewId&&viewId!==table.domainId?'외부 참조 · ':''}${doc.domains.find(d=>d.id===table.domainId)?.name??''}`}><strong>{cell(table.physical.name,'테이블명',name=>updateTable(doc,tableId,{physical:{...table.physical,name}}))}</strong></header>
 <div className="table-columns"><div className="table-column-row table-column-head"><span>키</span><span>컬럼</span><span>타입</span><span>NULL</span><span>comment</span></div>{columns.map((c,columnIndex)=>{
 const keys=(doc.keys??[]).filter(k=>k.columnIds.includes(c.id)&&k.scope!=='logical');
 const fk=(doc.tableRelations??[]).some(r=>r.physical?.sourceColumnIds.includes(c.id)&&r.scope!=='logical');
 const patch=(v:Partial<Column['physical']>)=>updateColumn(doc,c.id,{physical:{...c.physical,...v}});
 return <div className={`table-column-row${keys.some(k=>k.kind==='primary')?' table-column-pk':''}${fk?' table-column-fk':''}`} style={{minHeight:metrics.rows[columnIndex]}} key={c.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!editable)return;setMenu({x:e.clientX,y:e.clientY,id:c.id});}}>
 <span className="table-key-marker">{[keys.some(k=>k.kind==='primary')?'PK':'',fk?'FK':'',keys.some(k=>k.kind==='unique')?'UQ':''].filter(Boolean).join(' ')}</span>
 {cell(c.physical.name,'컬럼명',name=>patch({name}))}
 <span className="table-type-label">{(c.physical.type.enumId?doc.enums?.find(t=>t.id===c.physical.type.enumId)?.name??'ENUM':c.physical.type.name).toUpperCase()}{c.physical.type.isArray?'[]':''}</span>
 <span data-inline-edit="true" title="더블클릭하여 NULL 설정 변경" onDoubleClick={e=>{e.stopPropagation();if(editable)onChange?.(patch({nullable:!c.physical.nullable}));}}>{c.physical.nullable?'':'NN'}</span>
 {cell(c.physical.comment,'컬럼 comment',comment=>patch({comment}))}</div>;
 })}{!columns.length&&<p>컬럼을 추가해 설계를 시작하세요.</p>}</div>
 <div className="table-node-footer" onPointerDown={e=>e.stopPropagation()}><IconButton aria-label="컬럼 추가" disabled={!editable} onClick={()=>onChange?.(addColumn(doc,freshColumn(tableId)))}>+</IconButton></div>
 <ContextMenu position={menu} onClose={()=>setMenu(null)} label="컬럼" items={[{id:'pin',label:'여기에 핀 남기기',disabled:!onCreatePin,onAction:()=>{if(menu)onCreatePin?.({clientX:menu.x,clientY:menu.y});}},{id:'add-column',label:'컬럼 추가',onAction:()=>onChange?.(addColumn(doc,freshColumn(tableId)))},{id:'fk',label:'PK에서 관계 연결',disabled:!onStartForeignKey||!doc.keys?.some(k=>k.tableId===tableId&&k.kind==='primary'&&k.scope!=='logical'&&k.columnIds.includes(menu?.id??'')),onAction:()=>menu&&onStartForeignKey?.(menu.id)}]}/></div>;
}
export function TableWorkspaceTools({document:doc,viewId,onChange,readOnly,position,onSelect}:{document:DesignDocument;viewId:string;viewMode:ModelScope;onViewModeChange:(v:ModelScope)=>void;onChange:(d:DesignDocument)=>void;readOnly:boolean;position:{x:number;y:number};onSelect:(id:string)=>void;hideViewMode?:boolean}) {
 const [name,setName]=useState('');
 return <div className="table-workspace-tools">
  <TextField label="새 테이블명" value={name} max={120} onChange={setName}/>
  <Button variant="primary" className="primary" disabled={readOnly||viewId==='overview'} onClick={()=>{const id=newId();onChange(addTable(doc,{id,domainId:viewId,scope:'physical',logical:{name:'새 테이블',definition:''},physical:{name,schema:'public',comment:''},customProperties:emptyMetadata()},position));setName('');onSelect(id);}}>+ 테이블</Button>
  <PanelNote>이름을 비워 두고 만든 뒤 속성에서 채워도 됩니다. 목록 탭에서 다른 도메인의 테이블을 이 화면으로 참조할 수 있습니다.</PanelNote>
 </div>;
}
function EnumManager({document:doc,onChange,readOnly}:{document:DesignDocument;onChange:(d:DesignDocument)=>void;readOnly:boolean}) {
 const [editing,setEditing]=useState<string|null>(null),[name,setName]=useState(''),[schema,setSchema]=useState('public'),[values,setValues]=useState(''),[error,setError]=useState('');
 return <fieldset disabled={readOnly}><p>프로젝트의 테이블에서 사용하는 ENUM 값 목록입니다.</p>{(doc.enums??[]).map(item=><div className="table-enum-item" key={item.id}><strong>{item.name}</strong><small>{item.values.join(' · ')}</small><div className="table-actions"><Button onClick={()=>{setEditing(item.id);setName(item.name);setSchema(item.schema);setValues(item.values.join('\n'));}}>편집</Button><Button variant="danger" onClick={()=>{try{onChange(removeEnum(doc,item.id));setError('');}catch(e){setError(e instanceof Error?e.message:'사용 중인 ENUM은 삭제할 수 없습니다.');}}}>삭제</Button></div></div>)}
 <TextField label="ENUM 이름" value={name} max={120} onChange={setName}/><label>ENUM 값 (한 줄에 하나, 빈 줄은 빈 문자열)<Textarea value={values} onChange={e=>setValues(e.target.value)}/></label><Button disabled={!name.trim()||!schema.trim()} onClick={()=>{try{onChange(upsertEnum(doc,{id:editing??newId(),name:name.trim(),schema:schema.trim(),values:values.split('\n')}));setEditing(null);setName('');setSchema('public');setValues('');setError('');}catch(e){setError(e instanceof Error?e.message:'ENUM을 확인하세요.');}}}>{editing?'ENUM 변경 적용':'ENUM 생성'}</Button>{editing&&<Button onClick={()=>{setEditing(null);setName('');setSchema('public');setValues('');}}>편집 취소</Button>}{error&&<p role="alert" className="table-error">{error}</p>}</fieldset>;
}
export function TableInspector({ document: doc, tableId, onChange, readOnly, onStartForeignKey }: {
    document: DesignDocument;
    tableId: string;
    onChange: (d: DesignDocument) => void;
    readOnly: boolean;
    onStartForeignKey?: (id:string)=>void;
}) {
    const confirm=useConfirm();
    const [columnId, setColumnId] = useState<string | null>(null);
    const [keyDraft,setKeyDraft]=useState<TableKey|null>(null),[fkColumnId,setFkColumnId]=useState('');
    useEffect(()=>{setColumnId(null);setKeyDraft(null);setFkColumnId('');},[tableId]);
    const table = doc.tables?.find(t => t.id === tableId);
    if (!table)
        return null;
    const cols = (doc.columns ?? []).filter(c => c.tableId === tableId && c.scope !== 'logical');
    const relations = (doc.tableRelations ?? []).filter(r => r.physical && r.scope !== 'logical' && (r.sourceTableId === tableId || r.targetTableId === tableId));
    const keys = (doc.keys ?? []).filter(k => k.tableId === tableId && k.scope !== 'logical');
    const change = (next: DesignDocument) => { if (!readOnly)
        onChange(next); };
    const patch = (p: Partial<Table>) => change(updateTable(doc, tableId, p));
    const index = cols.findIndex(c => c.id === columnId);
    const active = index < 0 ? null : cols[index]!;
    const marker = (c: Column) => [
        keys.some(k => k.kind === 'primary' && k.columnIds.includes(c.id)) ? 'PK' : '',
        (doc.tableRelations ?? []).some(r => r.physical?.sourceColumnIds.includes(c.id)) ? 'FK' : '',
        keys.some(k => k.kind === 'unique' && k.columnIds.includes(c.id)) ? 'UQ' : '',
    ].filter(Boolean).join(' ');
    return <section className="table-inspector">
        <p className="table-owner">소유 도메인 · {doc.domains.find(d => d.id === table.domainId)?.name} · 참조 화면에서도 원본을 편집합니다.</p>
        <fieldset disabled={readOnly}>
            <PanelSection title="기본 정보" defaultOpen>
                <TextField label="테이블명" value={table.physical.name} max={120} onChange={name => patch({ physical: { ...table.physical, name } })}/>
            </PanelSection>
            <PanelSection title="컬럼" count={cols.length} defaultOpen>
                <PanelList empty="아직 컬럼이 없습니다. 아래 컬럼 추가에서 첫 컬럼을 만들어 주세요.">
                    {cols.map((c, at) => <PanelRow key={c.id}
                        active={c.id === columnId}
                        title={(at + 1) + '. ' + columnName(c)}
                        meta={c.physical.type.name.toUpperCase() + (c.physical.type.isArray ? '[]' : '')}
                        badge={marker(c) || undefined}
                        onSelect={() => setColumnId(value => value === c.id ? null : c.id)}/>)}
                </PanelList>
                {active && <ColumnEditor document={doc} column={active} index={index} count={cols.length}
                    onChange={p => change(updateColumn(doc, active.id, p))}
                    onMove={dir => change(moveColumn(doc, active.id, dir))}
                    onDelete={() => { change(removeColumn(doc, active.id)); setColumnId(null); }}
                    onClose={() => setColumnId(null)}/>}
                <PanelSection title="컬럼 추가"><ColumnCreationForm document={doc} tableId={tableId} onChange={change}/></PanelSection>
            </PanelSection>
            <PanelSection title="키 · PK / UNIQUE" count={keys.length}>
                {keys.map(k => <KeyEditor key={k.id} item={k} columns={cols} onChange={next => change(upsertKey(doc, next))} onDelete={() => change(removeKey(doc, k.id))}/>)}
                {keyDraft&&<><KeyEditor item={keyDraft} columns={cols} onChange={setKeyDraft} onDelete={()=>setKeyDraft(null)}/><Button variant="primary" disabled={!canSaveKey(keyDraft,cols,keys)} onClick={()=>{if(!canSaveKey(keyDraft,cols,keys))return;change(upsertKey(doc,keyDraft));setKeyDraft(null);}}>키 생성</Button><PanelNote>컬럼을 선택한 뒤 키를 생성하세요. 같은 키는 중복 생성할 수 없습니다.</PanelNote></>}
                <Button disabled={!!keyDraft||!cols.length} onClick={()=>setKeyDraft({id:newId(),tableId,scope:'physical',kind:'unique',name:'',columnIds:[]})}>+ 키 추가</Button>
            </PanelSection>
            <PanelSection title="테이블 관계" count={relations.length}>
                <label>PK 출발 컬럼<Select aria-label="PK 출발 컬럼" value={fkColumnId} disabled={!onStartForeignKey} onValueChange={value =>setFkColumnId(value)}><option value="">출발 컬럼 선택</option>{cols.filter(c=>keys.some(k=>k.kind==='primary'&&k.columnIds.includes(c.id))).map(c=><option key={c.id} value={c.id}>{columnName(c)}</option>)}</Select></label>
                <Button disabled={!onStartForeignKey||!cols.some(c=>c.id===fkColumnId)} onClick={()=>{if(!cols.some(c=>c.id===fkColumnId))return;onStartForeignKey?.(fkColumnId);setFkColumnId('');}}>+ 테이블 관계 추가</Button>
                <PanelNote>PK 컬럼을 선택한 뒤 FK를 받을 테이블을 클릭하세요. 대응 컬럼은 자동으로 추가됩니다.</PanelNote>
                {relations.map(r => <RelationEditor key={r.id} document={doc} item={r} onChange={next => change(upsertTableRelation(doc, next))} onDelete={() => change(removeTableRelation(doc, r.id))}/>)}
            </PanelSection>
            <div className="panel-danger">
                <Button variant="danger" className="danger" onClick={async () => { if (await confirm({title:'테이블 삭제',description:'테이블과 소유 컬럼, 키, 관계 및 모든 외부 참조를 삭제할까요?',confirmLabel:'삭제',destructive:true}))
                    change(removeTable(doc, tableId)); }}>테이블 삭제</Button>
            </div>
        </fieldset>
    </section>;
}
function ColumnEditor({ document:doc, column: c, index, count, onChange, onMove, onDelete, onClose }: {
    document: DesignDocument;
    column: Column;
    index: number;
    count: number;
    onChange: (p: Partial<Column>) => void;
    onMove: (d: number) => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const physical = (p: Partial<Column['physical']>) => onChange({ physical: { ...c.physical, ...p } });
    return <div className="panel-detail table-column-editor"><div className="panel-detail-head"><strong>컬럼 {index+1} / {count}</strong><IconButton aria-label={`${columnName(c)} 위로`} disabled={index===0} onClick={()=>onMove(-1)}>↑</IconButton><IconButton aria-label={`${columnName(c)} 아래로`} disabled={index===count-1} onClick={()=>onMove(1)}>↓</IconButton><IconButton aria-label="컬럼 편집 닫기" onClick={onClose}>×</IconButton></div>
    <TextField label="컬럼명" value={c.physical.name} max={120} onChange={name=>physical({name})}/>
    <label>ENUM<Select aria-label="ENUM" value={c.physical.type.enumId??''} onValueChange={value =>physical({type:{name:value?doc.enums?.find(t=>t.id===value)?.name??'text':'text',isArray:c.physical.type.isArray,enumId:value||undefined}})}><option value="">기본 타입</option>{doc.enums?.map(t=><option key={t.id} value={t.id}>{t.name.toUpperCase()}</option>)}</Select></label>
    <label>타입<SearchType label="타입" disabled={!!c.physical.type.enumId} value={c.physical.type.name} onValueChange={value=>physical({type:{name:value,isArray:c.physical.type.isArray}})} options={[...new Set([...physicalTypes,c.physical.type.name])].map(value=>({value,label:value.toUpperCase()}))}/></label>
    <div className="table-type-params">{(['length','precision','scale'] as const).map(key=><label key={key}>{{length:'길이',precision:'정밀도',scale:'소수'}[key]}<Input type="number" disabled={!typeParameterEnabled(c.physical.type,key)} step={1} min={key==='scale'?-1000:key==='precision'&&!['numeric','decimal'].includes(c.physical.type.name)?0:1} max={key==='length'?10485760:key==='precision'&&!['numeric','decimal'].includes(c.physical.type.name)?6:1000} value={c.physical.type[key]??''} onChange={e=>{const value=e.target.value===''?undefined:Number(e.target.value);if(value===undefined||(Number.isInteger(value)&&value>=(key==='scale'?-1000:key==='precision'&&!['numeric','decimal'].includes(c.physical.type.name)?0:1)&&value<=(key==='length'?10485760:key==='precision'&&!['numeric','decimal'].includes(c.physical.type.name)?6:1000)))physical({type:{...c.physical.type,[key]:value,...(key==='precision'&&value===undefined?{scale:undefined}:{})}});}}/></label>)}</div>
    <div className="table-column-flags"><Check label="배열" value={c.physical.type.isArray} onChange={isArray=>physical({type:{...c.physical.type,isArray}})}/><Check label="NULL 허용" value={c.physical.nullable} onChange={nullable=>physical({nullable})}/></div><TextField label="설명" value={c.physical.comment} onChange={comment=>physical({comment})}/><div className="panel-danger"><Button variant="danger" onClick={onDelete}>컬럼 삭제</Button></div></div>;
}

function KeyEditor({ item: k, columns, onChange, onDelete }: {
    item: TableKey;
    columns: Column[];
    onChange: (k: TableKey) => void;
    onDelete: () => void;
}) {
    return <PanelSection defaultOpen title={<>{k.kind === 'primary' ? '기본 키' : '고유 키'} · {k.name || '이름 없음'}</>}><label>키 종류<Select aria-label="키 종류" value={k.kind} onValueChange={value => onChange({ ...k, kind: value as TableKey['kind'] })}><option value="primary">PRIMARY KEY</option><option value="unique">UNIQUE</option></Select></label><TextField label="키 이름" value={k.name} max={120} onChange={name => onChange({ ...k, name })}/><p>체크한 순서대로 하나의 복합 {k.kind==='primary'?'PRIMARY KEY':'UNIQUE'}를 구성합니다.</p><div className="table-key-options">{columns.map(c=><Check key={c.id} label={`${k.columnIds.includes(c.id)?`${k.columnIds.indexOf(c.id)+1}. `:''}${c.physical.name||columnName(c)}`} value={k.columnIds.includes(c.id)} onChange={checked=>onChange({...k,columnIds:checked?[...k.columnIds,c.id]:k.columnIds.filter(id=>id!==c.id)})}/>)}</div><Button variant="danger" className="danger" onClick={onDelete}>키 삭제</Button></PanelSection>;
}
function RelationEditor({ document: doc, item: r, onChange, onDelete }: {
    document: DesignDocument;
    item: TableRelation;
    onChange: (r: TableRelation) => void;
    onDelete: () => void;
}) {
    const physical = r.physical, source = (doc.columns ?? []).filter(c => c.tableId === r.sourceTableId), target = (doc.columns ?? []).filter(c => c.tableId === r.targetTableId);
    return <PanelSection title={<>{doc.tables?.find(t => t.id === r.sourceTableId)?.physical.name} → {doc.tables?.find(t => t.id === r.targetTableId)?.physical.name} · {r.logical.name}</>}>{(['sourceTableId', 'targetTableId'] as const).map(key => <label key={key}>{key === 'sourceTableId' ? '도착 테이블 (FK)' : '출발 테이블 (PK)'}<Select aria-label={key === 'sourceTableId' ? '도착 테이블 (FK)' : '출발 테이블 (PK)'} value={r[key]} onValueChange={value => onChange({ ...r, [key]: value, physical: physical ? { ...physical, sourceColumnIds: [], targetColumnIds: [] } : null })}>{doc.tables?.map(t => <option key={t.id} value={t.id}>{doc.domains.find(d => d.id === t.domainId)?.name} / {tableName(t)}</option>)}</Select></label>)}<TextField label="관계명" value={r.logical.name} max={120} onChange={name => onChange({ ...r, logical: { ...r.logical, name } })}/>{!r.logical.sourceCardinality&&!r.logical.targetCardinality&&<label>카디널리티<Select aria-label="카디널리티" value={r.logical.cardinality} onValueChange={value => onChange({ ...r, logical: { ...r.logical, cardinality: value as TableRelation['logical']['cardinality'] } })}><option value="one-to-one">1 : 1</option><option value="one-to-many">1 : N</option><option value="many-to-many">N : M</option></Select></label>}<TextField label="관계 설명" value={r.logical.description??''} onChange={description=>onChange({...r,logical:{...r.logical,description}})}/>{(['sourceCardinality','targetCardinality'] as const).map(side=>{const endpoint=r.logical[side]??{min:side==='sourceCardinality'?0:r.logical.required?1:0,max:side==='sourceCardinality'?(r.logical.cardinality==='one-to-one'?1:'many'):(r.logical.cardinality==='many-to-many'?'many':1)};return <label key={side}>{side==='sourceCardinality'?'출발 끝점':'대상 끝점'}<Select aria-label={side === 'sourceCardinality' ? '출발 끝점' : '대상 끝점'} value={`${endpoint.min}:${endpoint.max}`} onValueChange={value =>{const [min,max]=value.split(':');onChange({...r,logical:{...r.logical,[side]:{min:Number(min) as 0|1,max:max==='many'?'many':1}}});}}><option value="0:1">0..1</option><option value="1:1">1</option><option value="0:many">0..N</option><option value="1:many">1..N</option></Select></label>;})}{!r.logical.targetCardinality&&<Check label="관계 필수" value={r.logical.required} onChange={required => onChange({ ...r, logical: { ...r.logical, required } })}/>}{physical?<Button onClick={()=>onChange({...r,physical:null})}>FK 정의 제거</Button>:<p>새 FK는 출발 PK 컬럼을 선택한 뒤 도착 테이블을 클릭하여 생성합니다.</p>}{physical && <><TextField label="FK 이름" value={physical.name} max={120} onChange={name => onChange({ ...r, physical: { ...physical, name } })}/><p>도착 FK 컬럼과 출발 PK / UNIQUE 컬럼의 대응입니다.</p>{physical.sourceColumnIds.map((id, i) => <div className="table-mapping" key={i}><span>{i + 1}</span>{(['source', 'target'] as const).map(side => <label key={side}>{side === 'source' ? 'FK' : 'PK / UNIQUE'} 컬럼<Select aria-label={`${side === 'source' ? 'FK' : 'PK / UNIQUE'} 컬럼 ${i + 1}`} value={side === 'source' ? id : physical.targetColumnIds[i] ?? ''} onValueChange={value => { if (value)
        onChange({ ...r, physical: setMappingPair(physical, i, side, value) }); }}><option value="">선택</option>{(side === 'source' ? source : target).map(c => <option key={c.id} value={c.id}>{columnName(c)}</option>)}</Select></label>)}<IconButton aria-label={`매핑 ${i + 1} 삭제`} onClick={() => onChange({ ...r, physical: { ...physical, sourceColumnIds: physical.sourceColumnIds.filter((_, at) => at !== i), targetColumnIds: physical.targetColumnIds.filter((_, at) => at !== i) } })}>×</IconButton></div>)}<Button disabled={!source.length || !target.length} onClick={() => onChange({ ...r, physical: { ...physical, sourceColumnIds: [...physical.sourceColumnIds, source[0]?.id ?? ''], targetColumnIds: [...physical.targetColumnIds, target[0]?.id ?? ''] } })}>+ 컬럼 매핑</Button>{(['onDelete', 'onUpdate'] as const).map(key => <label key={key}>{key === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'}<Select aria-label={key === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'} value={physical[key]} onValueChange={value => onChange({ ...r, physical: { ...physical, [key]: value as ReferentialAction } })}>{['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].map(action => <option key={action}>{action}</option>)}</Select></label>)}</>}<Button variant="danger" className="danger" onClick={onDelete}>관계 삭제</Button></PanelSection>;
}

type RelationBounds = { x: number; y: number; width: number; height: number };
/** Keep labels outside endpoint cards when their horizontal gap cannot fit the label. */
export function relationGeometry(a: RelationBounds, b: RelationBounds, labelWidth: number, lane: number, offset = 0, bend?: {x:number;y:number}) {
    const aw = Math.max(280, a.width), ah = Math.max(220, a.height);
    const bw = Math.max(280, b.width), bh = Math.max(220, b.height);
    const ax = a.x + aw, ay = a.y + ah / 2, bx = b.x, by = b.y + bh / 2;
    if (bend) {
        const finishX = a === b ? a.x + aw / 2 : bx - 24;
        const finishY = a === b ? a.y - 8 : by;
        return {path:`M ${ax + 5} ${ay} L ${bend.x} ${ay} L ${bend.x} ${bend.y} L ${finishX} ${bend.y} L ${finishX} ${finishY}${a === b ? '' : ` L ${bx - 8} ${by}`}`,labelX:bend.x,labelY:bend.y - 18};
    }
    if (a === b) {
        const top = a.y - 54 - lane * 32 - offset, right = ax + 54;
        return {
            path: `M ${ax + 5} ${ay} L ${right} ${ay} L ${right} ${top} L ${a.x + aw / 2} ${top} L ${a.x + aw / 2} ${a.y - 8}`,
            labelX: (right + a.x + aw / 2) / 2, labelY: top - 17,
        };
    }
    if (bx - ax < labelWidth + 40) {
        const top = Math.min(a.y, b.y) - 54 - lane * 32 - offset;
        const startX = a.x + aw / 2, endX = b.x + bw / 2;
        return {
            path: `M ${startX} ${a.y - 5} L ${startX} ${top} L ${endX} ${top} L ${endX} ${b.y - 8}`,
            labelX: (startX + endX) / 2, labelY: top - 17,
        };
    }
    return {
        path: `M ${ax + 5} ${ay} L ${(ax + bx) / 2} ${ay} L ${(ax + bx) / 2} ${Math.min(ay,by)-lane*32-offset} L ${bx - 24} ${Math.min(ay,by)-lane*32-offset} L ${bx - 24} ${by} L ${bx - 8} ${by}`,
        labelX: (ax + bx) / 2, labelY: Math.min(ay,by) - 18 - lane*32 - offset,
    };
}
export function TableRelationsSvg({ document: doc, viewId, viewMode, onSelect, onChange, readOnly=false, controlsOnly=false, hideControls=false, visibleNodeIds }: {
    document: DesignDocument;
    viewId: string;
    viewMode: ModelScope;
    onSelect: (id: string) => void;
    onChange?: (d:DesignDocument)=>void;readOnly?:boolean;controlsOnly?:boolean;hideControls?:boolean;visibleNodeIds?:string[];
}) {
    const drag=useRef<{id:string;pointerId:number;start:{x:number;y:number};origin:{x:number;y:number}}|null>(null);
    const [menu,setMenu]=useState<{x:number;y:number;id:string}|null>(null);
    return <>{(doc.tableRelations ?? []).map((relation) => {
        const source = doc.tables?.find(table => table.id === relation.sourceTableId);
        const target = doc.tables?.find(table => table.id === relation.targetTableId);
        const a = doc.layout.nodes.find(node => node.objectId === relation.sourceTableId && node.viewId === viewId);
        const b = doc.layout.nodes.find(node => node.objectId === relation.targetTableId && node.viewId === viewId);
        if (!source || !target || !a || !b || !isVisibleInView(relation.scope, viewMode)
            || !isVisibleInView(source.scope, viewMode) || !isVisibleInView(target.scope, viewMode)) return null;
        if (visibleNodeIds && (!visibleNodeIds.includes(a.id)||!visibleNodeIds.includes(b.id))) return null;
        if (viewMode === 'physical' && !relation.physical) return null;
        const combined=doc.views?.find(view=>view.id===viewId);
        if(combined&&(!combined.domainIds.includes(source.domainId)||!combined.domainIds.includes(target.domainId)))return null;
        const physical = viewMode !== 'logical' && !!relation.physical && relation.scope !== 'logical';
        const attribute=(relation.physical?.targetColumnIds??[]).map(id=>doc.columns?.find(c=>c.id===id)?.physical.name||'?').join(', ');
        const fullLabel = `${target.physical.name||target.logical.name}.${attribute||relation.logical.name||'관계'}:${source.physical.name||source.logical.name}`;
        const label = fullLabel;
        const labelWidth = Math.max(90, [...label].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 14 : 8), 24));
        const pair=(doc.tableRelations??[]).filter(r=>[r.sourceTableId,r.targetTableId].sort().join(':')===[relation.sourceTableId,relation.targetTableId].sort().join(':'));
        const sourceBounds={...a,...tableCardSize(doc,source.id,a.width,a.height)};
        const targetBounds=source.id===target.id?sourceBounds:{...b,...tableCardSize(doc,target.id,b.width,b.height)};
        const route=doc.layout.relations?.find(item=>item.relationId===relation.id&&item.viewId===viewId);
        const offset=route?.offset??0;
        const geometry = relationGeometry(sourceBounds, targetBounds, labelWidth, pair.findIndex(r=>r.id===relation.id),offset,route?.bend);
        const origin=route?.bend??{x:geometry.labelX,y:geometry.labelY+18};
        const adjust=(bend:{x:number;y:number})=>onChange?.(upsertRelationLayout(doc,{relationId:relation.id,viewId,offset,bend}));
        const worldPoint=(element:SVGGElement,clientX:number,clientY:number)=>{
            const matrix=element.getScreenCTM();
            return matrix ? new DOMPoint(clientX,clientY).matrixTransform(matrix.inverse()) : null;
        };
        const markerId = `table-crow-${relation.id}`;
        const endpoints=[relation.logical.sourceCardinality??{min:0,max:relation.logical.cardinality==='one-to-one'?1:'many'},relation.logical.targetCardinality??{min:relation.logical.required?1:0,max:relation.logical.cardinality==='many-to-many'?'many':1}];
        const stroke = physical ? 'var(--accent)' : 'var(--muted)';
        return <g key={relation.id} className={controlsOnly?"table-route-control-group":"table-relation-line"} role={controlsOnly?undefined:"button"} tabIndex={controlsOnly?undefined:0}
            aria-label={controlsOnly?undefined:`테이블 관계 ${fullLabel}`} onContextMenu={event=>{if(readOnly||!onChange)return;event.preventDefault();event.stopPropagation();setMenu({x:event.clientX,y:event.clientY,id:relation.id});}}
            onClick={event => { event.stopPropagation(); onSelect(relation.sourceTableId); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(relation.sourceTableId); } }}>
            {!controlsOnly&&<><title>{`${fullLabel}${relation.logical.description?` — ${relation.logical.description}`:''}`}</title>
            <defs>{endpoints.map((endpoint,i)=><marker key={i} id={`${markerId}-${i}`} viewBox="0 0 32 24" refX="30" refY="12" markerWidth="32" markerHeight="24" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><g fill="none" stroke={stroke} strokeWidth="1.7">{endpoint.max==='many'?<path d="M 18 12 L 30 3 M 18 12 L 30 21 M 18 12 L 30 12"/>:<path d="M 27 4 L 27 20"/>}{endpoint.min===0?<circle cx="10" cy="12" r="5" fill="#fafbfc"/>:<path d="M 13 4 L 13 20"/>}</g></marker>)}</defs>
            <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={18}/>
            <path d={geometry.path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round"
                strokeDasharray={physical ? undefined : '6 4'} markerStart={`url(#${markerId}-0)`} markerEnd={`url(#${markerId}-1)`}/>
            <rect x={geometry.labelX - labelWidth / 2} y={geometry.labelY - 13} width={labelWidth} height={28}
                rx={9} fill="#fafbfc" stroke="#bdc8d8" strokeWidth={1}/>
            <text x={geometry.labelX} y={geometry.labelY + 5} textAnchor="middle">{label}</text></>}
            {!hideControls&&!readOnly&&onChange&&<g className="table-route-adjust" data-export-hidden="true" role="button" tabIndex={0} aria-label={`관계 선 조절 ${fullLabel}`}
                onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(e.button!==0)return;const point=worldPoint(e.currentTarget,e.clientX,e.clientY);if(!point)return;drag.current={id:relation.id,pointerId:e.pointerId,start:point,origin};e.currentTarget.setPointerCapture(e.pointerId);}}
                onPointerMove={e=>{const active=drag.current;if(active?.id!==relation.id||active.pointerId!==e.pointerId)return;e.stopPropagation();const point=worldPoint(e.currentTarget,e.clientX,e.clientY);if(point)adjust({x:active.origin.x+point.x-active.start.x,y:active.origin.y+point.y-active.start.y});}}
                onPointerUp={e=>{e.stopPropagation();if(drag.current?.pointerId===e.pointerId){drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}}
                onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
                onClick={e=>e.stopPropagation()}
                onKeyDown={e=>{const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(direction){e.preventDefault();e.stopPropagation();const step=e.shiftKey?32:8;adjust({x:origin.x+direction[0]!*step,y:origin.y+direction[1]!*step});}}}>
                <title>드래그하여 관계 선 이동 · 방향키로 미세 조절</title><rect x={geometry.labelX+labelWidth/2+6} y={geometry.labelY-13} width={28} height={28} rx={6}/><text x={geometry.labelX+labelWidth/2+20} y={geometry.labelY+6} textAnchor="middle">⤧</text></g>}
        </g>;
    })}{menu&&typeof document!=='undefined'&&createPortal(<ContextMenu position={menu} onClose={()=>setMenu(null)} label="테이블 관계" items={[{id:'delete',label:'관계 삭제',destructive:true,onAction:()=>{if(menu&&!readOnly)onChange?.(removeTableRelation(doc,menu.id));}}]}/>,document.body)}</>;
}

export function ForeignKeyDialog({document:doc,sourceColumnId,targetTableId,onChange,onClose}:{document:DesignDocument;sourceColumnId:string;targetTableId:string;onChange:(d:DesignDocument)=>void;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);const source=doc.columns?.find(c=>c.id===sourceColumnId);
 const sourceTable=doc.tables?.find(t=>t.id===source?.tableId),target=doc.tables?.find(t=>t.id===targetTableId);
 const keys=(doc.keys??[]).filter(k=>k.tableId===source?.tableId&&k.kind==='primary'&&k.scope!=='logical'&&k.columnIds.includes(sourceColumnId));
 const [keyId,setKeyId]=useState(keys[0]?.id??''),[error,setError]=useState('');
 const key=keys.find(k=>k.id===keyId);
 const [relationId]=useState(newId),[columnIds]=useState(()=>Array.from({length:Math.max(0,...keys.map(k=>k.columnIds.length))},()=>newId()));
 let preview:DesignDocument|undefined;let previewError='';
 if(sourceTable&&target&&key)try{preview=createForeignKeyFromPrimaryKey(doc,{primaryTableId:sourceTable.id,foreignTableId:target.id,primaryKeyId:key.id,relationId,columnIds:columnIds.slice(0,key.columnIds.length)});}catch(e){previewError=e instanceof Error?e.message:'관계를 생성할 수 없습니다.';}
 useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 return createPortal(<dialog ref={dialog} className="table-fk-dialog" aria-labelledby="fk-dialog-title" onCancel={onClose} onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}><h2 id="fk-dialog-title">PK → FK 관계 만들기</h2><p>{sourceTable?.physical.name||'출발 테이블'} → {target?.physical.name||'도착 테이블'}</p>
 <label>출발 PK<Select aria-label="출발 PK" value={keyId} onValueChange={setKeyId}>{!keys.length&&<option value="">참조 가능한 PK 없음</option>}{keys.map(k=><option key={k.id} value={k.id}>{k.name||k.columnIds.map(id=>doc.columns?.find(c=>c.id===id)?.physical.name).join(', ')}</option>)}</Select></label>
 <PanelNote>도착 테이블에 아래 FK 컬럼을 자동으로 추가합니다. 복합 PK는 순서대로 연결하며, 같은 이름이 있으면 새 이름으로 만듭니다.</PanelNote>
 <div className="table-fk-pairs">{key?.columnIds.map((id,index)=>{const primary=doc.columns?.find(c=>c.id===id),foreign=preview?.columns?.find(c=>c.id===columnIds[index]);return <div key={id}><span>{primary?.physical.name||'이름 없는 컬럼'}<small>{primary?.physical.type.name.toUpperCase()}</small></span><span aria-hidden="true">→</span><span>{foreign?.physical.name||'새 FK 컬럼'}<small>{foreign?.physical.type.name.toUpperCase()} · 자동 추가</small></span></div>;})}</div>
 {(error||previewError||!keys.length)&&<p role="alert" className="table-error">{error||previewError||'출발 테이블에 PK를 먼저 정의하세요.'}</p>}<div className="table-actions"><Button onClick={onClose}>취소</Button><Button variant="primary" disabled={!preview} onClick={()=>{try{if(preview){onChange(preview);onClose();}}catch(e){setError(e instanceof Error?e.message:'관계를 생성할 수 없습니다.');}}}>컬럼 추가 및 관계 생성</Button></div></dialog>,document.body);
}

function ColumnCreationForm({document:doc,tableId,onChange}:{document:DesignDocument;tableId:string;onChange:(d:DesignDocument)=>void}) {
 const [name,setName]=useState(''),[type,setType]=useState('text'),[comment,setComment]=useState(''),[pk,setPk]=useState(false),[notNull,setNotNull]=useState(true);
 return <div className="table-column-create"><div className="table-create-grid"><label>PK<Checkbox checked={pk} onChange={e=>setPk(e.target.checked)}/></label><TextField label="속성명" value={name} max={120} onChange={setName}/><label>타입<SearchType label="타입" value={type} onValueChange={setType} options={[...physicalTypes.map(value=>({value,label:value.toUpperCase()})),...(doc.enums??[]).map(e=>({value:`enum:${e.id}`,label:e.name.toUpperCase()}))]}/></label><label>NOT NULL<Checkbox checked={notNull||pk} disabled={pk} onChange={e=>setNotNull(e.target.checked)}/></label><TextField label="새 컬럼 comment" value={comment} onChange={setComment}/></div>
 <Button onClick={()=>{const column=freshColumn(tableId);column.physical.name=name;column.physical.comment=comment;column.physical.nullable=!notNull&&!pk;column.physical.type=type.startsWith('enum:')?{name:(doc.enums??[]).find(t=>t.id===type.slice(5))?.name??'text',enumId:type.slice(5),isArray:false}:{name:type,isArray:false};let next=addColumn(doc,column);if(pk){const existing=doc.keys?.find(k=>k.tableId===tableId&&k.kind==='primary');next=upsertKey(next,existing?{...existing,columnIds:[...existing.columnIds,column.id]}:{id:newId(),tableId,scope:column.scope,kind:'primary',name:'',columnIds:[column.id]});}onChange(next);setName('');setComment('');setPk(false);}}>+ 컬럼 추가</Button></div>;
}

export function EnumDialog({document:doc,onChange,readOnly,onClose}:{document:DesignDocument;onChange:(d:DesignDocument)=>void;readOnly:boolean;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 return createPortal(<dialog ref={dialog} className="table-fk-dialog enum-dialog" aria-labelledby="enum-dialog-title" onCancel={onClose} onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}>
  <div className="enum-dialog-head"><h2 id="enum-dialog-title">프로젝트 ENUM</h2><IconButton aria-label="ENUM 관리 닫기" onClick={onClose}>×</IconButton></div>
  <EnumManager document={doc} onChange={onChange} readOnly={readOnly}/>
  <div className="table-actions"><Button onClick={onClose}>닫기</Button></div>
 </dialog>,document.body);
}

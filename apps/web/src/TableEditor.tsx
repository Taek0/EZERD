import { useId, useRef, useEffect, useState } from 'react';
import { type DesignDocument, type ModelScope, type Table, type Column, type CustomProperties, type TableRelation, type TableKey, type ReferentialAction, addTable, updateTable, removeTable, addColumn, updateColumn, removeColumn, upsertKey, removeKey, upsertTableRelation, removeTableRelation, addTableReference, isVisibleInView } from '@ezerd/model';
import { createPortal } from 'react-dom';
import { upsertEnum, removeEnum, exportPostgres } from '@ezerd/model';
import { newId } from './client.js';
import './table-editor.css';
import { Accordion, Button, Checkbox, ContextMenu, IconButton, Input, Select, Textarea } from './components/ui/index.js';
const scopes: ModelScope[] = ['both', 'logical', 'physical'];
const scopeNames = { both: '함께', logical: '논리', physical: '물리' };
const emptyMeta = (): CustomProperties => ({ common: {}, logical: {}, physical: {} });
const tableName = (t: Table, mode: ModelScope = 'both') => mode === 'physical' ? t.physical.name || '이름 없는 테이블' : t.logical.name || t.physical.name || '이름 없는 테이블';
const columnName = (c: Column) => c.logical.name || c.physical.name || '이름 없는 컬럼';
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
function Scope({ value, onChange }: {
    value: ModelScope;
    onChange: (v: ModelScope) => void;
}) { return <label>적용 범위<Select value={value} onChange={e => onChange(e.target.value as ModelScope)}>{scopes.map(s => <option key={s} value={s}>{scopeNames[s]}</option>)}</Select></label>; }
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
function Metadata({ value, onChange }: {
    value: CustomProperties;
    onChange: (v: CustomProperties) => void;
}) {
    return <Accordion title="사용자 정의 메타데이터">{(['common', 'logical', 'physical'] as const).map(key => <MetadataArea key={key} label={key === 'common' ? '공통' : scopeNames[key]} value={value[key]} onChange={v => onChange({ ...value, [key]: v })}/>)}</Accordion>;
}
function MetadataArea({ label, value, onChange }: {
    label: string;
    value: Record<string, string>;
    onChange: (v: Record<string, string>) => void;
}) {
    const errorId = useId();
    const [draft, setDraft] = useState<string | null>(null), [error, setError] = useState('');
    return <label>{label} 메타데이터 (JSON)<Textarea invalid={!!error} aria-describedby={error ? errorId : undefined} value={draft ?? JSON.stringify(value, null, 2)} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft === null)
        return; try {
        onChange(parseMetadata(draft));
        setDraft(null);
        setError('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '문자열 값을 가진 JSON 객체를 입력하세요.');
    } }}/>{error && <span id={errorId} role="alert" className="table-error">{error}</span>}</label>;
}
function InlineCell({value, label, onCommit, disabled = false}: {value:string;label:string;onCommit:(value:string)=>void;disabled?:boolean}) {
    const [editing,setEditing]=useState(false), [draft,setDraft]=useState(value); const cancel=useRef(false);
    const commit=()=>{if(!cancel.current && draft!==value)onCommit(draft);setEditing(false);};
    return editing ? <Input autoFocus aria-label={label} value={draft} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){cancel.current=true;setEditing(false);}if(e.key==='Enter'){e.preventDefault();commit();}}}/> : <span className="table-inline" title={`${label}: ${value || '미입력'}${disabled?'':' · 더블클릭하여 편집'}`} onDoubleClick={e=>{if(disabled)return;e.stopPropagation();cancel.current=false;setDraft(value);setEditing(true);}}>{value || '—'}</span>;
}
const freshColumn=(tableId:string,scope:ModelScope='both'):Column=>({id:newId(),tableId,scope,logical:{name:'새 컬럼',definition:'',semanticType:'',required:false},physical:{name:'',type:{name:'text',isArray:false},nullable:false,defaultExpression:null,comment:''},customProperties:emptyMeta()});
export function TableNodeContent({ document:doc, tableId, viewMode, viewId, onChange, readOnly=false, onStartForeignKey }: {
 document:DesignDocument;tableId:string;viewMode:ModelScope;viewId?:string;onChange?:(d:DesignDocument)=>void;readOnly?:boolean;onStartForeignKey?:(id:string)=>void;
}) {
 const [menu,setMenu]=useState<{x:number;y:number;id:string}|null>(null);
 const table=doc.tables?.find(t=>t.id===tableId);if(!table)return null;
 const columns=(doc.columns??[]).filter(c=>c.tableId===tableId&&isVisibleInView(c.scope,viewMode,table.scope));
 const editable=!!onChange&&!readOnly;
 const cell=(value:string,label:string,commit:(v:string)=>DesignDocument)=><InlineCell value={value} label={label} disabled={!editable} onCommit={v=>onChange?.(commit(v))}/>;
 return <div className="table-node-content"><header><small className="table-owner">{viewId&&viewId!==table.domainId?'외부 참조 · ':''}{doc.domains.find(d=>d.id===table.domainId)?.name}</small>
 <strong>{viewMode==='logical'?cell(table.logical.name,'논리 테이블명',name=>updateTable(doc,tableId,{logical:{...table.logical,name}})):cell(table.physical.name,'물리 테이블명',name=>updateTable(doc,tableId,{physical:{...table.physical,name}}))}</strong>
 {viewMode==='both'&&cell(table.logical.name,'논리 테이블명',name=>updateTable(doc,tableId,{logical:{...table.logical,name}}))}</header>
 <div className="table-columns"><div className="table-column-row table-column-head"><span>키</span><span>속성</span><span>타입</span><span>NULL</span><span>주석</span></div>{columns.map(c=>{
 const keys=(doc.keys??[]).filter(k=>k.columnIds.includes(c.id)&&isVisibleInView(k.scope,viewMode,table.scope));
 const fk=(doc.tableRelations??[]).some(r=>r.physical?.sourceColumnIds.includes(c.id)&&r.scope!=='logical'&&isVisibleInView(r.scope,viewMode));
 const logical=viewMode==='logical';const patch=(v:Partial<Column['physical']>)=>updateColumn(doc,c.id,{physical:{...c.physical,...v}});
 return <div className="table-column-row" key={c.id} onContextMenu={e=>{if(!editable)return;e.preventDefault();e.stopPropagation();setMenu({x:e.clientX,y:e.clientY,id:c.id});}}>
 <span className="table-key-marker">{[keys.some(k=>k.kind==='primary')?'PK':'',fk?'FK':'',keys.some(k=>k.kind==='unique')?'UQ':''].filter(Boolean).join(' ')}</span>
 <span>{cell(logical?c.logical.name:c.physical.name,logical?'논리 컬럼명':'물리 컬럼명',name=>logical?updateColumn(doc,c.id,{logical:{...c.logical,name}}):patch({name}))}{viewMode==='both'&&<small>{cell(c.logical.name,'논리 컬럼명',name=>updateColumn(doc,c.id,{logical:{...c.logical,name}}))}</small>}</span>
 <span>{cell(logical?c.logical.semanticType:c.physical.type.enumId?((t)=>t?`${t.schema}.${t.name}`:'ENUM')((doc.enums??[]).find(t=>t.id===c.physical.type.enumId)):c.physical.type.name,logical?'의미 타입':'타입',name=>logical?updateColumn(doc,c.id,{logical:{...c.logical,semanticType:name}}):patch({type:(doc.enums??[]).some(t=>`${t.schema}.${t.name}`===name)?{name,enumId:(doc.enums??[]).find(t=>`${t.schema}.${t.name}`===name)!.id,isArray:c.physical.type.isArray}:{...c.physical.type,name,enumId:undefined}}))}{!logical&&c.physical.type.isArray?'[]':''}</span>
 <span data-inline-edit="true" title="더블클릭하여 NULL 설정 변경" onDoubleClick={e=>{e.stopPropagation();if(editable)onChange?.(logical?updateColumn(doc,c.id,{logical:{...c.logical,required:!c.logical.required}}):patch({nullable:!c.physical.nullable}));}}>{logical?(c.logical.required?'필수':'선택'):(c.physical.nullable?'NULL':'NN')}</span>
 {cell(logical?c.logical.definition:c.physical.comment,'컬럼 주석',comment=>logical?updateColumn(doc,c.id,{logical:{...c.logical,definition:comment}}):patch({comment}))}</div>;
 })}{!columns.length&&<p>컬럼을 추가해 설계를 시작하세요.</p>}</div>
 <div className="table-node-footer" onPointerDown={e=>e.stopPropagation()}><IconButton aria-label="컬럼 추가" disabled={!editable} onClick={()=>onChange?.(addColumn(doc,freshColumn(tableId,table.scope)))}>+</IconButton></div>
 <ContextMenu position={menu} onClose={()=>setMenu(null)} label="컬럼" items={[{id:'fk',label:'FK 관계 연결',disabled:!onStartForeignKey,onAction:()=>menu&&onStartForeignKey?.(menu.id)}]}/></div>;
}
export function TableWorkspaceTools({document:doc,viewId,viewMode,onViewModeChange,onChange,readOnly,position,onSelect,hideViewMode=false}:{document:DesignDocument;viewId:string;viewMode:ModelScope;onViewModeChange:(v:ModelScope)=>void;onChange:(d:DesignDocument)=>void;readOnly:boolean;position:{x:number;y:number};onSelect:(id:string)=>void;hideViewMode?:boolean}) {
 const [reference,setReference]=useState(''),[search,setSearch]=useState(''),[name,setName]=useState('');
 const available=(doc.tables??[]).filter(t=>t.domainId!==viewId&&!doc.layout.nodes.some(n=>n.objectId===t.id&&n.viewId===viewId));
 return <div className="table-workspace-tools">{!hideViewMode&&<label>모델 보기<Select value={viewMode} onChange={e=>onViewModeChange(e.target.value as ModelScope)}>{scopes.map(s=><option key={s} value={s}>{scopeNames[s]}</option>)}</Select></label>}
 <Accordion title="새 테이블 생성"><TextField label="새 테이블 물리명" value={name} onChange={setName}/><Button disabled={readOnly||viewId==='overview'} onClick={()=>{const id=newId();onChange(addTable(doc,{id,domainId:viewId,scope:'both',logical:{name:'새 테이블',definition:''},physical:{name,schema:'public',comment:''},customProperties:emptyMeta()},position));setName('');onSelect(id);}}>+ 테이블</Button></Accordion>
 <Accordion title="프로젝트 ENUM"><EnumManager document={doc} onChange={onChange} readOnly={readOnly}/></Accordion>
 <Accordion title="테이블 검색"><Input aria-label="테이블 검색" value={search} onChange={e=>setSearch(e.target.value)}/>{(doc.tables??[]).filter(t=>doc.layout.nodes.some(n=>n.viewId===viewId&&n.objectId===t.id)&&`${t.physical.name} ${t.logical.name}`.toLowerCase().includes(search.toLowerCase())).map(t=><Button key={t.id} onClick={()=>onSelect(t.id)}>{t.physical.name||t.logical.name}</Button>)}</Accordion>
 <Accordion title="외부 테이블 참조"><label>외부 테이블 참조<Select disabled={readOnly} value={reference} onChange={e=>setReference(e.target.value)}><option value="">테이블 선택</option>{available.map(t=><option key={t.id} value={t.id}>{doc.domains.find(d=>d.id===t.domainId)?.name} / {tableName(t)}</option>)}</Select></label><Button disabled={readOnly||!available.some(t=>t.id===reference)} onClick={()=>{onChange(addTableReference(doc,reference,viewId,position));onSelect(reference);setReference('');}}>참조 추가</Button></Accordion></div>;
}
function EnumManager({document:doc,onChange,readOnly}:{document:DesignDocument;onChange:(d:DesignDocument)=>void;readOnly:boolean}) {
 const [editing,setEditing]=useState<string|null>(null),[name,setName]=useState(''),[schema,setSchema]=useState('public'),[values,setValues]=useState(''),[error,setError]=useState('');
 return <fieldset disabled={readOnly}><p>프로젝트의 모든 테이블에서 함께 사용하는 PostgreSQL ENUM입니다.</p>{(doc.enums??[]).map(item=><div className="table-enum-item" key={item.id}><strong>{item.schema}.{item.name}</strong><small>{item.values.join(' · ')}</small><div className="table-actions"><Button onClick={()=>{setEditing(item.id);setName(item.name);setSchema(item.schema);setValues(item.values.join('\n'));}}>편집</Button><Button variant="danger" onClick={()=>{try{onChange(removeEnum(doc,item.id));setError('');}catch(e){setError(e instanceof Error?e.message:'사용 중인 ENUM은 삭제할 수 없습니다.');}}}>삭제</Button></div></div>)}
 <TextField label="ENUM 이름" value={name} max={120} onChange={setName}/><TextField label="ENUM 스키마" value={schema} max={120} onChange={setSchema}/><label>ENUM 값 (한 줄에 하나, 빈 줄은 빈 문자열)<Textarea value={values} onChange={e=>setValues(e.target.value)}/></label><Button disabled={!name.trim()||!schema.trim()} onClick={()=>{try{onChange(upsertEnum(doc,{id:editing??newId(),name:name.trim(),schema:schema.trim(),values:values.split('\n')}));setEditing(null);setName('');setValues('');setError('');}catch(e){setError(e instanceof Error?e.message:'ENUM을 확인하세요.');}}}>{editing?'ENUM 변경 적용':'ENUM 생성'}</Button>{editing&&<Button onClick={()=>{setEditing(null);setName('');setValues('');}}>편집 취소</Button>}{error&&<p role="alert" className="table-error">{error}</p>}</fieldset>;
}
export function TableInspector({ document: doc, tableId, onChange, readOnly, onStartForeignKey }: {
    document: DesignDocument;
    tableId: string;
    onChange: (d: DesignDocument) => void;
    readOnly: boolean;
    onStartForeignKey?: (id:string)=>void;
}) {
    const table = doc.tables?.find(t => t.id === tableId);
    if (!table)
        return null;
    const cols = (doc.columns ?? []).filter(c => c.tableId === tableId), relations = (doc.tableRelations ?? []).filter(r => r.sourceTableId === tableId || r.targetTableId === tableId);
    const change = (next: DesignDocument) => { if (!readOnly)
        onChange(next); };
    const patch = (p: Partial<Table>) => change(updateTable(doc, tableId, p));
    return <section className="table-inspector"><h3>테이블 설계</h3><p className="table-owner">소유 도메인 · {doc.domains.find(d => d.id === table.domainId)?.name} · 참조 화면에서도 원본을 편집합니다.</p><fieldset disabled={readOnly}><Scope value={table.scope} onChange={scope => patch({ scope })}/><Accordion title="논리 특성"><TextField label="논리 테이블명" value={table.logical.name} max={120} onChange={name => patch({ logical: { ...table.logical, name } })}/><TextField label="테이블 정의" value={table.logical.definition} onChange={definition => patch({ logical: { ...table.logical, definition } })}/></Accordion><Accordion title="물리 특성"><TextField label="물리 테이블명" value={table.physical.name} max={120} onChange={name => patch({ physical: { ...table.physical, name } })}/><TextField label="스키마" value={table.physical.schema} max={120} onChange={schema => patch({ physical: { ...table.physical, schema } })}/><TextField label="테이블 주석" value={table.physical.comment} onChange={comment => patch({ physical: { ...table.physical, comment } })}/></Accordion><Metadata value={table.customProperties} onChange={customProperties => patch({ customProperties })}/><Accordion title={`컬럼 생성 · 편집 (${cols.length})`}>{cols.map((c, i) => <ColumnEditor key={c.id} document={doc} column={c} index={i} count={cols.length} onChange={p => change(updateColumn(doc, c.id, p))} onMove={dir => change(moveColumn(doc, c.id, dir))} onDelete={() => change(removeColumn(doc, c.id))}/>)}<ColumnCreationForm document={doc} tableId={tableId} onChange={change}/></Accordion><Accordion title="키 · PK / UNIQUE">{(doc.keys ?? []).filter(k => k.tableId === tableId).map(k => <KeyEditor key={k.id} item={k} columns={cols} onChange={next => change(upsertKey(doc, next))} onDelete={() => change(removeKey(doc, k.id))}/>)}<Button onClick={() => change(upsertKey(doc, { id: newId(), tableId, scope: table.scope, kind: 'unique', name: '', columnIds: [] }))}>+ 키 추가</Button></Accordion><Accordion title={`테이블 관계 (${relations.length})`}><label>FK 출발 컬럼<Select value="" disabled={!onStartForeignKey} onChange={e=>e.target.value&&onStartForeignKey?.(e.target.value)}><option value="">컬럼 선택 후 대상 테이블 클릭</option>{cols.filter(c=>c.scope!=='logical').map(c=><option key={c.id} value={c.id}>{c.physical.name||c.logical.name}</option>)}</Select></label>{relations.map(r => <RelationEditor key={r.id} document={doc} item={r} onChange={next => change(upsertTableRelation(doc, next))} onDelete={() => change(removeTableRelation(doc, r.id))}/>)}<Button disabled={table.scope==='physical'} onClick={() => change(upsertTableRelation(doc, { id: newId(), sourceTableId: tableId, targetTableId: tableId, scope: 'logical', logical: { name: '새 관계', cardinality: 'one-to-many', required: false }, physical: null }))}>+ 테이블 관계 추가</Button></Accordion><Button variant="danger" className="danger" onClick={() => { if (window.confirm('테이블과 소유 컬럼, 키, 관계 및 모든 외부 참조를 삭제할까요?'))
        change(removeTable(doc, tableId)); }}>테이블 삭제</Button></fieldset></section>;
}
function ColumnEditor({ document:doc, column: c, index, count, onChange, onMove, onDelete }: {
    document: DesignDocument;
    column: Column;
    index: number;
    count: number;
    onChange: (p: Partial<Column>) => void;
    onMove: (d: number) => void;
    onDelete: () => void;
}) {
    const logical = (p: Partial<Column['logical']>) => onChange({ logical: { ...c.logical, ...p } }), physical = (p: Partial<Column['physical']>) => onChange({ physical: { ...c.physical, ...p } });
    return <Accordion className="table-edit-card" title={<>{index + 1}. {columnName(c)} <small>{c.physical.name}</small></>}><div className="table-actions"><IconButton aria-label={`${columnName(c)} 위로`} disabled={index === 0} onClick={() => onMove(-1)}>↑</IconButton><IconButton aria-label={`${columnName(c)} 아래로`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</IconButton><Button variant="danger" className="danger" onClick={onDelete}>컬럼 삭제</Button></div><Scope value={c.scope} onChange={scope => onChange({ scope })}/><TextField label="논리 컬럼명" value={c.logical.name} max={120} onChange={name => logical({ name })}/><TextField label="의미 타입" value={c.logical.semanticType} max={120} onChange={semanticType => logical({ semanticType })}/><TextField label="컬럼 정의" value={c.logical.definition} onChange={definition => logical({ definition })}/><Check label="논리 필수" value={c.logical.required} onChange={required => logical({ required })}/><TextField label="물리 컬럼명" value={c.physical.name} max={120} onChange={name => physical({ name })}/><label>공통 ENUM<Select value={c.physical.type.enumId??''} onChange={e=>physical({type:{name:e.target.value?(doc.enums??[]).find(t=>t.id===e.target.value)?.name??'text':'text',isArray:c.physical.type.isArray,enumId:e.target.value||undefined}})}><option value="">기본 PostgreSQL 타입</option>{(doc.enums??[]).map(t=><option key={t.id} value={t.id}>{t.schema}.{t.name}</option>)}</Select></label><label>PostgreSQL 타입<Input disabled={!!c.physical.type.enumId} list={`postgres-types-${c.id}`} maxLength={120} value={c.physical.type.name} onChange={e => physical({ type: { ...c.physical.type, name: e.target.value } })}/><datalist id={`postgres-types-${c.id}`}>{['uuid', 'integer', 'bigint', 'smallint', 'serial', 'bigserial', 'smallserial', 'boolean', 'text', 'varchar', 'char', 'numeric', 'decimal', 'real', 'double precision', 'date', 'time', 'timetz', 'timestamp', 'timestamptz', 'json', 'jsonb', 'bytea'].map(t => <option key={t} value={t}/>)}</datalist></label><div className="table-type-params">{(['length', 'precision', 'scale'] as const).map(key => <label key={key}>{{ length: '길이', precision: '정밀도', scale: '소수 자릿수' }[key]}<Input type="number" step={1} min={key === 'scale' ? -1000 : key === 'precision' ? 0 : 1} max={key === 'length' ? 10485760 : 1000} value={c.physical.type[key] ?? ''} onChange={e => { const value = e.target.value === '' ? undefined : Number(e.target.value); if (value === undefined || (Number.isInteger(value) && value >= (key === 'scale' ? -1000 : key === 'precision' ? 0 : 1) && value <= (key === 'length' ? 10485760 : 1000)))
        physical({ type: { ...c.physical.type, [key]: value } }); }}/></label>)}</div><Check label="배열 타입" value={c.physical.type.isArray} onChange={isArray => physical({ type: { ...c.physical.type, isArray } })}/><Check label="물리 NULL 허용" value={c.physical.nullable} onChange={nullable => physical({ nullable })}/><TextField label="기본값 SQL 식" value={c.physical.defaultExpression ?? ''} onChange={defaultExpression => physical({ defaultExpression: defaultExpression || null })}/><TextField label="컬럼 주석" value={c.physical.comment} onChange={comment => physical({ comment })}/><Metadata value={c.customProperties} onChange={customProperties => onChange({ customProperties })}/></Accordion>;
}
function KeyEditor({ item: k, columns, onChange, onDelete }: {
    item: TableKey;
    columns: Column[];
    onChange: (k: TableKey) => void;
    onDelete: () => void;
}) {
    return <Accordion className="table-edit-card" open title={<>{k.kind === 'primary' ? '기본 키' : '고유 키'} · {k.name || '이름 없음'}</>}><Scope value={k.scope} onChange={scope => onChange({ ...k, scope })}/><label>키 종류<Select value={k.kind} onChange={e => onChange({ ...k, kind: e.target.value as TableKey['kind'] })}><option value="primary">PRIMARY KEY</option><option value="unique">UNIQUE</option></Select></label><TextField label="키 이름" value={k.name} max={120} onChange={name => onChange({ ...k, name })}/><p>체크한 순서대로 하나의 복합 {k.kind==='primary'?'PRIMARY KEY':'UNIQUE'}를 구성합니다.</p><div className="table-key-options">{columns.map(c=><Check key={c.id} label={`${k.columnIds.includes(c.id)?`${k.columnIds.indexOf(c.id)+1}. `:''}${c.physical.name||columnName(c)}`} value={k.columnIds.includes(c.id)} onChange={checked=>onChange({...k,columnIds:checked?[...k.columnIds,c.id]:k.columnIds.filter(id=>id!==c.id)})}/>)}</div><Button variant="danger" className="danger" onClick={onDelete}>키 삭제</Button></Accordion>;
}
function RelationEditor({ document: doc, item: r, onChange, onDelete }: {
    document: DesignDocument;
    item: TableRelation;
    onChange: (r: TableRelation) => void;
    onDelete: () => void;
}) {
    const physical = r.physical, source = (doc.columns ?? []).filter(c => c.tableId === r.sourceTableId), target = (doc.columns ?? []).filter(c => c.tableId === r.targetTableId);
    return <Accordion className="table-edit-card" title={<>{doc.tables?.find(t => t.id === r.sourceTableId)?.logical.name} → {doc.tables?.find(t => t.id === r.targetTableId)?.logical.name} · {r.logical.name}</>}><Scope value={r.scope} onChange={scope => onChange({ ...r, scope })}/>{(['sourceTableId', 'targetTableId'] as const).map(key => <label key={key}>{key === 'sourceTableId' ? '출발 테이블 (FK 보유)' : '대상 테이블 (참조 키)'}<Select value={r[key]} onChange={e => onChange({ ...r, [key]: e.target.value, physical: physical ? { ...physical, sourceColumnIds: [], targetColumnIds: [] } : null })}>{doc.tables?.map(t => <option key={t.id} value={t.id}>{doc.domains.find(d => d.id === t.domainId)?.name} / {tableName(t)}</option>)}</Select></label>)}<TextField label="논리 관계명" value={r.logical.name} max={120} onChange={name => onChange({ ...r, logical: { ...r.logical, name } })}/>{!r.logical.sourceCardinality&&!r.logical.targetCardinality&&<label>논리 카디널리티<Select value={r.logical.cardinality} onChange={e => onChange({ ...r, logical: { ...r.logical, cardinality: e.target.value as TableRelation['logical']['cardinality'] } })}><option value="one-to-one">1 : 1</option><option value="one-to-many">1 : N</option><option value="many-to-many">N : M</option></Select></label>}<TextField label="관계 설명" value={r.logical.description??''} onChange={description=>onChange({...r,logical:{...r.logical,description}})}/>{(['sourceCardinality','targetCardinality'] as const).map(side=>{const endpoint=r.logical[side]??{min:side==='sourceCardinality'?0:r.logical.required?1:0,max:side==='sourceCardinality'?(r.logical.cardinality==='one-to-one'?1:'many'):(r.logical.cardinality==='many-to-many'?'many':1)};return <label key={side}>{side==='sourceCardinality'?'출발 끝점':'대상 끝점'}<Select value={`${endpoint.min}:${endpoint.max}`} onChange={e=>{const [min,max]=e.target.value.split(':');onChange({...r,logical:{...r.logical,[side]:{min:Number(min) as 0|1,max:max==='many'?'many':1}}});}}><option value="0:1">0..1</option><option value="1:1">1</option><option value="0:many">0..N</option><option value="1:many">1..N</option></Select></label>;})}{!r.logical.targetCardinality&&<Check label="논리 관계 필수" value={r.logical.required} onChange={required => onChange({ ...r, logical: { ...r.logical, required } })}/>}{physical?<Button onClick={()=>onChange({...r,physical:null})}>물리 FK 정의 제거</Button>:<p>새 FK는 테이블 관계의 출발 컬럼을 선택한 뒤 대상 PK / UNIQUE 대응을 확인하여 생성합니다.</p>}{physical && <><TextField label="FK 이름" value={physical.name} max={120} onChange={name => onChange({ ...r, physical: { ...physical, name } })}/><p>출발 컬럼 → 대상 컬럼을 순서대로 연결합니다. 대상 컬럼은 PK 또는 UNIQUE와 일치해야 합니다.</p>{physical.sourceColumnIds.map((id, i) => <div className="table-mapping" key={i}><span>{i + 1}</span>{(['source', 'target'] as const).map(side => <label key={side}>{side === 'source' ? '출발' : '대상'} 컬럼<Select value={side === 'source' ? id : physical.targetColumnIds[i] ?? ''} onChange={e => { if (e.target.value)
        onChange({ ...r, physical: setMappingPair(physical, i, side, e.target.value) }); }}><option value="">선택</option>{(side === 'source' ? source : target).map(c => <option key={c.id} value={c.id}>{columnName(c)}</option>)}</Select></label>)}<IconButton aria-label={`매핑 ${i + 1} 삭제`} onClick={() => onChange({ ...r, physical: { ...physical, sourceColumnIds: physical.sourceColumnIds.filter((_, at) => at !== i), targetColumnIds: physical.targetColumnIds.filter((_, at) => at !== i) } })}>×</IconButton></div>)}<Button disabled={!source.length || !target.length} onClick={() => onChange({ ...r, physical: { ...physical, sourceColumnIds: [...physical.sourceColumnIds, source[0]?.id ?? ''], targetColumnIds: [...physical.targetColumnIds, target[0]?.id ?? ''] } })}>+ 컬럼 매핑</Button>{(['onDelete', 'onUpdate'] as const).map(key => <label key={key}>{key === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'}<Select value={physical[key]} onChange={e => onChange({ ...r, physical: { ...physical, [key]: e.target.value as ReferentialAction } })}>{['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].map(action => <option key={action}>{action}</option>)}</Select></label>)}</>}<Button variant="danger" className="danger" onClick={onDelete}>관계 삭제</Button></Accordion>;
}

type RelationBounds = { x: number; y: number; width: number; height: number };
/** Keep labels outside endpoint cards when their horizontal gap cannot fit the label. */
export function relationGeometry(a: RelationBounds, b: RelationBounds, labelWidth: number, lane: number) {
    const aw = Math.max(280, a.width), ah = Math.max(220, a.height);
    const bw = Math.max(280, b.width), bh = Math.max(220, b.height);
    const ax = a.x + aw, ay = a.y + ah / 2, bx = b.x, by = b.y + bh / 2;
    if (a === b) {
        const top = a.y - 54 - lane * 32, right = ax + 54;
        return {
            path: `M ${ax + 5} ${ay} L ${right} ${ay} L ${right} ${top} L ${a.x + aw / 2} ${top} L ${a.x + aw / 2} ${a.y - 8}`,
            labelX: (right + a.x + aw / 2) / 2, labelY: top - 17,
        };
    }
    if (bx - ax < labelWidth + 40) {
        const top = Math.min(a.y, b.y) - 54 - lane * 32;
        const startX = a.x + aw / 2, endX = b.x + bw / 2;
        return {
            path: `M ${startX} ${a.y - 5} L ${startX} ${top} L ${endX} ${top} L ${endX} ${b.y - 8}`,
            labelX: (startX + endX) / 2, labelY: top - 17,
        };
    }
    return {
        path: `M ${ax + 5} ${ay} C ${ax + 80} ${ay - lane * 48}, ${bx - 80} ${by - lane * 48}, ${bx - 8} ${by}`,
        labelX: (ax + bx) / 2, labelY: (ay + by) / 2 - 18 - lane * 36,
    };
}
export function TableRelationsSvg({ document: doc, viewId, viewMode, onSelect, onChange, readOnly=false }: {
    document: DesignDocument;
    viewId: string;
    viewMode: ModelScope;
    onSelect: (id: string) => void;
    onChange?: (d:DesignDocument)=>void;readOnly?:boolean;
}) {
    const [menu,setMenu]=useState<{x:number;y:number;id:string}|null>(null);
    return <>{(doc.tableRelations ?? []).map((relation) => {
        const source = doc.tables?.find(table => table.id === relation.sourceTableId);
        const target = doc.tables?.find(table => table.id === relation.targetTableId);
        const a = doc.layout.nodes.find(node => node.objectId === relation.sourceTableId && node.viewId === viewId);
        const b = doc.layout.nodes.find(node => node.objectId === relation.targetTableId && node.viewId === viewId);
        if (!source || !target || !a || !b || !isVisibleInView(relation.scope, viewMode)
            || !isVisibleInView(source.scope, viewMode) || !isVisibleInView(target.scope, viewMode)) return null;
        if (viewMode === 'physical' && !relation.physical) return null;
        const physical = viewMode !== 'logical' && !!relation.physical && relation.scope !== 'logical';
        const endLabel=(end:{min:0|1;max:1|'many'})=>`${end.min}..${end.max==='many'?'N':end.max}`;
        const cardinality = relation.logical.sourceCardinality&&relation.logical.targetCardinality?`${endLabel(relation.logical.sourceCardinality)} → ${endLabel(relation.logical.targetCardinality)}`:{ 'one-to-one': '1:1', 'one-to-many': '1:N', 'many-to-many': 'N:M' }[relation.logical.cardinality];
        const attribute=(relation.physical?.sourceColumnIds??[]).map(id=>doc.columns?.find(c=>c.id===id)?.physical.name||'?').join(', ');
        const name = `${source.physical.name||source.logical.name}.${attribute||relation.logical.name||'관계'}:${target.physical.name||target.logical.name}`;
        const fullLabel = `${name} · ${viewMode === 'physical' ? 'FK' : cardinality}${physical && viewMode === 'both' ? ' · FK' : ''}`;
        const label = fullLabel.length > 40 ? `${fullLabel.slice(0, 37)}…` : fullLabel;
        const labelWidth = Math.max(90, [...label].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 14 : 8), 24));
        const pair=(doc.tableRelations??[]).filter(r=>[r.sourceTableId,r.targetTableId].sort().join(':')===[relation.sourceTableId,relation.targetTableId].sort().join(':'));
        const geometry = relationGeometry(a, b, labelWidth, pair.findIndex(r=>r.id===relation.id));
        const markerId = `table-crow-${relation.id}`;
        const endpoints=[relation.logical.sourceCardinality??{min:0,max:relation.logical.cardinality==='one-to-one'?1:'many'},relation.logical.targetCardinality??{min:relation.logical.required?1:0,max:relation.logical.cardinality==='many-to-many'?'many':1}];
        const stroke = physical ? 'var(--accent)' : 'var(--muted)';
        return <g key={relation.id} className="table-relation-line" role="button" tabIndex={0}
            aria-label={`테이블 관계 ${fullLabel}`} onContextMenu={event=>{if(readOnly||!onChange)return;event.preventDefault();event.stopPropagation();setMenu({x:event.clientX,y:event.clientY,id:relation.id});}}
            onClick={event => { event.stopPropagation(); onSelect(relation.sourceTableId); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(relation.sourceTableId); } }}>
            <title>{fullLabel}{relation.logical.description?` — ${relation.logical.description}`:''}</title>
            <defs>{endpoints.map((endpoint,i)=><marker key={i} id={`${markerId}-${i}`} viewBox="0 0 32 24" refX="30" refY="12" markerWidth="32" markerHeight="24" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><g fill="none" stroke={stroke} strokeWidth="1.7">{endpoint.max==='many'?<path d="M 18 12 L 30 3 M 18 12 L 30 21 M 18 12 L 30 12"/>:<path d="M 27 4 L 27 20"/>}{endpoint.min===0?<circle cx="10" cy="12" r="5" fill="#fafbfc"/>:<path d="M 13 4 L 13 20"/>}</g></marker>)}</defs>
            <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={18}/>
            <path d={geometry.path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round"
                strokeDasharray={physical ? undefined : '6 4'} markerStart={`url(#${markerId}-0)`} markerEnd={`url(#${markerId}-1)`}/>
            <rect x={geometry.labelX - labelWidth / 2} y={geometry.labelY - 13} width={labelWidth} height={28}
                rx={9} fill="#fafbfc" stroke="#bdc8d8" strokeWidth={1}/>
            <text x={geometry.labelX} y={geometry.labelY + 5} textAnchor="middle">{label}</text>
        </g>;
    })}{menu&&typeof document!=='undefined'&&createPortal(<ContextMenu position={menu} onClose={()=>setMenu(null)} label="테이블 관계" items={[{id:'delete',label:'관계 삭제',destructive:true,onAction:()=>{if(menu&&!readOnly)onChange?.(removeTableRelation(doc,menu.id));}}]}/>,document.body)}</>;
}

export function ForeignKeyDialog({document:doc,sourceColumnId,targetTableId,onChange,onClose}:{document:DesignDocument;sourceColumnId:string;targetTableId:string;onChange:(d:DesignDocument)=>void;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);const source=doc.columns?.find(c=>c.id===sourceColumnId);
 const sourceTable=doc.tables?.find(t=>t.id===source?.tableId),target=doc.tables?.find(t=>t.id===targetTableId);
 const keys=(doc.keys??[]).filter(k=>k.tableId===targetTableId&&k.scope!=='logical'&&k.columnIds.length&&k.columnIds.every(id=>doc.columns?.some(c=>c.id===id&&c.tableId===targetTableId&&c.scope!=='logical')));
 const [keyId,setKeyId]=useState(keys[0]?.id??''),[mapping,setMapping]=useState<string[]>([sourceColumnId]),[error,setError]=useState('');
 const [name,setName]=useState(''),[description,setDescription]=useState('');
 const [sourceEnd,setSourceEnd]=useState('0:many'),[targetEnd,setTargetEnd]=useState(source?.physical.nullable?'0:1':'1:1');
 const key=keys.find(k=>k.id===keyId);const columns=(doc.columns??[]).filter(c=>c.tableId===source?.tableId&&c.scope!=='logical');
 useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 const valid=!!source&&!!sourceTable&&sourceTable.scope!=='logical'&&!!target&&target.scope!=='logical'&&!!key&&key.columnIds.length===mapping.filter(Boolean).length&&new Set(mapping).size===mapping.length&&mapping.every(id=>columns.some(c=>c.id===id));
 return createPortal(<dialog ref={dialog} className="table-fk-dialog" aria-labelledby="fk-dialog-title" onCancel={onClose} onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}><h2 id="fk-dialog-title">FK 컬럼 대응 확인</h2><p>{sourceTable?.physical.name||sourceTable?.logical.name} → {target?.physical.name||target?.logical.name}</p>
 <label>대상 PK / UNIQUE<Select value={keyId} onChange={e=>{setKeyId(e.target.value);setMapping([sourceColumnId]);setError('');}}>{keys.length===0&&<option value="">참조 가능한 키 없음</option>}{keys.map(k=><option key={k.id} value={k.id}>{k.kind==='primary'?'PK':'UNIQUE'} · {k.name||k.columnIds.map(id=>doc.columns?.find(c=>c.id===id)?.physical.name).join(', ')}</option>)}</Select></label>
 {!keys.length&&<p role="status">대상 테이블에 물리 PK 또는 UNIQUE를 먼저 정의하세요.</p>}
 <div className="table-fk-pairs">{key?.columnIds.map((id,index)=><div key={id}><label>출발 컬럼 {index+1}<Select value={mapping[index]??''} onChange={e=>{const next=[...mapping];next[index]=e.target.value;setMapping(next);setError('');}}><option value="">컬럼 선택</option>{columns.map(c=><option key={c.id} value={c.id}>{c.physical.name||c.logical.name} · {c.physical.type.name}</option>)}</Select></label><span aria-hidden="true">→</span><span>{doc.columns?.find(c=>c.id===id)?.physical.name||'이름 없는 컬럼'}<small>{doc.columns?.find(c=>c.id===id)?.physical.type.name}</small></span></div>)}</div>
 <div className="table-type-params">{([{label:'출발 끝점',value:sourceEnd,set:setSourceEnd},{label:'대상 끝점',value:targetEnd,set:setTargetEnd}]).map(item=><label key={item.label}>{item.label}<Select value={item.value} onChange={e=>item.set(e.target.value)}><option value="0:1">0..1</option><option value="1:1">1</option><option value="0:many">0..N</option><option value="1:many">1..N</option></Select></label>)}</div><TextField label="FK 제약조건 이름 (선택)" value={name} max={120} onChange={setName}/><TextField label="관계 설명" value={description} onChange={setDescription}/>
 {error&&<p role="alert" className="table-error">{error}</p>}<div className="table-actions"><Button onClick={onClose}>취소</Button><Button variant="primary" disabled={!valid} onClick={()=>{if(!source||!key||!valid)return;
 const relation:TableRelation={id:newId(),sourceTableId:source.tableId,targetTableId,scope:sourceTable?.scope==='physical'||target?.scope==='physical'?'physical':'both',logical:{name:'',description,cardinality:'one-to-many',required:false,sourceCardinality:{min:sourceEnd.startsWith('0')?0:1,max:sourceEnd.endsWith('many')?'many':1},targetCardinality:{min:targetEnd.startsWith('0')?0:1,max:targetEnd.endsWith('many')?'many':1}},physical:{name,sourceColumnIds:mapping,targetColumnIds:key.columnIds,onDelete:'NO ACTION',onUpdate:'NO ACTION'}};
 const next=upsertTableRelation(doc,relation);const diagnostics=exportPostgres(next).diagnostics.filter(d=>d.objectId===relation.id);
 if(diagnostics.length){setError(diagnostics.map(d=>d.message).join(' '));return;}onChange(next);onClose();}}>대응 확인 후 FK 생성</Button></div></dialog>,document.body);
}

function ColumnCreationForm({document:doc,tableId,onChange}:{document:DesignDocument;tableId:string;onChange:(d:DesignDocument)=>void}) {
 const [name,setName]=useState(''),[logicalName,setLogicalName]=useState(''),[type,setType]=useState('text'),[comment,setComment]=useState(''),[pk,setPk]=useState(false),[notNull,setNotNull]=useState(true);
 return <div className="table-column-create"><div className="table-create-grid"><label>PK<Checkbox checked={pk} onChange={e=>setPk(e.target.checked)}/></label><TextField label="물리 속성명" value={name} max={120} onChange={setName}/><TextField label="논리 속성명" value={logicalName} max={120} onChange={setLogicalName}/><label>타입<Select value={type} onChange={e=>setType(e.target.value)}>{['text','uuid','integer','bigint','boolean','numeric','date','timestamptz','jsonb'].map(t=><option key={t}>{t}</option>)}{(doc.enums??[]).map(t=><option key={t.id} value={`enum:${t.id}`}>{t.schema}.{t.name}</option>)}</Select></label><label>NOT NULL<Checkbox checked={notNull||pk} disabled={pk} onChange={e=>setNotNull(e.target.checked)}/></label><TextField label="새 컬럼 주석" value={comment} onChange={setComment}/></div>
 <Button onClick={()=>{const column=freshColumn(tableId,doc.tables?.find(t=>t.id===tableId)?.scope);column.logical.name=logicalName||'새 컬럼';column.physical.name=name;column.physical.comment=comment;column.physical.nullable=!notNull&&!pk;column.physical.type=type.startsWith('enum:')?{name:(doc.enums??[]).find(t=>t.id===type.slice(5))?.name??'text',enumId:type.slice(5),isArray:false}:{name:type,isArray:false};let next=addColumn(doc,column);if(pk){const existing=doc.keys?.find(k=>k.tableId===tableId&&k.kind==='primary');next=upsertKey(next,existing?{...existing,columnIds:[...existing.columnIds,column.id]}:{id:newId(),tableId,scope:column.scope,kind:'primary',name:'',columnIds:[column.id]});}onChange(next);setName('');setLogicalName('');setComment('');setPk(false);}}>+ 컬럼 추가</Button></div>;
}

import { useId, useState } from 'react';
import { type DesignDocument, type ModelScope, type Table, type Column, type CustomProperties, type TableRelation, type TableKey, type ReferentialAction, addTable, updateTable, removeTable, addColumn, updateColumn, removeColumn, upsertKey, removeKey, upsertTableRelation, removeTableRelation, addTableReference, isVisibleInView } from '@ezerd/model';
import { newId } from './client.js';
import './table-editor.css';
import { Accordion, Button, Checkbox, IconButton, Input, Select, Textarea } from './components/ui/index.js';
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
export function TableNodeContent({ document: doc, tableId, viewMode, viewId }: {
    document: DesignDocument;
    tableId: string;
    viewMode: ModelScope;
    viewId?: string;
}) {
    const table = doc.tables?.find(t => t.id === tableId);
    if (!table)
        return null;
    const columns = (doc.columns ?? []).filter(c => c.tableId === tableId && isVisibleInView(c.scope, viewMode, table.scope));
    return <div className="table-node-content"><header><small className="table-owner">{viewId && viewId !== table.domainId ? '외부 참조 · ' : ''}{doc.domains.find(d => d.id === table.domainId)?.name ?? '소유 도메인 없음'}</small><strong>{tableName(table, viewMode)}</strong>{viewMode === 'both' && <span>{table.physical.schema}.{table.physical.name}</span>}</header><div className="table-columns">{columns.length === 0 ? <p>컬럼을 추가해 설계를 시작하세요.</p> : columns.map(c => <div className="table-column-row" key={c.id}><span className="table-key-marker">{(doc.keys ?? []).some(k => k.tableId === tableId && k.kind === 'primary' && k.columnIds.includes(c.id) && isVisibleInView(k.scope, viewMode, table.scope)) ? 'PK' : (doc.keys ?? []).some(k => k.kind === 'unique' && k.columnIds.includes(c.id) && isVisibleInView(k.scope, viewMode, table.scope)) ? 'UQ' : ''}</span><span>{viewMode === 'physical' ? c.physical.name : columnName(c)}{viewMode === 'both' && <small>{c.physical.name}</small>}</span><span>{viewMode === 'logical' ? c.logical.semanticType : c.physical.type.name}{viewMode !== 'logical' && c.physical.type.isArray ? '[]' : ''}<small>{viewMode === 'logical' ? (c.logical.required ? '필수' : '선택') : (c.physical.nullable ? 'NULL' : 'NOT NULL')}</small></span></div>)}</div></div>;
}
export function TableWorkspaceTools({ document: doc, viewId, viewMode, onViewModeChange, onChange, readOnly, position, onSelect }: {
    document: DesignDocument;
    viewId: string;
    viewMode: ModelScope;
    onViewModeChange: (v: ModelScope) => void;
    onChange: (d: DesignDocument) => void;
    readOnly: boolean;
    position: {
        x: number;
        y: number;
    };
    onSelect: (id: string) => void;
}) {
    const [reference, setReference] = useState('');
    const available = (doc.tables ?? []).filter(t => t.domainId !== viewId && !doc.layout.nodes.some(n => n.objectId === t.id && n.viewId === viewId));
    return <div className="table-workspace-tools"><label>모델 보기<Select value={viewMode} onChange={e => onViewModeChange(e.target.value as ModelScope)}>{scopes.map(s => <option key={s} value={s}>{scopeNames[s]}</option>)}</Select></label>{viewId !== 'overview' && <><Button disabled={readOnly} onClick={() => { const id = newId(); onChange(addTable(doc, { id, domainId: viewId, scope: 'both', logical: { name: '새 테이블', definition: '' }, physical: { name: '', schema: 'public', comment: '' }, customProperties: emptyMeta() }, position)); onSelect(id); }}>+ 테이블</Button><label>외부 테이블 참조<Select disabled={readOnly} value={reference} onChange={e => setReference(e.target.value)}><option value="">테이블 선택</option>{available.map(t => <option key={t.id} value={t.id}>{doc.domains.find(d => d.id === t.domainId)?.name} / {tableName(t)}</option>)}</Select></label><Button disabled={readOnly || !available.some(t => t.id === reference)} onClick={() => { onChange(addTableReference(doc, reference, viewId, position)); onSelect(reference); setReference(''); }}>참조 추가</Button></>}</div>;
}
export function TableInspector({ document: doc, tableId, onChange, readOnly }: {
    document: DesignDocument;
    tableId: string;
    onChange: (d: DesignDocument) => void;
    readOnly: boolean;
}) {
    const table = doc.tables?.find(t => t.id === tableId);
    if (!table)
        return null;
    const cols = (doc.columns ?? []).filter(c => c.tableId === tableId), relations = (doc.tableRelations ?? []).filter(r => r.sourceTableId === tableId || r.targetTableId === tableId);
    const change = (next: DesignDocument) => { if (!readOnly)
        onChange(next); };
    const patch = (p: Partial<Table>) => change(updateTable(doc, tableId, p));
    return <section className="table-inspector"><h3>테이블 설계</h3><p className="table-owner">소유 도메인 · {doc.domains.find(d => d.id === table.domainId)?.name} · 참조 화면에서도 원본을 편집합니다.</p><fieldset disabled={readOnly}><Scope value={table.scope} onChange={scope => patch({ scope })}/><Accordion open title="논리 특성"><TextField label="논리 테이블명" value={table.logical.name} max={120} onChange={name => patch({ logical: { ...table.logical, name } })}/><TextField label="테이블 정의" value={table.logical.definition} onChange={definition => patch({ logical: { ...table.logical, definition } })}/></Accordion><Accordion open title="물리 특성"><TextField label="물리 테이블명" value={table.physical.name} max={120} onChange={name => patch({ physical: { ...table.physical, name } })}/><TextField label="스키마" value={table.physical.schema} max={120} onChange={schema => patch({ physical: { ...table.physical, schema } })}/><TextField label="테이블 주석" value={table.physical.comment} onChange={comment => patch({ physical: { ...table.physical, comment } })}/></Accordion><Metadata value={table.customProperties} onChange={customProperties => patch({ customProperties })}/><h4>컬럼 <span>{cols.length}</span></h4>{cols.map((c, i) => <ColumnEditor key={c.id} column={c} index={i} count={cols.length} onChange={p => change(updateColumn(doc, c.id, p))} onMove={dir => change(moveColumn(doc, c.id, dir))} onDelete={() => change(removeColumn(doc, c.id))}/>)}<Button onClick={() => change(addColumn(doc, { id: newId(), tableId, scope: 'both', logical: { name: '새 컬럼', definition: '', semanticType: '', required: false }, physical: { name: '', type: { name: 'text', isArray: false }, nullable: true, defaultExpression: null, comment: '' }, customProperties: emptyMeta() }))}>+ 컬럼 추가</Button><h4>키 · PK / UNIQUE</h4>{(doc.keys ?? []).filter(k => k.tableId === tableId).map(k => <KeyEditor key={k.id} item={k} columns={cols} onChange={next => change(upsertKey(doc, next))} onDelete={() => change(removeKey(doc, k.id))}/>)}<Button onClick={() => change(upsertKey(doc, { id: newId(), tableId, scope: 'both', kind: 'unique', name: '', columnIds: [] }))}>+ 키 추가</Button><h4>테이블 관계 <span>{relations.length}</span></h4>{relations.map(r => <RelationEditor key={r.id} document={doc} item={r} onChange={next => change(upsertTableRelation(doc, next))} onDelete={() => change(removeTableRelation(doc, r.id))}/>)}<Button onClick={() => change(upsertTableRelation(doc, { id: newId(), sourceTableId: tableId, targetTableId: tableId, scope: 'logical', logical: { name: '새 관계', cardinality: 'one-to-many', required: false }, physical: null }))}>+ 테이블 관계 추가</Button><Button variant="danger" className="danger" onClick={() => { if (window.confirm('테이블과 소유 컬럼, 키, 관계 및 모든 외부 참조를 삭제할까요?'))
        change(removeTable(doc, tableId)); }}>테이블 삭제</Button></fieldset></section>;
}
function ColumnEditor({ column: c, index, count, onChange, onMove, onDelete }: {
    column: Column;
    index: number;
    count: number;
    onChange: (p: Partial<Column>) => void;
    onMove: (d: number) => void;
    onDelete: () => void;
}) {
    const logical = (p: Partial<Column['logical']>) => onChange({ logical: { ...c.logical, ...p } }), physical = (p: Partial<Column['physical']>) => onChange({ physical: { ...c.physical, ...p } });
    return <Accordion className="table-edit-card" title={<>{index + 1}. {columnName(c)} <small>{c.physical.name}</small></>}><div className="table-actions"><IconButton aria-label={`${columnName(c)} 위로`} disabled={index === 0} onClick={() => onMove(-1)}>↑</IconButton><IconButton aria-label={`${columnName(c)} 아래로`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</IconButton><Button variant="danger" className="danger" onClick={onDelete}>컬럼 삭제</Button></div><Scope value={c.scope} onChange={scope => onChange({ scope })}/><TextField label="논리 컬럼명" value={c.logical.name} max={120} onChange={name => logical({ name })}/><TextField label="의미 타입" value={c.logical.semanticType} max={120} onChange={semanticType => logical({ semanticType })}/><TextField label="컬럼 정의" value={c.logical.definition} onChange={definition => logical({ definition })}/><Check label="논리 필수" value={c.logical.required} onChange={required => logical({ required })}/><TextField label="물리 컬럼명" value={c.physical.name} max={120} onChange={name => physical({ name })}/><label>PostgreSQL 타입<Input list={`postgres-types-${c.id}`} maxLength={120} value={c.physical.type.name} onChange={e => physical({ type: { ...c.physical.type, name: e.target.value } })}/><datalist id={`postgres-types-${c.id}`}>{['uuid', 'integer', 'bigint', 'smallint', 'serial', 'bigserial', 'smallserial', 'boolean', 'text', 'varchar', 'char', 'numeric', 'decimal', 'real', 'double precision', 'date', 'time', 'timetz', 'timestamp', 'timestamptz', 'json', 'jsonb', 'bytea'].map(t => <option key={t} value={t}/>)}</datalist></label><div className="table-type-params">{(['length', 'precision', 'scale'] as const).map(key => <label key={key}>{{ length: '길이', precision: '정밀도', scale: '소수 자릿수' }[key]}<Input type="number" step={1} min={key === 'scale' ? -1000 : key === 'precision' ? 0 : 1} max={key === 'length' ? 10485760 : 1000} value={c.physical.type[key] ?? ''} onChange={e => { const value = e.target.value === '' ? undefined : Number(e.target.value); if (value === undefined || (Number.isInteger(value) && value >= (key === 'scale' ? -1000 : key === 'precision' ? 0 : 1) && value <= (key === 'length' ? 10485760 : 1000)))
        physical({ type: { ...c.physical.type, [key]: value } }); }}/></label>)}</div><Check label="배열 타입" value={c.physical.type.isArray} onChange={isArray => physical({ type: { ...c.physical.type, isArray } })}/><Check label="물리 NULL 허용" value={c.physical.nullable} onChange={nullable => physical({ nullable })}/><TextField label="기본값 SQL 식" value={c.physical.defaultExpression ?? ''} onChange={defaultExpression => physical({ defaultExpression: defaultExpression || null })}/><TextField label="컬럼 주석" value={c.physical.comment} onChange={comment => physical({ comment })}/><Metadata value={c.customProperties} onChange={customProperties => onChange({ customProperties })}/></Accordion>;
}
function KeyEditor({ item: k, columns, onChange, onDelete }: {
    item: TableKey;
    columns: Column[];
    onChange: (k: TableKey) => void;
    onDelete: () => void;
}) {
    return <Accordion className="table-edit-card" open title={<>{k.kind === 'primary' ? '기본 키' : '고유 키'} · {k.name || '이름 없음'}</>}><Scope value={k.scope} onChange={scope => onChange({ ...k, scope })}/><label>키 종류<Select value={k.kind} onChange={e => onChange({ ...k, kind: e.target.value as TableKey['kind'] })}><option value="primary">PRIMARY KEY</option><option value="unique">UNIQUE</option></Select></label><TextField label="키 이름" value={k.name} max={120} onChange={name => onChange({ ...k, name })}/><p>선택한 순서대로 복합 키를 구성합니다.</p>{k.columnIds.map((id, i) => <div className="table-actions" key={`${id}:${i}`}><span>{i + 1}. {columns.find(c => c.id === id) ? columnName(columns.find(c => c.id === id)!) : '삭제된 컬럼'}</span><Button aria-label={`키 컬럼 ${i + 1} 제거`} onClick={() => onChange({ ...k, columnIds: k.columnIds.filter((_, at) => at !== i) })}>제거</Button></div>)}<label>키 컬럼 추가<Select value="" onChange={e => e.target.value && onChange({ ...k, columnIds: [...k.columnIds, e.target.value] })}><option value="">컬럼 선택</option>{columns.filter(c => !k.columnIds.includes(c.id)).map(c => <option key={c.id} value={c.id}>{columnName(c)}</option>)}</Select></label><Button variant="danger" className="danger" onClick={onDelete}>키 삭제</Button></Accordion>;
}
function RelationEditor({ document: doc, item: r, onChange, onDelete }: {
    document: DesignDocument;
    item: TableRelation;
    onChange: (r: TableRelation) => void;
    onDelete: () => void;
}) {
    const physical = r.physical, source = (doc.columns ?? []).filter(c => c.tableId === r.sourceTableId), target = (doc.columns ?? []).filter(c => c.tableId === r.targetTableId);
    return <Accordion className="table-edit-card" title={<>{doc.tables?.find(t => t.id === r.sourceTableId)?.logical.name} → {doc.tables?.find(t => t.id === r.targetTableId)?.logical.name} · {r.logical.name}</>}><Scope value={r.scope} onChange={scope => onChange({ ...r, scope })}/>{(['sourceTableId', 'targetTableId'] as const).map(key => <label key={key}>{key === 'sourceTableId' ? '출발 테이블 (FK 보유)' : '대상 테이블 (참조 키)'}<Select value={r[key]} onChange={e => onChange({ ...r, [key]: e.target.value, physical: physical ? { ...physical, sourceColumnIds: [], targetColumnIds: [] } : null })}>{doc.tables?.map(t => <option key={t.id} value={t.id}>{doc.domains.find(d => d.id === t.domainId)?.name} / {tableName(t)}</option>)}</Select></label>)}<TextField label="논리 관계명" value={r.logical.name} max={120} onChange={name => onChange({ ...r, logical: { ...r.logical, name } })}/><label>논리 카디널리티<Select value={r.logical.cardinality} onChange={e => onChange({ ...r, logical: { ...r.logical, cardinality: e.target.value as TableRelation['logical']['cardinality'] } })}><option value="one-to-one">1 : 1</option><option value="one-to-many">1 : N</option><option value="many-to-many">N : M</option></Select></label><Check label="논리 관계 필수" value={r.logical.required} onChange={required => onChange({ ...r, logical: { ...r.logical, required } })}/><Check label="물리 FK 정의" value={!!physical} onChange={enabled => onChange({ ...r, physical: enabled ? { name: '', sourceColumnIds: [], targetColumnIds: [], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' } : null })}/>{physical && <><TextField label="FK 이름" value={physical.name} max={120} onChange={name => onChange({ ...r, physical: { ...physical, name } })}/><p>출발 컬럼 → 대상 컬럼을 순서대로 연결합니다. 대상 컬럼은 PK 또는 UNIQUE와 일치해야 합니다.</p>{physical.sourceColumnIds.map((id, i) => <div className="table-mapping" key={i}><span>{i + 1}</span>{(['source', 'target'] as const).map(side => <label key={side}>{side === 'source' ? '출발' : '대상'} 컬럼<Select value={side === 'source' ? id : physical.targetColumnIds[i] ?? ''} onChange={e => { if (e.target.value)
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
        path: `M ${ax + 5} ${ay} C ${ax + 80} ${ay}, ${bx - 80} ${by}, ${bx - 8} ${by}`,
        labelX: (ax + bx) / 2, labelY: (ay + by) / 2 - 18,
    };
}
export function TableRelationsSvg({ document: doc, viewId, viewMode, onSelect }: {
    document: DesignDocument;
    viewId: string;
    viewMode: ModelScope;
    onSelect: (id: string) => void;
}) {
    return <>{(doc.tableRelations ?? []).map((relation, index) => {
        const source = doc.tables?.find(table => table.id === relation.sourceTableId);
        const target = doc.tables?.find(table => table.id === relation.targetTableId);
        const a = doc.layout.nodes.find(node => node.objectId === relation.sourceTableId && node.viewId === viewId);
        const b = doc.layout.nodes.find(node => node.objectId === relation.targetTableId && node.viewId === viewId);
        if (!source || !target || !a || !b || !isVisibleInView(relation.scope, viewMode)
            || !isVisibleInView(source.scope, viewMode) || !isVisibleInView(target.scope, viewMode)) return null;
        if (viewMode === 'physical' && !relation.physical) return null;
        const physical = viewMode !== 'logical' && !!relation.physical && relation.scope !== 'logical';
        const cardinality = { 'one-to-one': '1:1', 'one-to-many': '1:N', 'many-to-many': 'N:M' }[relation.logical.cardinality];
        const name = viewMode === 'physical' ? relation.physical?.name || '이름 없는 FK' : relation.logical.name || '이름 없는 관계';
        const fullLabel = `${name} · ${viewMode === 'physical' ? 'FK' : cardinality}${physical && viewMode === 'both' ? ' · FK' : ''}`;
        const label = fullLabel.length > 40 ? `${fullLabel.slice(0, 37)}…` : fullLabel;
        const labelWidth = Math.max(90, [...label].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 14 : 8), 24));
        const geometry = relationGeometry(a, b, labelWidth, index);
        const markerId = `table-fk-arrow-${relation.id}`;
        const stroke = physical ? 'var(--accent)' : 'var(--muted)';
        return <g key={relation.id} className="table-relation-line" role="button" tabIndex={0}
            aria-label={`테이블 관계 ${fullLabel}`}
            onClick={event => { event.stopPropagation(); onSelect(relation.sourceTableId); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(relation.sourceTableId); } }}>
            <title>{fullLabel}</title>
            {physical && <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 Z" fill={stroke}/></marker></defs>}
            <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={18}/>
            <path d={geometry.path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round"
                strokeDasharray={physical ? undefined : '6 4'} markerEnd={physical ? `url(#${markerId})` : undefined}/>
            <rect x={geometry.labelX - labelWidth / 2} y={geometry.labelY - 13} width={labelWidth} height={28}
                rx={9} fill="#fafbfc" stroke="#bdc8d8" strokeWidth={1}/>
            <text x={geometry.labelX} y={geometry.labelY + 5} textAnchor="middle">{label}</text>
        </g>;
    })}</>;
}


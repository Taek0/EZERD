import type { Column, DesignDocument } from '@ezerd/model';
import { columnTypeDisplay } from '../tables/column-type-display.js';

export type HistoryChange = {
  path: string;
  before: unknown;
  after: unknown;
  beforeExists?: boolean | undefined;
  afterExists?: boolean | undefined;
};
type History = readonly { changes: readonly HistoryChange[] }[];
type Item = Record<string, unknown>;
const collections: Record<string, string> = {
  domains: '도메인',
  tables: '테이블',
  columns: '컬럼',
  keys: '키',
  tableRelations: '테이블 관계',
  domainRelations: '도메인 관계',
  enums: 'ENUM',
  notes: '메모',
  views: '도메인 뷰',
  nodes: '카드',
  relations: '관계선',
};
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const object = (value: unknown): Item =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Item) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const parts = (path: string) => {
  const all = path
    .split('/')
    .filter(Boolean)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  return all[0] === 'layout' ? all.slice(1) : all;
};
export function historyMessage(text: string): string {
  return text
    .replace(
      /\/(?:layout|domains|domainRelations|tables|columns|keys|tableRelations|enums|notes|views)\/[^\s,;]+/g,
      '변경 항목',
    )
    .replace(uuid, '[식별자]');
}
const text = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const safe = historyMessage(value).replace(/\s+/g, ' ').trim();
  return safe.length > 160 ? safe.slice(0, 157) + '…' : safe;
};
const name = (value: Item) =>
  text(object(value.physical).name) || text(value.name) || text(object(value.logical).name);
const deleting = (change: HistoryChange, p: string[]) =>
  p.length === 2 &&
  (change.afterExists === false || (change.after === null && change.before !== null));
const adding = (change: HistoryChange, p: string[]) =>
  p.length === 2 &&
  (change.beforeExists === false || (change.before === null && change.after !== null));

function context(document: DesignDocument, history: History, changes: readonly HistoryChange[]) {
  const items = new Map<string, Item>();
  const put = (collection: string, id: string, value: unknown) => {
    const record = object(value);
    if (Object.keys(record).length)
      items.set(collection + '/' + id, { ...items.get(collection + '/' + id), ...record });
  };
  const remember = (change: HistoryChange) => {
    const p = parts(change.path),
      collection = p[0],
      id = p[1];
    if (!collection || !id || !collections[collection] || id === '@move') return;
    if (p.length === 2) {
      put(collection, id, change.before);
      put(collection, id, change.after);
      return;
    }
    const field = p.slice(2).join('.');
    const value = change.afterExists === false ? change.before : change.after;
    if (
      [
        'name',
        'tableId',
        'domainId',
        'objectId',
        'relationId',
        'sourceTableId',
        'targetTableId',
        'sourceDomainId',
        'targetDomainId',
      ].includes(field)
    )
      put(collection, id, { [field]: value });
    if (field === 'physical.name' || field === 'logical.name') {
      const key = field.split('.')[0]!;
      const old = items.get(collection + '/' + id) ?? {};
      put(collection, id, { [key]: { ...object(old[key]), name: value } });
    }
  };
  for (const entry of history) for (const change of entry.changes) remember(change);
  for (const collection of Object.keys(collections)) {
    const values =
      collection === 'nodes'
        ? document?.layout?.nodes
        : collection === 'relations'
          ? document?.layout?.relations
          : (document as unknown as Item)?.[collection];
    if (Array.isArray(values))
      for (const value of values) {
        const record = object(value),
          id =
            typeof record.id === 'string'
              ? record.id
              : collection === 'relations'
                ? String(record.viewId) + ':' + String(record.relationId)
                : '';
        if (id) put(collection, id, record);
      }
  }
  for (const change of changes) remember(change);
  const record = (collection: string, id: string) => items.get(collection + '/' + id) ?? {};
  const lookupName = (collection: string, id: unknown): string =>
    typeof id === 'string' ? name(record(collection, id)) : '';
  const nodeOwner = (id: string, value: Item) => {
    let objectId = typeof value.objectId === 'string' ? value.objectId : '';
    if (!objectId)
      for (const key of items.keys()) {
        const [collection, ...rest] = key.split('/');
        if (!['tables', 'domains', 'notes'].includes(collection!)) continue;
        const candidate = rest.join('/');
        if (id === 'node:' + candidate || id.startsWith('node:' + candidate + ':')) {
          objectId = candidate;
          break;
        }
      }
    for (const collection of ['tables', 'domains', 'notes'])
      if (items.has(collection + '/' + objectId)) return { collection, id: objectId };
    return { collection: 'nodes', id };
  };
  const label = (collection: string, id: string, override?: Item): string => {
    const value = override ?? record(collection, id);
    let kind = collections[collection] ?? '항목',
      title = name(value);
    if (collection === 'columns') {
      const parent = lookupName('tables', value.tableId);
      if (parent && title) title = parent + '.' + title;
    }
    if (collection === 'keys') {
      const parent = lookupName('tables', value.tableId);
      title = [
        parent,
        title || (value.kind === 'primary' ? 'PK' : value.kind === 'unique' ? 'UNIQUE' : ''),
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (collection === 'tableRelations') {
      const pk = lookupName('tables', value.targetTableId),
        fk = lookupName('tables', value.sourceTableId);
      title = pk && fk ? pk + ' → ' + fk : title;
    }
    if (collection === 'domainRelations') {
      const from = lookupName('domains', value.sourceDomainId),
        to = lookupName('domains', value.targetDomainId);
      title = from && to ? from + ' → ' + to : title;
    }
    if (collection === 'nodes') {
      const owner = nodeOwner(id, value);
      if (owner.collection !== 'nodes') return label(owner.collection, owner.id);
    }
    if (collection === 'relations') {
      let relationId = typeof value.relationId === 'string' ? value.relationId : '';
      if (!relationId)
        for (const key of items.keys())
          if (
            key.startsWith('tableRelations/') &&
            id.endsWith(':' + key.slice('tableRelations/'.length))
          )
            relationId = key.slice('tableRelations/'.length);
      const relation = record('tableRelations', relationId);
      const pk = lookupName('tables', relation.targetTableId),
        fk = lookupName('tables', relation.sourceTableId);
      title = pk && fk ? pk + ' → ' + fk : '';
    }
    if (collection === 'notes')
      title = text(value.text).slice(0, 32) + (text(value.text).length > 32 ? '…' : '') || title;
    return kind + (title ? ' ‘' + title + '’' : '');
  };
  const valueLabel = (value: unknown, field: string): string => {
    if (value === null || value === undefined || value === '') return '없음';
    if (field === 'physical.type') {
      const type = object(value);
      if (typeof type.name === 'string') {
        const enums = [...items]
          .filter(([key]) => key.startsWith('enums/'))
          .map(([, item]) => item) as unknown as DesignDocument['enums'];
        return text(columnTypeDisplay(type as Column['physical']['type'], enums));
      }
      return '타입 설정';
    }
    if (field.endsWith('columnIds') || field.endsWith('ColumnIds'))
      return (
        strings(value)
          .map((id) => lookupName('columns', id) || '컬럼')
          .join(', ') || '없음'
      );
    if (field.endsWith('DomainId')) return lookupName('domains', value) || '도메인';
    if (field.endsWith('TableId') || field === 'tableId')
      return lookupName('tables', value) || '테이블';
    if (field === 'enumId') return lookupName('enums', value) || 'ENUM';
    if (typeof value === 'boolean') return value ? '허용' : '허용 안함';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value))
      return field === 'values'
        ? text(
            strings(value)
              .map((v) => v || '빈 문자열')
              .join(', '),
          )
        : value.length + '개 항목';
    const v = object(value);
    if (v.min !== undefined && v.max !== undefined)
      return String(v.min) + '..' + (v.max === 'many' ? 'N' : String(v.max));
    return '설정';
  };
  return { record, label, nodeOwner, valueLabel };
}
const fields: Record<string, string> = {
  name: '이름',
  description: '업무 설명',
  color: '색상',
  'physical.name': '이름',
  'logical.name': '이름',
  'physical.type': '타입',
  'physical.nullable': 'NULL 허용',
  'physical.comment': 'comment',
  'physical.defaultExpression': '기본값',
  physical: '참조 설정',
  'logical.description': '설명',
  'logical.cardinality': '관계 형태',
  'logical.sourceCardinality': 'FK 끝점',
  'logical.targetCardinality': 'PK 끝점',
  'logical.required': '필수 여부',
  columnIds: '키 컬럼',
  kind: '키 종류',
  values: '값 목록',
  schema: '스키마',
  domainIds: '도메인 선택',
  direction: '방향',
  text: '내용',
  'canvasDisplay.showNullable': 'NULL 표시',
  'canvasDisplay.showComment': 'comment 표시',
  sourceDomainId: '출발 도메인',
  targetDomainId: '참조 도메인',
  sourceTableId: 'FK 테이블',
  targetTableId: 'PK 테이블',
};

export function describeChanges(
  changes: readonly HistoryChange[],
  document: DesignDocument,
  history: History = [],
): string[] {
  const ctx = context(document, history, changes);
  const rootChanges = new Set(
    changes.flatMap((change) => {
      const p = parts(change.path);
      return p.length === 2 &&
        !['nodes', 'relations'].includes(p[0]!) &&
        (adding(change, p) || deleting(change, p))
        ? [p[0] + '/' + p[1]]
        : [];
    }),
  );
  const result = changes.flatMap((change) => {
    const p = parts(change.path),
      collection = p[0] ?? '',
      id = p[1] ?? '',
      field = p.slice(2).join('.');
    if (p[1] === '@move') {
      const moved = p[2] ?? '',
        item = ctx.record(collection, moved);
      return [
        collection === 'columns'
          ? ctx.label('tables', String(item.tableId ?? '')) + ' 컬럼 순서 변경'
          : (collections[collection] ?? '항목') + ' 순서 변경',
      ];
    }
    if (collection === 'nodes' && p.length === 2) {
      const owner = ctx.nodeOwner(id, ctx.record(collection, id));
      if (rootChanges.has(owner.collection + '/' + owner.id)) return [];
    }
    const caption = ctx.label(collection, id);
    if (deleting(change, p))
      return [caption + (collection === 'nodes' ? ' 보기에서 제거' : ' 삭제')];
    if (adding(change, p)) return [caption + (collection === 'nodes' ? ' 보기 추가' : ' 추가')];
    if (collection === 'nodes' && field === 'position') return [caption + ' 이동'];
    if (collection === 'nodes' && field === 'size') return [caption + ' 크기 변경'];
    if (collection === 'relations') return [caption + ' 경로 변경'];
    const fieldLabel =
      fields[field] ??
      (field.startsWith('physical.type.')
        ? '타입 설정'
        : field.startsWith('customProperties')
          ? '추가 정보'
          : '설정');
    const before = ctx.valueLabel(change.before, field),
      after = ctx.valueLabel(change.after, field);
    if (
      [
        'text',
        'description',
        'logical.description',
        'physical.comment',
        'logical.definition',
      ].includes(field) &&
      (String(change.before ?? '').length > 80 || String(change.after ?? '').length > 80)
    ) {
      return [
        caption +
          ' ' +
          fieldLabel +
          ' 변경 (' +
          Array.from(String(change.before ?? '')).length +
          '자 → ' +
          Array.from(String(change.after ?? '')).length +
          '자)',
      ];
    }
    const showValues = before !== '설정' && after !== '설정' && fieldLabel !== '설정';
    return [
      caption + ' ' + fieldLabel + ' 변경' + (showValues ? ': ' + before + ' → ' + after : ''),
    ];
  });
  return [...new Set(result.length ? result : ['보드 변경'])];
}

export function describeDeletedValues(
  change: HistoryChange,
  document: DesignDocument,
  history: History = [],
): string[] {
  const ctx = context(document, history, [change]),
    p = parts(change.path),
    value = object(change.before),
    physical = object(value.physical);
  const lines = [ctx.label(p[0] ?? '', p[1] ?? '', value)];
  const description =
    text(value.description) || text(value.text) || text(object(value.logical).definition);
  if (description) lines.push('설명: ' + description);
  if (physical.type) lines.push('타입: ' + ctx.valueLabel(physical.type, 'physical.type'));
  if (typeof physical.nullable === 'boolean')
    lines.push('NULL: ' + (physical.nullable ? '허용' : '허용 안함'));
  if (text(physical.comment)) lines.push('comment: ' + text(physical.comment));
  if (Array.isArray(value.values)) lines.push('값: ' + ctx.valueLabel(value.values, 'values'));
  if (Array.isArray(value.columnIds))
    lines.push('컬럼: ' + ctx.valueLabel(value.columnIds, 'columnIds'));
  return lines;
}

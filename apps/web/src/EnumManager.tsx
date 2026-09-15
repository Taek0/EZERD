import { useState } from 'react';
import { type DesignDocument, removeEnum, upsertEnum } from '@ezerd/model';
import { Button, Input, Textarea } from './components/ui/index.js';
import { newId } from './client.js';
import './enum-manager.css';
export function EnumManager({
  document: doc,
  onChange,
  readOnly,
}: {
  document: DesignDocument;
  onChange: (d: DesignDocument) => void;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [schema, setSchema] = useState('public'),
    [values, setValues] = useState(''),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  const items = (doc.enums ?? []).filter((item) =>
    (item.schema + '.' + item.name + ' ' + item.values.join(' '))
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const reset = () => {
    setEditing(null);
    setName('');
    setSchema('public');
    setValues('');
    setError('');
  };
  return (
    <div className="table-enum-manager">
      <p>프로젝트의 테이블에서 사용하는 ENUM 값 목록입니다.</p>
      <Input
        aria-label="ENUM 검색"
        placeholder="이름 또는 값으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <small>
        {items.length} / {(doc.enums ?? []).length}개
      </small>
      <div className="table-enum-list">
        {items.map((item) => (
          <details className="table-enum-item" key={item.id}>
            <summary>
              <strong>{item.name}</strong>
              <small>
                {item.values.length}개 값 ·{' '}
                {item.values
                  .slice(0, 3)
                  .map((value) => value || '빈 문자열')
                  .join(' · ')}
                {item.values.length > 3 ? ' …' : ''}
              </small>
            </summary>
            <div className="table-enum-values">
              {item.values.map((value, index) => (
                <span key={index}>{value || '빈 문자열'}</span>
              ))}
            </div>
            <div className="table-actions">
              <Button
                disabled={readOnly}
                onClick={() => {
                  setEditing(item.id);
                  setName(item.name);
                  setSchema(item.schema);
                  setValues(item.values.join('\n'));
                  setError('');
                }}
              >
                편집
              </Button>
              <Button
                disabled={readOnly}
                variant="danger"
                onClick={() => {
                  try {
                    onChange(removeEnum(doc, item.id));
                    if (editing === item.id) reset();
                    setError('');
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : '사용 중인 ENUM은 삭제할 수 없습니다.',
                    );
                  }
                }}
              >
                삭제
              </Button>
            </div>
          </details>
        ))}
        {!items.length && (
          <p className="panel-note">{query ? '검색 결과가 없습니다.' : '아직 ENUM이 없습니다.'}</p>
        )}
      </div>
      <fieldset disabled={readOnly} className="table-enum-form">
        <label>
          ENUM 이름
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          ENUM 값 (한 줄에 하나, 빈 줄은 빈 문자열)
          <Textarea value={values} onChange={(e) => setValues(e.target.value)} />
        </label>
        <Button
          disabled={!name.trim() || !schema.trim()}
          onClick={() => {
            try {
              onChange(
                upsertEnum(doc, {
                  id: editing ?? newId(),
                  name: name.trim(),
                  schema: schema.trim(),
                  values: values.split('\n'),
                }),
              );
              reset();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'ENUM을 확인하세요.');
            }
          }}
        >
          {editing ? 'ENUM 변경 적용' : 'ENUM 생성'}
        </Button>
        {editing && <Button onClick={reset}>편집 취소</Button>}
      </fieldset>
      {error && (
        <p role="alert" className="table-error">
          {error}
        </p>
      )}
    </div>
  );
}

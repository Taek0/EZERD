import { translate, useI18n } from '../../shared/i18n/index.js';
import './translations.js';
import { useState } from 'react';
import { type DesignDocument, removeEnum, upsertEnum } from '@ezerd/model';
import { AnimatedDetails, Button, Input, Textarea } from '../../components/ui/index.js';
import { newId } from '../../shared/api/client.js';
import './enum-manager.css';
export function EnumManager({
  document: doc,
  onChange,
  readOnly,
  allowCreate = true,
}: {
  document: DesignDocument;
  onChange: (d: DesignDocument) => void;
  readOnly: boolean;
  allowCreate?: boolean;
}) {
  useI18n();
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
      <p>{translate('프로젝트의 테이블에서 사용하는 ENUM 값 목록입니다.')}</p>
      <Input
        aria-label={translate('ENUM 검색')}
        placeholder={translate('이름 또는 값으로 검색')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <small>
        {translate('{shown} / {total}개', { shown: items.length, total: (doc.enums ?? []).length })}
      </small>
      <div className="table-enum-list">
        {items.map((item) => (
          <AnimatedDetails className="table-enum-item" key={item.id}>
            <summary>
              <strong>{item.name}</strong>
              <small>
                {translate('{count}개 값 ·', { count: item.values.length })}{' '}
                {item.values
                  .slice(0, 3)
                  .map((value) => value || translate('빈 문자열'))
                  .join(' · ')}
                {item.values.length > 3 ? ' …' : ''}
              </small>
            </summary>
            <div className="table-enum-values">
              {item.values.map((value, index) => (
                <span key={index}>{value || translate('빈 문자열')}</span>
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
                {translate('편집')}
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
                      e instanceof Error
                        ? e.message
                        : translate('사용 중인 ENUM은 삭제할 수 없습니다.'),
                    );
                  }
                }}
              >
                {translate('삭제')}
              </Button>
            </div>
          </AnimatedDetails>
        ))}
        {!items.length && (
          <p className="panel-note">
            {query ? translate('검색 결과가 없습니다.') : translate('아직 ENUM이 없습니다.')}
          </p>
        )}
      </div>
      {(editing || allowCreate) && (
        <fieldset key={editing ?? 'new'} disabled={readOnly} className="table-enum-form">
          <label>
            {translate('ENUM 이름')}
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            {translate('ENUM 값 (한 줄에 하나, 빈 줄은 빈 문자열)')}
            <Textarea value={values} onChange={(e) => setValues(e.target.value)} />
          </label>
          <Button
            disabled={!name.trim() || !schema.trim()}
            onClick={() => {
              if (readOnly || (!editing && !allowCreate)) return;
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
                setError(e instanceof Error ? e.message : translate('ENUM을 확인하세요.'));
              }
            }}
          >
            {editing ? translate('ENUM 변경 적용') : translate('ENUM 생성')}
          </Button>
          {editing && <Button onClick={reset}>{translate('편집 취소')}</Button>}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="table-error">
          {translate(error)}
        </p>
      )}
    </div>
  );
}

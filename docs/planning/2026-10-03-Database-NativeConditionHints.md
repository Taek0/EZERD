# Native key 및 typed literal 조건 안내 가독성

2026-10-03. [PG 대표 브라우저 QA](../work-log/2026-10-03-Database-PostgresNativeBrowserQA.md)에서 키 후보의 내부 조건 코드가 노출된 후속 UI 단위다.

- `NativeOrderedColumns`의 조건 목록을 기존 `nativeEditorConditionText`로 변환한다. `enum.definition-required`, `table.mode-validation-required`, InnoDB 단일/복합 byte limit, PG B-tree entry limit, SQLite NULL/rowid 의미의 여섯 조건을 한국어/영어 안내로 등록한다.
- 새 PostgreSQL bounded typed literal helper가 실제 반환하는 search/multirange/array/snapshot 제한 코드와 XML/jsonpath가 공유하는 형식·문법·길이 진단만 동일 안내 패턴에 추가한다. 문구는 현재 검증 범위와 원문 보존을 설명하며 engine/parser 지원을 확대하지 않는다.
- 실제 정책을 소비한 정적 React markup에서 원시 코드가 안 보이고 정상 선택과 기존 미지원 선택이 유지되는지 검증한다. typed default의 거부 draft도 실제 렌더링으로 확인한다. coverage/current/previous를 위조하지 않는다.
- 생산 engine/model/policy/readiness는 읽기만 한다. UI helper/component/tests 및 계획/결과 문서만 수정한다. targeted tests/Prettier/web typecheck 후 독립 커밋한다. 부모의 브라우저/전체 check와 Singer QA는 건드리지 않으며 Git index에 타 작업이 있으면 커밋 충돌을 피한다. docs/EZERD.txt는 수정하지 않는다.

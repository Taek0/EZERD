# v1 DB 타입 UI·native 기능 경계 감사 결과

- 작성일: 2026-10-02
- 계획: [LegacyUIAudit](../planning/2026-10-02-Database-LegacyUIAudit.md).
- read-only 감사 완료. 제품 코드·v1 API/MCP·서버/model 정책을 수정하지 않았다. 새 peer chat/git add/commit 및 전체 build/check/format은 수행하지 않았다.

## 확인된 경계

1. explicit formatVersion1 MySQL/SQLite도 기존 Canvas/TableEditor로 열린다. root App의 opened.project에는 databaseKind/databaseRevision이 있고 서버 v1 project metadata에도 profile ID가 있지만, Canvas props에는 DB 문맥이 없다. root의 로컬 Project 타입은 profile ID를 선언하지 않는다. TableNodeContent/TableInspector/ColumnCreationForm/ColumnDefaultControl/EnumDialog도 DB 문맥을 받지 않는다. 현재 v1 type picker는 프로젝트에 따라 달라질 수 없다.
2. `column-type-options.ts:15`는 postgresTypeNames 전체와 현재 unknown type 및 project ENUM을 합친다. inline 카드(`TableEditor.tsx:527`), 상세 컬럼(`:1162`), 새 컬럼(`:1683`) 세 진입점 모두 같은 함수다. UUID/JSONB/BYTEA/TIMETZ/TIMESTAMPTZ/serial 등의 PG 선택지가 MySQL/SQLite 표시 프로젝트에도 그대로 나온다.
3. 타입 파라미터도 canonicalPostgresTypeName과 PG 범위로 결정된다. array 체크박스, 프로젝트 ENUM, 기본값 now()/gen_random_uuid(), 자동 증가의 serial type 변경, 새 table의 schema public도 기존 PG 표현이다. type picker 한 군데만 변경하면 나머지 경계가 계속 PG 기준이다. native unsigned/inline ENUM/SET/generated/DB별 table options/index/check 구조는 v1 schema에 없다.
4. C3의 native 후보 validateDatabaseDocument/legacy origin 정책은 v2 경로에 적용된다. v1 SyncService는 잠근 행의 schemaVersion1·DB revision·baseline/claims/retired IDs·구조 검사를 유지하며 normalizeServerDocument와 designDocumentSchema를 소비한다. v1 MCP apply_project_changes도 v1 schema/동기화 경로를 사용한다. 현재 v1을 native DB 정책으로 검사하는 호출은 확인되지 않았다. 따라서 v1 UI 수정을 이유로 서버 원본 호환 정책을 바꿀 필요가 없다.
5. capabilities API는 기존 v1 프로젝트에서도 조회 가능하지만 `capabilityScope: native-v2`, `documentSchemaVersion: 1`이며 type/feature usable은 모두 false다. native catalog를 legacy picker로 바로 넣거나 usable=false를 이유로 전체 기존 편집을 잠그면 안 된다. MySQL SQL 이름 int를 v1에 넣어도 PG canonicalizer가 integer로 정규화하며, non-PG v1→native upgrade는 알려진 이름도 원문 legacy로 보존한다. 이름이 같다는 이유로 native DB 의미를 부여하면 안 된다.
6. root `App.tsx:1223`에는 이미 NativeUpgradeButton이 실제 연결돼 있다. actor/project 고정·autosave/pending 준비 및 명시 review/apply/reload 경로를 재사용할 수 있다. DB 전용 새 기능 버튼의 callback은 이 기존 CTA를 열거나 focus하는 UI 경로로 연결하고 임의 업그레이드 POST/자동 전환을 만들지 않아야 한다.
7. 기존 old clipboard는 `ezerd/tables-v1` 및 schemaVersion1만 읽는다. native clipboard를 v1에 투영하는 경로는 발견되지 않았다. 이번 타입 경계 수정에 domain CRUD/clipboard serialization 변경은 필요하지 않다.

## 보존해야 할 기존 동작

- unknown/user-defined 타입 현재 값, 기존 ENUM ID/name/값, array/파라미터, 알 수 없는 defaultExpression은 삭제·자동 변환하지 않는다.
- 현재 type 옵션 생성과 표시 함수는 unknown 원문을 유지하고 caller 값을 수정하지 않는다. 알려진 PG alias canonicalization은 기존 v1 계약이며 DB native 매핑으로 바꾸지 않는다.
- 기존 기본값은 후보에 없으면 disabled current option으로 표시된다. 타입을 명시 변경하면 defaultExpression을 초기화하는 기존 동작은 그대로다. 수정하지 않은 raw default/타입은 계속 보존한다.
- v1 호환 타입의 수정·복구와 native DB별 신규 기능 진입을 구분한다. 기존 데이터를 고치는 편집까지 통째로 readonly로 만들거나 신규 native payload를 v1 physical.type.name에 넣으면 안 된다.

## 권장 작은 UI 수정 범위

첫 단위는 UI 경계만 명시한다. non-PG v1의 기본 타입 UI는 현재 저장된 값을 표시하고 DB 전용 신규 선택은 nativeUpgradeCTA로 안내한다. 기존 v1 표현을 수정하는 경로는 별도로 명시하여 현재 raw/타입 수정 능력을 유지한다. 기존 PG 메뉴를 MySQL/SQLite native 후보처럼 노출하지 않는다. 호환 후보를 추가 제한하려면 기존 표현 복구에 필요한 후보/파라미터/default를 별도 정책으로 정하고 테스트해야 하며 native catalog의 usable 판정을 v1에 재사용하지 않는다.

- 신규 `legacy-database-editor-policy.ts/test`, `LegacyDatabaseEditorNotice.tsx/test`: v1/native 경계·현재 값 보존·DB 문맥 없는 이전 호출 호환·readonly·upgrade CTA 정책/표시를 독립시킬 수 있다.
- `TableEditor.tsx`, `column-type-options.ts/test`, `column-defaults.ts/test`: inline/detail/create 세 경로와 default/array/parameter/ENUM 안내에 optional DB 문맥 및 CTA를 전달한다. 새 native serializer/type 입력은 추가하지 않는다. EnumManager 내부 동작을 바꾸지 않고 EnumDialog wrapper에서 안내를 소비할 수 있다.
- `Canvas.tsx`: optional databaseKind 및 onRequestNativeUpgrade를 table/ENUM UI에 전달하는 작은 props hunk가 필요하다. domain/clipboard 구현은 건드리지 않는다.
- `App.tsx`: main이 opened.project.databaseKind를 전달하고 기존 NativeUpgradeButton의 명시 진입을 연결해야 한다. 이 파일은 직접 수정하지 않는다. profile/revision fetch를 추가하는 큰 root 변경 없이 현재 metadata로 경계 표시를 먼저 할 수 있다.
- server/contracts/model/index/NativeProjectView 및 native editor는 수정할 필요가 없다. 후속 테스트는 non-PG v1의 기본 후보 노출, 기존 unknown/ENUM/array/default/alias 원문과 repair 동작, CTA 전달·readonly, PG v1 기존 동작을 검증해야 한다.

## 충돌·검증 상태

- 감사 시점 `git status --short -- App.tsx Canvas.tsx features/tables features/domains NativeUpgradeButton.tsx`는 변경 없음이었다. 관련 v1 type/default/EnumManager/domain/old clipboard 파일도 현재 dirty 상태가 아니다. App은 main 소유이고 Canvas는 domain/clipboard를 함께 포함한 큰 파일이므로 실제 착수 전에 재확인해야 한다.
- 현재 dirty인 NativeERDCanvas/private PNG/CAS 및 native editor/activation 파일은 별도 단위다. 이번 감사에서 건드리지 않았다.
- 기존 targeted **55개 통과**: column-type-options, column-defaults, TableEditor 세 테스트 파일. alias/unknown/enum/current default 보존과 기존 UI 회귀를 확인했다. root 기본 Vitest 설정/기존 shared dist를 사용했고 새 테스트/fixture 또는 coverage 조작은 없다.
- 브라우저/MySQL·SQLite 실환경 생성→picker 메뉴, 실제 v1 HTTP/MCP 저장은 이번 감사에서 새로 수행하지 않았다. 메뉴 경계 문제는 코드 경로와 기존 단위 테스트 기준으로 확인했다. 제품 수정은 아직 구현하지 않았으며 본 문서의 범위는 후속 작업 후보다.

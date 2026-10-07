# Native 제약조건·MCP 조회 제한 검토 결과

## 코드 확인

- `postgresql:btrim`은 model의 nativeBuiltinFunctionIds에 없으며 계약 스키마도 이 목록을 사용한다. 표현식 정책의 함수 분기에도 없다.
- projectEnum 컬럼은 enum family, 문자열 리터럴은 string family로 추론된다. 비교는 family와 enumId 일치를 요구하므로 CHECK와 인덱스 predicate 모두 comparison-type-mismatch로 거부된다.
- 실제 서버 schema.ts에는 보고된 세 제약이 SQL 형태로 정의되어 있다. 보고된 제한은 Native 모델 표현 범위와 검증 정책의 한계에 부합한다.
- get_project_view와 list_view_relations는 projectState → WorkspaceService.getProjectState → normalizeServerDocument → requireLegacyServerDocument 경로다. schemaVersion 2이면 화면 ID 검사 이전에 document.client-upgrade-required가 발생한다. 도구 설명도 v1 전용으로 명시되어 있다.

## 권장 보완

- ENUM 문자열 비교는 enum 값의 명시적 타입 표현 또는 문맥 기반 검증을 추가한다. 임의 문자열 컬럼과 ENUM 간 비교를 통째로 허용하지 않는다. enumId와 레이블 유효성, DDL 출력까지 함께 검증한다.
- btrim은 함수 목록·인자 및 반환 타입 검증·DDL과 실제 PostgreSQL 실행 테스트를 함께 보완한다.
- MCP 화면·관계 조회에 v2 응답 경로를 추가하거나 별도 native 조회 도구를 제공한다. 기존 경로의 오류도 도구 미지원과 대안 조회 방법을 명시하도록 개선한다.
- 메타데이터 SQL은 원문 보존이지 CHECK·UNIQUE 적용이나 자동 DDL 생성의 대체가 아니다. accepted는 실제 제출된 수정의 수락이며 제외한 제약까지 구현됐다는 의미가 아니다.

## 검증 범위

- 코드 정적 검토만 수행했다. 보고 당시 MCP 요청·응답이나 실제 프로젝트 메타데이터는 재조회하지 않았으며, 제품 코드와 프로젝트 데이터는 변경하지 않았다.

# Native 제한 식 의미 검증 결과

- [계획](../planning/2026-10-02-Database-NativeExpressionPolicy.md)에 따라 물리 컬럼의 타입/소유자·함수 인자·연산자·결과/NULL 특성을 공통 모델에서 검사한다. CHECK/partial predicate는 boolean, default/generated는 대상 타입에 맞는 결과를 요구하며 default의 컬럼 참조와 volatile generated/index 함수, 목표 타입 없는 typedText, 명시 0 나누기를 차단한다.
- lower/upper/length/abs/coalesce 및 현재 clock/UUID 함수와 제한 연산자를 검사한다. coalesce는 숫자 승격을 보존하고 PG float modulo를 잘못 허용하지 않는다. SQLite general affinity와 STRICT TEXT/ANY의 실제 저장형 차이를 분리한다. 임의 SQL/cast나 string↔numeric coercion을 추정하지 않는다.
- PG18 virtual generated는 프로젝트 ENUM 타입/입력 참조를 차단하고 stored는 구분한다. [공식 generated 규칙](https://www.postgresql.org/docs/18/ddl-generated-columns.html)을 확인하고 실제 PostgreSQL18.6에서 stored ENUM 참조 성공/virtual 참조 거부를 검증했다.
- validator와 builtin/default/generation 공통 API 및 UI adapter를 연결했다. engine allowed와 product usable(false)를 유지한다. 새 문제는 식·관련 물리 타입·nullable·table mode를 원인으로 검사하며 unrelated 설명 수정이나 과거 정상화 원문을 new previous로 만들지 않는다.
- model/default/validator/DDL/UI 정책 260개 통과, shared build/server typecheck 통과. 실제 격리 PG에서 ABS default·숫자 generated·CHECK 값 거부·partial lower index를 실행하고 잘못된 CHECK 결과/함수 인자를 DB 거부와 대조했다. SQLite 기존 실행 fixture와 MySQL8.4.11 37개 선언/고급 default·generated·check·FK·index 조합도 변경 후 통과했다. MySQL 임시 DB 및 PG schema/트랜잭션은 정리했다.
- 한계: 특수 타입 연산, explicit cast 및 전체 SQL 문법은 미지원이며 식 가족이 정해지지 않는 조합을 unsupported로 진단한다. 저장 데이터 값에 따른 모든 연산 overflow나 constraint 실패를 사전 계산한다고 주장하지 않는다. 인덱스별 기본 opclass 조건과 전체 expression tree 편집/clipboard 소비/활성화 QA는 후속 단위다.

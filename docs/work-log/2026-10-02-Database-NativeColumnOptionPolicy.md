# Native 기본 함수·자동 생성 옵션 공통 정책 결과

- [계획](../planning/2026-10-02-Database-NativeColumnOptionPolicy.md)에 따라 `nativeBuiltinDefaultDecision`, `nativeOnUpdateDecision`, `nativeGenerationDecision` 공개 API와 서버·sync·MCP·DDL가 사용하는 공통 validator 연결을 추가했다. allowed와 제품 usable(false)를 분리한다.
- PG identity의 smallint/int/bigint 폭·64bit 증분·0 금지·상승/하강 기본 경계·start/min/max·cache를 원문 문자열로 검사한다. cycle 및 큰 수를 JS number로 변환하지 않는다. generation/default 및 nullable/array/key 문맥 규칙을 같은 feature 정책에 연결한다.
- PG 시간·UUID, MySQL 시간·길이 36 이상의 UUID 문자열, SQLite 시간 함수의 제한 zero-argument 입력을 타입과 생성 조건으로 판정한다. SQLite 일반 모드의 사용자 선언/생략 타입과 STRICT TEXT/ANY를 구분한다. MySQL ON UPDATE는 plain TIMESTAMP/DATETIME CURRENT_TIMESTAMP만 허용한다. DDL은 기존처럼 컬럼 precision을 함수에도 사용한다.
- model/validator/DDL 200개 테스트 및 model build/server typecheck 통과. 실제 격리 PostgreSQL에서 세 정수 타입 ascending/descending/cycle·BigInt 경계·ALWAYS 직접 입력 거부·UUID/clock defaults를 rollback 검증했다. SQLite 3.53.1 메모리 DB에서 general/custom/STRICT TEXT/ANY의 clock text 값을 확인했다.
- 작업 전용 MySQL8.4.11 임시 DB로 37개 선언 및 기존 advanced 조합을 재검증하고 UUID default·TIMESTAMP(6) ON UPDATE·computed 값 갱신을 추가 확인했다. 별도 sleep 없이 timestamp를 과거 값으로 명시한 뒤 다른 컬럼 갱신에 따라 변경되는 동작을 검사했으며 임시 DB는 finally에서 삭제했다.
- [PG sequence](https://www.postgresql.org/docs/18/sql-createsequence.html), [MySQL timestamp](https://dev.mysql.com/doc/refman/8.4/en/timestamp-initialization.html), [SQLite defaults](https://www.sqlite.org/lang_createtable.html)를 확인했다. 제품 cache 상한 2,147,483,647 및 제한 함수 목록은 전체 엔진 지원 범위를 주장하지 않는다.
- UI 소비는 병렬 단위에서 연결한다. complex AST 결과 타입 inference·computed 식 정책·special type literal/환경 옵션은 다음 C7/C6 단위이며 이번 단위에서 readiness/coverage를 올리지 않았다.

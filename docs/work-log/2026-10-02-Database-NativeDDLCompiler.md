# C5 native DDL 방언 컴파일러와 실제 실행

- 계획: [NativeDDLCompiler](../planning/2026-10-02-Database-NativeDDLCompiler.md), 시작 `0edbd16`.
- 프로젝트 전체 물리 테이블/컬럼/키/FK/ENUM/index/CHECK를 수집하는 PG18/MySQL8.4/SQLite 방언 컴파일러를 추가했다. 화면/도메인/참조 노드로 제한하지 않는다. 오류 시 `sql=''`이며 제품용 export는 기존 readiness/coverage 검사까지 통과해야 한다.
- DB별 식별자·UTF-8 리터럴·타입 파라미터·배열·serial/identity/autoIncrement/computed·default/ON UPDATE·스키마·인덱스·comment를 직렬화한다. PG/MySQL FK는 테이블과 인덱스 뒤 ALTER, SQLite는 CREATE TABLE 내부에 적용한다. MySQL computed 참조 컬럼은 앞에 배치하며 문서의 원래 컬럼 순서는 변경하지 않는다.
- PG schema 내 테이블/명시 index/키 backing index 및 동일 테이블 제약 이름 충돌을 차단한다. SQLite 임의 declared 타입은 이름 전체를 인용해 `INT PRIMARY KEY` 등의 단어가 제약으로 해석되지 않도록 했다.
- MySQL SQL은 UTF-8과 strict/no-backslash SQL mode를 명시하고 환경 진단을 반환한다. PG E 문자열과 SQLite SQL 주석은 따옴표/백슬래시/개행을 안전하게 보존한다. legacy 타입/default/namespace는 임의 SQL로 삽입하지 않는다.
- 실제 MySQL 실행에서 발견한 CHECK-autoIncrement 및 CHECK-FK source CASCADE/SET NULL 제한, 인덱스 unique/method/include/direction/prefix/type 제약을 공통 검증에 반영했다. NO ACTION/RESTRICT source 및 FK target CHECK 허용은 실제 DB로 구분했다. 일반 write/REST/MCP/sync/DDL이 같은 검사기를 소비한다.
- model 전체 28개 파일/405개 테스트, native DDL 159개 테스트 및 model typecheck/build 통과. 전체 `pnpm check`는 병렬 완성 UI/transfer와 함께 포맷·타입·빌드 통과, 1041개 통과/89개 건너뜀. 기존 Vite 크기 경고 유지.
- 격리 PostgreSQL18.6에서 65개 타입 선언을 실제 생성하고 기본값 UTF-8 roundtrip/identity/제약 거부/FK cascade, 프로젝트 ENUM default, PG18 virtual generated 및 expression/partial/include/nulls-not-distinct index를 실행했다. 전용 schema는 transaction rollback으로 정리했고 runner 임시 DB도 제거했다.
- Node24.18.1 SQLite3.53.1에서 추천 23개 타입의 실제 affinity 저장, STRICT/WITHOUT ROWID, generated, expression/partial index, FK와 CHECK 및 기본값 roundtrip을 확인했다. 메모리 DB를 닫았다. 최소 버전3.45 자체의 실행은 후속 버전 QA에 남긴다.
- 네트워크/외부 포트/사용자 볼륨 없는 전용 공식 MySQL8.4.11 컨테이너에서 37개 타입 선언, ENUM/SET UTF-8 roundtrip, autoIncrement/default/check/FK cascade, JSON/BLOB default, timestamp precision6/ON UPDATE, charset/collation/generated/prefix/invisible 조합을 실행했다. 각 실행의 임시 DB를 finally에서 제거했다. 컨테이너는 후속 고급 QA에 재사용 후 정리한다.
- MySQL 검증 재현: `pnpm --filter @ezerd/model build` 후 전용 label을 가진 `ezerd-native-ddl-qa-20261002`에서 `pnpm --filter @ezerd/server exec tsx scripts/verify-native-mysql-ddl.ts`. 스크립트 자체 strict TypeScript 및 담당 파일 Prettier 검사 통과.

문법 근거: [PG CREATE TABLE](https://www.postgresql.org/docs/18/sql-createtable.html), [PG CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html), [MySQL CREATE TABLE](https://dev.mysql.com/doc/refman/8.4/en/create-table.html), [MySQL CHECK](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html), [SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html), [SQLite CREATE INDEX](https://www.sqlite.org/lang_createindex.html).

이는 컴파일러 및 해당 실행 fixture 단위다. 공유 메뉴·실제 다운로드·REST/MCP export 소비, 모든 고급 타입 리터럴/옵션/접근 방식 fixture, native 타입 usable 활성화 및 전체 명세 완료는 후속이다. 실제 단순 선언 통과를 모든 타입의 모든 옵션/키/default 지원으로 계산하지 않는다.

# DB 종류별 프로젝트 전체 DDL 내보내기 계획

## 요청과 조사 범위

- 내보내기 대상은 프로젝트 전체 물리 설계로 한다.
- 프로젝트 카드에 저장된 `databaseKind`에 따라 PostgreSQL, MySQL, SQLite DDL을 생성하는 작업 순서를 설계한다.
- 이번 작업은 계획 구체화이며 제품 코드는 구현하지 않는다.
- 기존 물리 모델·타입 검증·프로젝트 DB 선택 흐름을 확인하고 DB 공식 문서와 비교하여 호환성 정책, 구현 단위 및 검증 기준을 정한다.
- 기존·동시 작업의 미커밋 변경과 `docs/EZERD.txt`는 변경하지 않는다.
- 조사 기록: `docs/work-log/2026-10-01-DDL-MultiDatabaseExportAssessment.md`.

## 확정된 범위와 권장 방향

- 사용자 지정 범위: 프로젝트 전체 물리 설계, 카드에 저장된 DB 종류별 출력.
- 권장 첫 구현: 현재 설계 데이터 구조를 유지하고 DB별 생성기와 호환성 진단을 추가한다. DB 종류 변경은 출력 대상 변경으로 처리하고 원본 타입·스키마·ENUM을 자동으로 덮어쓰지 않는다.
- PostgreSQL 출력은 기존 `exportPostgres()`를 유지한다. MySQL·SQLite를 지원하기 위해 PostgreSQL SQL 문자열을 치환하거나 PostgreSQL 진단을 모든 DB의 필수 검증으로 사용하지 않는다.
- 기본 테이블·컬럼·PK·UNIQUE·FK를 세 DB 모두 지원하는 것을 첫 완료 기준으로 삼는다. 표현이 다른 기능은 명시한 매핑 정책을 사용하고, 의미가 보존되지 않는 항목은 경고 또는 오류로 알린다.
- 출력은 생성 DDL이며 데이터 INSERT, 실제 DB 차이 분석, ALTER 마이그레이션, DB 연결/실행은 별도 범위다.

## 현재 코드에서 확인한 전제

- `packages/contracts/src/workspace.ts`에 `DatabaseKind = 'postgresql' | 'mysql' | 'sqlite'`가 있다. 프로젝트 조회/수정/생성/JSON 전송에 DB 종류가 이미 포함된다.
- `ProjectGallery.tsx`는 카드에서 DB 종류를 변경하고 `flush()` 및 `App.changeProject()`를 통해 저장한다. 새 선택 UI나 DB 컬럼은 필수가 아니다.
- `packages/model/src/postgres.ts`에는 PostgreSQL 생성기만 있다.
- `TableEditor.tsx`의 타입 후보와 별칭은 `postgresTypeNames`, `canonicalPostgresTypeName`에 의존한다.
- `packages/contracts/src/relational.ts`의 컬럼 검증도 `postgres-types.ts`의 `validatePhysicalType()`을 호출한다. 모델 필드는 범용 문자열이지만 현재 타입 후보·파라미터 규칙은 PostgreSQL 기준이다.
- 서버 정규화와 FK 생성 과정에도 PostgreSQL 타입 정규화/serial 처리 흔적이 있다. 다른 DB의 고유 타입 입력까지 지원할 때 함께 검토해야 한다.
- [이전 조사](../work-log/2026-10-01-Canvas-DDLExportAssessment.md)의 150~300줄 예상은 PostgreSQL UI 연결 범위였다. 이번 다중 DB 생성기 개발에 적용할 수 없다.

## 출력 흐름

1. 공유 메뉴 `DDL 내보내기`를 실행한다. 현재 프로젝트 ID를 고정하고 중복 실행을 차단한다.
2. 자동 저장과 협업 큐 상태를 확인한다. `prepareToLeave()`는 서버 공유 저장 완료 자체를 보장하지 않으므로 pending/conflict/storageFailure를 별도로 확인한다.
3. 기존 프로젝트 조회 API 또는 JSON export 조회 부분으로 저장된 프로젝트와 문서를 한 스냅샷에서 받는다. `databaseKind`와 문서를 같은 응답에서 사용하고 `cache: 'no-store'`로 조회한다.
4. `exportDdl(document, databaseKind)`에 프로젝트 전체 문서를 전달한다. 뷰/도메인/선택 객체로 필터링하지 않는다. 화면 참조와 관계없는 원본 물리 객체를 ID 기준으로 한 번씩 생성한다.
5. 오류가 있으면 SQL 다운로드를 차단하고 대상별 진단을 표시한다. 의미 차이가 있는 매핑 경고는 결과 화면에서 확인한 뒤 내보낼 수 있도록 한다.
6. 성공 시 `<프로젝트명>.<postgresql|mysql|sqlite>.sql`로 내려받는다. 헤더에는 대상 DB, 검증 기준 버전 및 적용 전제를 기록한다.
7. 생성 도중 프로젝트 이동 또는 결과 확인 도중 DB 종류/설계 갱신이 일어나면 결과를 무효화하거나 재생성한다.

## 생성기 구성

예상 위치:

```text
packages/model/src/ddl.ts                   공용 진입점과 결과 타입
packages/model/src/ddl-common.ts            물리 객체 수집 및 공통 구조 검증
packages/model/src/postgres.ts              기존 PostgreSQL 생성기
packages/model/src/mysql.ts                 MySQL 생성/검증
packages/model/src/sqlite.ts                SQLite 생성/검증
packages/model/src/ddl-type-policy.ts        타입·기본값 변환 및 지원 정책
```

공용 결과는 `sql`, `canExport`, `diagnostics`를 유지하되 진단에 `severity: 'error' | 'warning'`, `code`, `objectId`, 번역용 `params`를 둔다. 오류가 있으면 SQL 전체를 비운다. 경고만 있으면 SQL은 만들되 다운로드 전 변환 내용을 보여 준다. 기존 PostgreSQL 공개 API는 호환 래퍼로 유지할 수 있다.

공통 검증은 소유 테이블, 컬럼/키/FK 참조와 순서, 논리 전용 객체 배제 등 구조를 담당한다. DB별 검증은 타입·길이·정밀도, 식별자 길이/대소문자/충돌 범위, 스키마, 자동 증가, 기본값, FK 동작을 담당한다. MySQL의 FK 제약 이름 범위 등은 PostgreSQL 규칙을 그대로 복사하지 않는다.

`@ezerd/contracts`가 이미 `@ezerd/model`을 참조하므로 모델에서 계약 패키지의 `DatabaseKind`를 역참조하지 않는다. 모델의 대상 DB union을 먼저 정의하고 계약이 재사용하도록 정리하거나, 동등한 문자열 union을 유지하며 계약 테스트로 일치 여부를 확인한다.

## DB별 출력 및 호환성 정책 초안

아래 매핑은 구현 권고이며 모든 DB의 동등한 의미 보장을 선언한 것이 아니다. 버전·범위·제약까지 테스트한 항목만 지원으로 표시한다.

| 항목 | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| 테이블/컬럼/PK/UNIQUE | 기존 출력 유지 | 백틱 인용, InnoDB 및 대상 DB별 제한 검증 | 인용된 이름과 CREATE TABLE 제약 사용, PK NULL 규칙 명시 |
| FK | 테이블 생성 후 ALTER TABLE ADD CONSTRAINT | 테이블 모두 생성 후 FK 추가. 컬럼 타입·길이·문자셋/콜레이션·인덱스 제한 검증 | CREATE TABLE 내부 선언. 트랜잭션 전 `PRAGMA foreign_keys=ON`, 각 실행 연결에서도 활성화 필요 |
| ENUM | 독립 CREATE TYPE | 사용 컬럼에 ENUM 값 목록 전개. 대소문자/끝 공백/정렬 의미 차이 검증 | TEXT + CHECK 값 집합. NULL 허용은 nullable과 별도로 처리 |
| 자동 증가 | 기존 serial 계열 | 정수 AUTO_INCREMENT. 테이블당 하나, 적합한 키/인덱스 조건 검증 | 단일 INTEGER PK 조건에서만 자동 할당으로 매핑. 복합 PK/비PK serial은 차단. AUTOINCREMENT 채택 여부는 ID 재사용 정책으로 결정 |
| uuid | uuid | CHAR(36) 제안, 형식 검증/콜레이션 정책과 경고 필요 | TEXT 제안, 형식 제약/경고 필요 |
| bytea | bytea | BLOB 계열로 명시한 크기 정책 적용 | BLOB |
| boolean | boolean | BOOLEAN 또는 TINYINT + CHECK 정책 | INTEGER + CHECK(0,1) 정책 |
| json/jsonb | 기존 타입 | JSON. jsonb의 저장/동등성 의미 차이 진단 | TEXT + JSON 유효성 CHECK 정책. 함수 가용 버전·키/비교 의미 차이 진단 |
| 정밀 numeric | 기존 지원 | 허용 DECIMAL 정밀도/소수 범위 검증, 무제한 numeric 기본값을 임의 선택하지 않음 | NUMERIC affinity만으로 정밀 소수 보장 불가. 정확도가 필요하면 오류, 별도 저장 정책을 요구 |
| 길이 제한 문자열 | 기존 지원 | 문자셋·행/키 크기 및 CHAR/VARCHAR 길이 제한 검증 | TEXT + CHECK로 길이 정책 또는 경고. CHAR 패딩 의미는 별도 취급 |
| 배열 | 기존 지원 | 첫 버전 오류 | 첫 버전 오류 |
| timestamptz/timetz | 기존 지원 | 시간대·정밀도 정책 확정 전 오류. DATETIME으로 묵시적 대체하지 않음 | 저장 형식/UTC 정책 확정 전 오류 |
| 기본값 | 기존 허용 표현 | 허용 리터럴·CURRENT_TIMESTAMP 등을 대상 문법으로 변환 | 허용 리터럴 및 시간 함수에 대한 저장 형식·정밀도 정책 검증 |
| 함수 기본값 | 기존 허용 표현 | `gen_random_uuid()` 등 이름 치환만 하지 않고 의미가 검증된 매핑만 지원 | 동등한 내장 구현이 없는 표현은 오류 |
| 설명 | COMMENT ON | 컬럼/테이블 COMMENT | DDL 내 SQL 주석으로 보존하고 DB 메타데이터 기능 차이를 경고 |
| 스키마 | CREATE SCHEMA 및 한정 이름 | 기본/`public`을 현재 DB로 출력한다면 매핑 경고. 다른 스키마는 명시적 DB 매핑·생성 옵션 제공 또는 첫 버전 오류 | 기본/`public`을 main으로 출력한다면 매핑 경고. 다른 스키마/다중 스키마는 첫 버전 오류 |
| FK SET DEFAULT | 기존 지원 | InnoDB 대상 오류 | 대상 부모 기본값의 실제 존재 여부까지 동작 검증 |

기본 원칙:

- 원본 테이블/컬럼/키/FK를 조용히 제외하지 않는다. 지원 불가 객체가 있으면 전체 내보내기를 차단한다.
- 배열을 JSON으로 바꾸거나 스키마를 평탄화하거나 정확한 소수를 REAL로 바꾸는 처리는 자동 적용하지 않는다.
- 기본값 문자열은 DB별 허용 표현으로 해석해 출력한다. 사용자가 입력한 표현을 검증 없이 SQL에 삽입하지 않는다.
- ENUM의 미사용 정의는 MySQL/SQLite에 독립 타입으로 만들 수 없으므로 원본 문서에 유지하고 결과에서 차이를 알린다.
- 원본 `schemaVersion: 1`을 첫 단계에서 유지할 수 있다. 향후 DB 고유 타입·unsigned·collation·identity 옵션 등을 편집기로 노출할 때에는 모델/계약/MCP/API 호환 전략을 별도 설계한다.

## 구현 순서와 커밋 단위

1. **지원 정책 및 공용 진입점**: 대상 DB/지원 버전, 오류·경고 기준을 정한다. 기존 PostgreSQL을 공용 진입점에 연결하고 회귀 테스트로 SQL/진단 유지 확인. 구조 공통화는 실제 공유되는 부분만 추출한다.
2. **MySQL 생성기**: 기본 타입·테이블·키·FK·ENUM·설명 지원, 변환/차단 규칙과 단위 테스트 추가. MySQL 8.4/InnoDB를 첫 검증 기준 후보로 삼고 exact 이미지 버전을 구현 시 고정한다.
3. **SQLite 생성기**: affinity와 CHECK, FK 인라인, INTEGER PK, 스키마 제한 및 주석 지원. 검증에 사용한 SQLite 버전을 기록하고 그에 맞는 최소 지원 버전을 명시한다.
4. **내보내기 화면 연결**: 프로젝트/문서 스냅샷 조회, 자동 분기, 메뉴·결과 화면·다운로드·번역·진단 이동 연결. 배열/시간대 등 지원 불가 항목에 구체적인 수정 안내 제공.
5. **실제 DB 검증 및 QA**: 세 DB별 실행 스크립트와 독립 테스트 환경, 브라우저 실제 파일 검증. PostgreSQL 기존 검증을 확장하고 MySQL 임시 DB 생성/삭제, SQLite 임시 또는 메모리 DB를 사용한다. MySQL DDL 검증 정리를 트랜잭션 롤백에 의존하지 않는다.

각 단위 완료 시 planning/work-log 및 관련 변경 범위를 확인하고 독립 커밋한다. 제품 전체 format/typecheck/test/build를 완료하되 다른 작업의 변경을 커밋에 섞지 않는다.

DB 고유 타입 입력까지 자연스럽게 지원하는 편집기는 후속 단계다. 선택 DB에 맞는 타입 후보·옵션·FK 정책을 보여 주려면 `TableEditor`, 계약 검증, 서버 정규화와 MCP 문서도 함께 변경해야 한다. 이는 내보내기 전용 첫 범위를 넘어가므로 별도 계획으로 분리한다.

## 완료 기준

- 같은 전체 설계를 카드의 DB 선택에 따라 다른 DDL로 생성한다. 서버에서 읽은 DB 종류와 문서가 일관되어야 한다.
- 소속 없는 테이블, 다른 도메인 테이블, 동일 객체의 복수 화면 참조도 빠짐/중복 없이 출력한다.
- 오류가 있으면 다운로드하지 않고 객체명·원인·수정 안내를 표시한다. 경고가 있으면 변환 내용을 확인할 수 있다.
- 생성 SQL을 세 실제 엔진에서 실행한다. 시스템 카탈로그/PRAGMA/SHOW CREATE TABLE로 타입·키·FK·NULL·기본값을 확인한다.
- INSERT/UPDATE/DELETE로 자동 증가, ENUM 허용/거부, FK 위반, CASCADE/SET NULL, 복합·순환 관계를 검증한다. SQL 생성 성공만으로 의미 보존을 판단하지 않는다.
- DB 종류 변경, 저장 실패·충돌·오프라인 대기, 읽기 전용/보관 프로젝트, 빈 설계, 다국어/따옴표/역슬래시 이름·리터럴, 길이/정밀도 경계를 확인한다.
- 메뉴 키보드 조작, 진단 테이블 및 ENUM 관리 이동, 결과 상태 초기화, 실제 다운로드 내용/파일명 확인.

## 공식 자료

- [PostgreSQL numeric 및 serial](https://www.postgresql.org/docs/current/datatype-numeric.html)
- [MySQL 8.4 CREATE TABLE](https://dev.mysql.com/doc/refman/8.4/en/create-table.html): AUTO_INCREMENT, COMMENT, 테이블 제약 출력 기준.
- [MySQL 8.4 FK 제약](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html): InnoDB의 타입/인덱스 제한 및 SET DEFAULT 거부.
- [MySQL ENUM](https://dev.mysql.com/doc/refman/8.4/en/enum.html): 컬럼 값 목록, 끝 공백·콜레이션 등 의미 차이.
- [MySQL DECIMAL](https://dev.mysql.com/doc/refman/8.4/en/fixed-point-types.html): 대상 수치 정밀도 규칙.
- [MySQL 암묵적 커밋](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html): DDL 실행 검증 후 명시적 임시 DB 정리 필요.
- [SQLite 타입 affinity](https://www.sqlite.org/datatype3.html): boolean/시간 저장 형식, 강제 타입/정밀도 의미 차이.
- [SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html), [ALTER TABLE](https://www.sqlite.org/lang_altertable.html): 테이블 내부 제약과 제한된 변경 기능.
- [SQLite FK](https://www.sqlite.org/foreignkeys.html): 연결별 활성화 및 PK/UNIQUE 조건.
- [SQLite 자동 증가](https://www.sqlite.org/autoinc.html): INTEGER PRIMARY KEY 자동 할당과 AUTOINCREMENT의 ID 재사용 차이.

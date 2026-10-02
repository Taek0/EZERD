# DB별 타입·기능 지원 명세

- 상태: 구현 목표 명세. 아래 표는 현재 제품의 구현 완료 목록이 아니다.
- 상위 명세: [기능 집합 구현 명세](2026-10-01-Database-CapabilitySpecification.md)
- 기준 프로필: PostgreSQL 18, MySQL 8.4/InnoDB, SQLite 3.45 이상. 프로필 규칙의 첫 버전은 `v1`로 고정한다.
- 범위: 문서화된 컬럼용 기본 타입과 ERD의 테이블·컬럼·제약·인덱스. 확장 설치, 내부 카탈로그 타입 전체, DB 권한·복제·프로시저·트리거·파티션 운영은 첫 범위에서 제외한다.
- 단계 표기: `T1` 일반 타입, `T2` 고급 기본 타입, `F1` 기본 기능, `F2` 고급 설계 기능. 단계가 끝나기 전 항목은 등록만 하고 선택 목록에는 활성화하지 않는다.

## 타입 정의 공통 규칙

각 행의 타입마다 독립 `TypeDefinition`을 만든다. 그룹별 한 개 레코드로 대신하지 않는다. 필수 항목은 `id`, `databaseKind`, `sqlName`, `aliases`, `category`, `parameterSpec`, `allowedColumnOptions`, `keyPolicy`, `defaultPolicy`, `availability`, `sources`, `fixtureIds`다.

타입 ID는 `postgresql:integer`, `mysql:int`, `sqlite:integer`처럼 DB를 포함한다. SQL 이름·표시명·별칭은 ID와 분리한다. 별칭 정규화는 해당 DB 프로필 내부에서만 한다. 이름이 같다는 이유로 다른 DB 타입을 같은 레코드로 합치지 않는다.

카탈로그 상태는 `specified` → `implemented` → `verified`이며 타입의 기본 선언, 지원하는 파라미터, 옵션, 키와 기본값 조합별 구현 상태를 구분한다. `verified`의 필요한 세로 경로(UI·계약·서버·MCP·DDL·실행)가 모두 갖춰져야 사용 가능이다. 타입의 FK/특수 기본값을 전부 지원하지 않아도 타입 선택은 가능하며, 미완료 옵션만 비활성화한다.

## PostgreSQL 18

아래 일반 타입 목록은 [공식 일반 타입 표](https://www.postgresql.org/docs/18/datatype.html)를 기준으로 한다. serial 별칭은 실제 컬럼 저장형에서 정수 타입 + 생성 정책으로 분리한다. 의사 타입은 테이블 컬럼 후보에서 제외한다.

| 분류 | 타입/구문 | 정의할 옵션과 조건 | 단계 |
| --- | --- | --- | --- |
| 정수 | smallint, integer, bigint | 고정 폭/부호; 길이·precision·scale 없음 | T1 |
| 자동 증가 구문 | smallserial, serial, bigserial | 별칭을 정수 + `generation.kind=serial`로 정규화; identity와 의미 구분 | T1/F1 |
| 정밀 소수 | numeric | precision/scale 또는 무제한; 음수 scale와 precision 초과 scale를 허용하는 PG 규칙 | T1 |
| 부동 소수 | real, double precision | float(p) 별칭은 정확한 p 규칙으로 canonical 타입 해석; decimal 파라미터로 오인하지 않음 | T1 |
| 문자 | char, varchar, text | 길이 및 생략 의미; `char` 기본 길이와 길이 없는 varchar 구분 | T1 |
| 이진/논리 | bytea, boolean | 파라미터 없음; 바이너리/논리 기본값 타입 검사 | T1 |
| 날짜·시간 | date, time, timetz, timestamp, timestamptz | 해당 시간 타입 fractional precision; 시간대 의미 및 기본값 | T1 |
| 기간 | interval | fields selector와 precision을 별도 파라미터로 표현 | T2 |
| UUID/JSON | uuid, json, jsonb | JSON/JSONB의 키 및 비교 지원을 각각 판정 | T1 |
| JSON 경로/XML | jsonpath, xml | 타입 전용 리터럴/캐스트; 외부 표현을 text 기본값으로 묵시 처리하지 않음 | T2 |
| 비트 | bit, bit varying | bit 길이; 별칭 varbit | T2 |
| 화폐 | money | locale 의존 기본값/해석을 별도 진단 | T2 |
| 기하 | point, line, lseg, box, path, polygon, circle | 파라미터 없음; 기본값·키 지원은 개별 타입 정책 | T2 |
| 네트워크 | inet, cidr, macaddr, macaddr8 | 파라미터 없음; 타입별 유효 리터럴 | T2 |
| 텍스트 검색 | tsvector, tsquery | 타입별 리터럴/인덱스 방식 | T2 |
| 범위 | int4range, int8range, numrange, tsrange, tstzrange, daterange | 타입별 subtype와 기본값 | T2 |
| 다중 범위 | int4multirange, int8multirange, nummultirange, tsmultirange, tstzmultirange, datemultirange | range와 별개 ID 및 리터럴 | T2 |
| 객체 식별 | oid, regclass, regcollation, regconfig, regdictionary, regnamespace, regoper, regoperator, regproc, regprocedure, regrole, regtype | 참조 객체 존재가 필요한 기본값은 환경 의존 진단 | T2 |
| 로그/스냅샷 | pg_lsn, pg_snapshot, txid_snapshot | txid_snapshot은 deprecated로 분류; 입력 경로는 고급/레거시 표시 | T2 |
| 프로젝트 ENUM | enumId로 참조하는 정의 | 독립 스키마/이름/값 목록; 기본값·FK를 같은 enum ID로 검증 | F1 |
| 배열 | 지원하는 기본 타입·ENUM의 배열 | 타입 ID를 원소로 사용; 첫 기능 단위는 1차원 선언, 다차원은 F2. 선언 차원은 데이터 차원 강제를 의미하지 않음 | F1/F2 |
| 사용자 정의 | composite/domain/custom range/extension 타입 | 별도 등록·의존 객체 생성 명세가 마련되기 전 예약; 임의 타입 이름을 신규 유효 타입으로 인정하지 않음 | 후속 |

파라미터 기준:

- `numeric`: 명시 precision 1~1000, scale -1000~1000, scale는 precision 선언과 함께 사용. 무제한 numeric과 numeric(p,0)을 분리한다. [공식 numeric 규칙](https://www.postgresql.org/docs/18/datatype-numeric.html)
- 시간 fractional precision: 0~6. interval fields는 허용 필드 조합의 enum으로 제공한다. [날짜·시간 규칙](https://www.postgresql.org/docs/18/datatype-datetime.html)
- char/varchar 길이: 제품 현행 상한 10,485,760을 초기 제품 한도로 유지하고 DB 한도와 구분한다. char 길이 생략과 varchar 길이 생략은 다르게 출력한다. [문자 타입](https://www.postgresql.org/docs/18/datatype-character.html)
- ENUM의 식별자/레이블 63 UTF-8 바이트 규칙은 PostgreSQL 프로필에만 둔다. 공용 구조 검증에 남기지 않는다. [ENUM 규칙](https://www.postgresql.org/docs/18/datatype-enum.html)
- 범위/객체 식별 타입 목록 보완 근거: [range/multirange](https://www.postgresql.org/docs/18/rangetypes.html), [OID 계열](https://www.postgresql.org/docs/18/datatype-oid.html).

## MySQL 8.4 / InnoDB

[공식 기본 타입 분류](https://dev.mysql.com/doc/refman/8.4/en/data-types.html)를 기준으로 정수·소수·문자·시간·JSON·공간 타입을 전부 정의한다. MySQL 9.x의 새 타입을 8.4 프로필에 섞지 않는다.

| 분류 | 타입 | 정의할 옵션과 조건 | 단계 |
| --- | --- | --- | --- |
| 정수 | tinyint, smallint, mediumint, int, bigint | signed/unsigned; 정수 display width/zerofill은 신규 옵션에 노출하지 않음 | T1 |
| 정밀 소수 | decimal | precision/scale; numeric/dec/fixed는 별칭. deprecated unsigned 소수는 레거시 진단 | T1 |
| 부동 소수 | float, double | precision 별칭; deprecated (M,D), unsigned, zerofill 구문은 별도 레거시 처리 | T1 |
| 비트 | bit | bitLength 1~64 | T1 |
| 논리 별칭 | bool, boolean | tinyint(1) 별칭으로 정의; 0/1 제약을 자동 생성하지 않음 | T1 |
| 생성 별칭 | serial | BIGINT UNSIGNED + NOT NULL + AUTO_INCREMENT + UNIQUE로 해석. PG serial과 전역 공통 별칭으로 묶지 않음 | T1/F1 |
| 날짜·시간 | date, datetime, timestamp, time, year | fractional precision, 시간 기본값 및 ON UPDATE; YEAR(4) 대신 YEAR | T1 |
| 문자 | char, varchar | 문자 길이, charset/collation 정책 | T1 |
| 이진 | binary, varbinary | 바이트 길이 | T1 |
| 큰 문자열 | tinytext, text, mediumtext, longtext | 각 용량/키·기본값 제한. 임의 TEXT(n)으로 타입을 바꾸지 않음 | T1 |
| 큰 이진 | tinyblob, blob, mediumblob, longblob | 각 용량/키·기본값 제한 | T1 |
| 선택 목록 | enum, set | 컬럼별 순서 있는 값 목록; ENUM과 SET 별개 타입. 공용 PG ENUM 객체로 강제하지 않음 | T1 |
| JSON | json | 배열과 혼동하지 않음; 직접 인덱스/키 제한 및 기본값 표현 검증 | T1 |
| 공간 | geometry, point, linestring, polygon, multipoint, multilinestring, multipolygon, geometrycollection | SRID와 공간 인덱스/NULL 조건 | T2/F2 |

파라미터 기준:

- DECIMAL precision 1~65, scale 0~min(30,precision). 생략 시 DB 기본 의미를 보존한다. BIT 길이는 생략 시 기본값과 명시값을 구분한다. SQL 모드는 REAL_AS_FLOAT를 사용하지 않는 지원 프로필로 고정해 REAL 별칭의 의미를 일관되게 한다. [numeric 문법](https://dev.mysql.com/doc/refman/8.4/en/numeric-type-syntax.html)
- 시간 fractional precision 0~6. DATE/YEAR에는 fractional precision을 제공하지 않는다. [시간 문법](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-type-syntax.html)
- CHAR 길이 0~255, VARCHAR 길이 0~65535의 구문 범위와 실제 utf8mb4 행 크기/인덱스 바이트 제한을 따로 검사한다. BINARY/VARBINARY는 문자 길이와 다른 바이트 정책을 적용한다. [문자/이진 문법](https://dev.mysql.com/doc/refman/8.4/en/string-type-syntax.html)
- ENUM과 SET은 제품의 1.5 MB 문서/2 MB 전송 한도를 우선 적용한다. 제품 목록 수 상한을 명시하고 DB 한도까지 지원하는 것으로 광고하지 않는다. SET의 쉼표 포함 값/콜레이션/중복 처리를 타입별로 검증한다.
- 공간 타입/SRID: [공식 공간 타입](https://dev.mysql.com/doc/refman/8.4/en/spatial-type-overview.html).

## SQLite 3.45 이상

SQLite의 저장 클래스와 선언 타입/affinity를 분리한다. 일반 테이블에서는 추천 목록 외의 유효 선언도 수용하는 고급 경로를 둔다. 이 경로를 PostgreSQL/MySQL의 미등록 타입 입력 허용에 재사용하지 않는다. [공식 affinity 규칙](https://www.sqlite.org/datatype3.html)

| 분류 | 타입/선언 | 조건 | 단계 |
| --- | --- | --- | --- |
| 추천 기본 선언 | INTEGER, REAL, TEXT, BLOB, NUMERIC | 선언별 affinity 표시. 길이·소수 정밀도 강제를 주장하지 않음 | T1 |
| 일반 모드 선언 | INT, BIGINT, SMALLINT, DOUBLE, DOUBLE PRECISION, FLOAT, CHAR, VARCHAR, NCHAR, NVARCHAR, CLOB, DECIMAL, BOOLEAN, DATE, DATETIME 등 | 추천 선언 레코드 + affinity 계산. 선언 파라미터는 PG/MySQL과 같은 강제 규칙으로 표시하지 않음 | T1 |
| 사용자 선언 | 일반 모드의 사용자 typeName 및 숫자 파라미터 | 제한된 안전한 타입 선언 문법으로 보관/출력, affinity 미리보기 및 실제 PRAGMA 검사 | T2 |
| 선언 생략 | 타입 없는 컬럼 | BLOB affinity 표시, STRICT에서는 금지 | T1 |
| STRICT | INT, INTEGER, REAL, TEXT, BLOB, ANY | 테이블 옵션으로 활성화. 일반 모드 선언을 자동 치환하지 않음 | F1 |
| JSON/날짜/UUID 용도 | TEXT/BLOB/INTEGER 등 실제 저장형 + 선택적 CHECK/표현 정책 | 별도 native JSON/UUID/ENUM 타입으로 노출하지 않음 | F2 |

STRICT는 테이블별 모드이며 프로젝트 전체의 단일 강제 모드로 저장하지 않는다. ANY 및 INT/INTEGER의 의미도 모드/PK 조건에 따라 판정한다. [STRICT 허용 타입/의미](https://www.sqlite.org/stricttables.html)

SQLite JSONB는 JSON 함수가 사용하는 BLOB 표현이며 PostgreSQL jsonb와 같은 타입 ID가 아니다. native JSONB 컬럼 타입을 만들지 않는다. [SQLite JSON/JSONB](https://www.sqlite.org/json1.html)

## 기능 합집합과 활성 조건

아래는 **DB가 제공하는 기능의 명세**이며 제품 활성화는 검증 완료 상태를 추가로 요구한다. `—`는 해당 DB 프로필의 native 기능으로 제공하지 않음을 의미한다.

| 기능 | PostgreSQL 18 | MySQL 8.4/InnoDB | SQLite | 단계 |
| --- | --- | --- | --- | --- |
| 테이블/컬럼/NOT NULL | 지원 | 지원 | 지원, affinity/STRICT 구분 | F1 |
| PK/UNIQUE/복합 키 | 타입별 제약 | 타입/길이/인덱스 제약 | rowid 및 NULL 의미 구분 | F1 |
| FK 및 복합/순환 관계 | 테이블 후 ALTER | 테이블 후 ALTER | CREATE TABLE 내부 선언 | F1 |
| FK 동작 | 5종 | SET DEFAULT 제외 | 5종, 부모 기본값 조건 | F1 |
| 자동 증가 | serial, identity(always/byDefault) | AUTO_INCREMENT | INTEGER PK rowid, AUTOINCREMENT | F1 |
| 일반 기본값 | DB별 타입 리터럴·허용식 | 타입/괄호/시간 표현 | 리터럴·허용 시간 표현 | F1 |
| 배열 | 지원 타입의 native 배열 | — | — | F1/F2 |
| ENUM | 프로젝트 타입 정의 | 컬럼 ENUM | —, CHECK로 값 제한 별도 | F1 |
| SET | — | 컬럼 SET | — | T1 |
| 스키마/네임스페이스 | 프로젝트 정의 스키마 | 선택된 실행 DB, 별도 DB 생성은 후속 | main, ATTACH 흐름은 후속 | F1 |
| DB 메타데이터 주석 | COMMENT ON | COMMENT | —, 제품 설명은 SQL 주석으로 보존 | F1 |
| 일반/고유 인덱스 | btree 우선, hash/gist/spgist/gin/brin 추가 | InnoDB btree, FULLTEXT/SPATIAL 조건 | 일반/고유 인덱스 | F1/F2 |
| 인덱스 고급 옵션 | partial, expression, include, nullsNotDistinct 등 | expression, prefix, invisible 등 | partial/expression 등 | F2 |
| CHECK | 타입·식 조건 | 타입·식 조건 | 타입·식 조건 | F2 |
| generated column | stored/virtual, PG18 규칙 | stored/virtual | stored/virtual | F2 |
| collation/charset/SRID | collation은 설치 의존 | 지원 charset/collation/SRID | 기본 collation 및 등록 의존 | F2 |
| 지연 제약 | 지원하는 키/FK의 옵션 | — | FK 옵션 | F2 |
| STRICT/WITHOUT ROWID | — | — | 테이블 옵션 | F1/F2 |

SQL 출력을 위한 상세 전제:

- PG18 generated column은 stored/virtual을 둘 다 정의하되 함수/타입/다른 generated 참조 제한을 DB 정책으로 검사한다. [CREATE TABLE](https://www.postgresql.org/docs/18/sql-createtable.html)
- MySQL FK는 지원 엔진·참조 키·타입/부호·문자셋/콜레이션을 검사하고 SET DEFAULT는 차단한다. [FK](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)
- MySQL text/blob/json 등의 기본값은 타입별 식 표현 규칙을 적용한다. [기본값](https://dev.mysql.com/doc/refman/8.4/en/data-type-defaults.html)
- SQLite FK 활성화는 트랜잭션 전에 명시하고 실행 연결마다 유지해야 한다. INTEGER PK의 자동 할당은 명시 AUTOINCREMENT와 다르게 모델링한다. [FK](https://www.sqlite.org/foreignkeys.html), [자동 증가](https://www.sqlite.org/autoinc.html)
- F2 식 기능은 구조화된 제한 식 문법과 참조 ID를 사용한다. arbitrary SQL 전체를 지원한 것으로 표시하지 않는다. CHECK·generated·인덱스가 허용하는 함수/참조 조건은 별도 검사한다.
- 인덱스별 컬럼·식·참조·접근 방식 검증: [PG](https://www.postgresql.org/docs/18/sql-createindex.html), [MySQL](https://dev.mysql.com/doc/refman/8.4/en/create-index.html), [SQLite](https://www.sqlite.org/lang_createindex.html).
- CHECK/generated 세부 규칙: [MySQL CHECK](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html), [SQLite generated](https://www.sqlite.org/gencol.html).

## 지원표의 완료 판정

1. 위 범위의 모든 타입은 카탈로그에 정의한다. 예약/미구현 상태를 숨겨서 전체 지원으로 표시하지 않는다.
2. 각 타입의 별칭·파라미터 경계·선택 DB 필터·서버 거부·DDL 실행 fixture를 연결한다.
3. 타입 자체, 배열/생성 옵션, PK/UNIQUE/FK, 리터럴/식 기본값은 각각의 지원 여부를 기록한다. 특히 고급 타입은 기본 선언 통과와 모든 키/기본값 지원을 구분한다.
4. F1의 세 DB 편집·저장·내보내기를 먼저 완성하고, T2/F2는 같은 구조에서 연속 구현한다. 전체 범위 완료 여부는 마지막 지원표 검사로 판단한다.
5. 전체 DB 엔진 기능을 구현했다는 표현 대신 지원 버전·타입·옵션·식 범위·제품 한도를 제시한다.
